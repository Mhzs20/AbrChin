import type { ParchinLevel, ParchinPricingConfig } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  DEFAULT_PARCHIN_SERVICE_CONTRACTS,
  toParchinServiceContract,
  type ParchinServiceContract,
} from "@/lib/parchin/service-contract";
import { isParchinConfigSellable } from "@/lib/parchin/sellable";

export type PublicParchinCatalogStatus =
  | "available"
  | "pending"
  | "unavailable";

export type PublicParchinCatalogReason =
  | "ok"
  | "database_failure"
  | "missing_evidence"
  | "inactive";

export type PublicParchinCard = ParchinServiceContract & {
  sellable: boolean;
  evidenceApproved: boolean;
};

export type PublicParchinCatalog = {
  status: PublicParchinCatalogStatus;
  reason: PublicParchinCatalogReason;
  contracts: PublicParchinCard[];
};

const LEVELS: ParchinLevel[] = [
  "PARCHIN_START",
  "PARCHIN_ACTIVE",
  "PARCHIN_STABLE",
];

function pendingCard(level: ParchinLevel): PublicParchinCard {
  const base = DEFAULT_PARCHIN_SERVICE_CONTRACTS[level];
  return {
    ...base,
    monthlyPriceRial: "0",
    active: false,
    effectiveFrom: new Date(0).toISOString(),
    sellable: false,
    evidenceApproved: false,
    includedServices: [
      "این سطح هنوز برای فروش عمومی فعال نیست.",
      "تعهد زمان پاسخ، پایش، بکاپ یا Restore فقط پس از قرارداد تأییدشده و شواهد عملیاتی اعلام می‌شود.",
    ],
    excludedServices: [
      "پایش ۲۴/۷",
      "پایش پنج‌دقیقه‌ای",
      "بکاپ روزانه مدیریت‌شده",
      "آزمون Restore ماهانه",
      "پاسخ سی‌دقیقه‌ای رخداد",
    ],
    firstResponseTarget: "اعلام‌نشده تا تأیید شواهد",
    supportWindow: "اعلام‌نشده تا تأیید شواهد",
    operationalPolicy: {
      ...base.operationalPolicy,
      monitoringIntervalMinutes: null,
      consecutiveFailuresBeforeAlert: null,
      backupIntervalHours: null,
      backupRetentionCopies: null,
      restoreCadence: "excluded",
      p1ResponseMinutes: null,
    },
  };
}

function toPublicCard(row: ParchinPricingConfig): PublicParchinCard {
  const contract = toParchinServiceContract(row);
  const evidenceApproved = Boolean(row.operationalEvidenceApprovedAt);
  const sellable = isParchinConfigSellable(row, { allowTestBypass: false });
  if (!sellable) {
    return {
      ...pendingCard(row.level),
      title: contract.title,
      subtitle: "در انتظار شواهد عملیاتی",
      description:
        "قیمت یا سطح در کاتالوگ به‌معنی فعال‌بودن تعهد عملیاتی نیست. تا تأیید قرارداد و شواهد، این سطح فروخته نمی‌شود.",
      monthlyPriceRial: "0",
    };
  }
  return {
    ...contract,
    active: true,
    sellable: true,
    evidenceApproved,
  };
}

export async function loadPublicParchinCatalog(): Promise<PublicParchinCatalog> {
  let rows: ParchinPricingConfig[];
  try {
    rows = await prisma.parchinPricingConfig.findMany({
      orderBy: { level: "asc" },
    });
  } catch {
    return {
      status: "unavailable",
      reason: "database_failure",
      contracts: LEVELS.map(pendingCard),
    };
  }

  const contracts = LEVELS.map((level) => {
    const row = rows.find((item) => item.level === level);
    return row ? toPublicCard(row) : pendingCard(level);
  });
  const anySellable = contracts.some((item) => item.sellable);
  if (anySellable) {
    return { status: "available", reason: "ok", contracts };
  }
  if (rows.length === 0) {
    return { status: "pending", reason: "missing_evidence", contracts };
  }
  if (rows.some((row) => row.active)) {
    return { status: "pending", reason: "missing_evidence", contracts };
  }
  return { status: "pending", reason: "inactive", contracts };
}
