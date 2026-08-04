import { prisma } from "@/lib/db";
import type { RecommendationAnswers } from "@/lib/recommendation/types";

export type CompassServicePackageCode =
  | "SITE_MIGRATION"
  | "INITIAL_SETUP"
  | "DOMAIN_SSL"
  | "BACKUP_RESTORE"
  | "ARCHITECTURE_LIGHT";

export type CompassServicePackage = {
  code: CompassServicePackageCode;
  title: string;
  description: string;
  priceRial: bigint;
  active: boolean;
};

const DEFAULTS: Array<
  Omit<CompassServicePackage, "priceRial" | "active"> & {
    defaultPriceRial: bigint;
  }
> = [
  {
    code: "SITE_MIGRATION",
    title: "انتقال سایت/سورس",
    description: "جابه‌جایی کنترل‌شده از هاست یا سرور فعلی به ابرچین.",
    defaultPriceRial: 15_000_000n,
  },
  {
    code: "INITIAL_SETUP",
    title: "راه‌اندازی اولیه + سخت‌سازی پایه",
    description: "نصب، تنظیم دسترسی و حداقل امن‌سازی قبل از تحویل.",
    defaultPriceRial: 8_000_000n,
  },
  {
    code: "DOMAIN_SSL",
    title: "اتصال دامنه و SSL",
    description: "اتصال دامنه و گواهی HTTPS با آزمون دسترسی.",
    defaultPriceRial: 3_000_000n,
  },
  {
    code: "BACKUP_RESTORE",
    title: "بکاپ اولیه و آزمون بازگردانی",
    description: "بکاپ اول و یک بار آزمون Restore برای اطمینان.",
    defaultPriceRial: 5_000_000n,
  },
  {
    code: "ARCHITECTURE_LIGHT",
    title: "همراهی معماری سبک",
    description: "بربررسی کوتاه معماری قبل از خرید سرور بزرگ‌تر.",
    defaultPriceRial: 10_000_000n,
  },
];

function parsePriceMap(value: unknown): Partial<Record<CompassServicePackageCode, bigint>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Partial<Record<CompassServicePackageCode, bigint>> = {};
  for (const pack of DEFAULTS) {
    const raw = (value as Record<string, unknown>)[pack.code];
    if (typeof raw === "string" || typeof raw === "number") {
      try {
        const amount = BigInt(raw);
        if (amount >= 0n) out[pack.code] = amount;
      } catch {
        // ignore invalid admin override
      }
    }
  }
  return out;
}

export async function listCompassServicePackages(): Promise<
  CompassServicePackage[]
> {
  const commerce = await prisma.commercePricingConfig.findUnique({
    where: { id: "default" },
    select: { compassServicePrices: true },
  });
  const overrides = parsePriceMap(commerce?.compassServicePrices);
  return DEFAULTS.map((pack) => ({
    code: pack.code,
    title: pack.title,
    description: pack.description,
    priceRial: overrides[pack.code] ?? pack.defaultPriceRial,
    active: true,
  }));
}

/** Infer service packages from conversation answers (Launch: always with a server). */
export function selectCompassServicePackages(
  answers: RecommendationAnswers,
  packages: CompassServicePackage[],
  architectureEscalation: boolean,
): CompassServicePackage[] {
  const byCode = new Map(packages.map((pack) => [pack.code, pack]));
  const selected = new Set<CompassServicePackageCode>();

  if (answers.project === "migration" || answers.stage === "migration") {
    selected.add("SITE_MIGRATION");
  }
  if (
    answers.management === "managed" ||
    answers.management === "unknown" ||
    answers.stage === "idea"
  ) {
    selected.add("INITIAL_SETUP");
  }
  if (
    answers.domainReady === "no" ||
    answers.domainReady === "unknown" ||
    answers.project === "site" ||
    answers.project === "commerce"
  ) {
    selected.add("DOMAIN_SSL");
  }
  if (
    answers.criticality === "high" ||
    answers.criticality === "severe" ||
    answers.project === "commerce" ||
    answers.project === "data"
  ) {
    selected.add("BACKUP_RESTORE");
  }
  if (
    architectureEscalation ||
    answers.project === "api" ||
    answers.project === "product" ||
    answers.staging === "yes"
  ) {
    selected.add("ARCHITECTURE_LIGHT");
  }

  // Always surface at least one service path for Compass (separate from Chinish).
  if (selected.size === 0) {
    selected.add("INITIAL_SETUP");
  }

  return [...selected]
    .map((code) => byCode.get(code))
    .filter((pack): pack is CompassServicePackage => Boolean(pack));
}

export function serializeCompassServicePackages(
  packages: CompassServicePackage[],
) {
  return packages.map((pack) => ({
    code: pack.code,
    title: pack.title,
    description: pack.description,
    priceRial: pack.priceRial.toString(),
    priceTomanFa: (pack.priceRial / 10n).toLocaleString("fa-IR"),
    active: pack.active,
  }));
}
