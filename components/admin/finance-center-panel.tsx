"use client";

import {
  Calculator,
  Compass,
  Percent,
  Shield,
  Ticket,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CouponsPanel } from "@/components/admin/coupons-panel";
import { SectionCard, StatusBadge } from "@/components/product";
import {
  HIGH_MARGIN_CONFIRMATION_PHRASE,
  grossMarginBpsToMarkupBps,
  markupBpsToGrossMarginBps,
} from "@/lib/pricing/commercial-engine";

type ProviderCode = "ARVAN" | "PARSPACK";
type ProductKindCode = "CLOUD_SERVER" | "READY_INSTANT_SERVER";
type ParchinLevelCode = "PARCHIN_START" | "PARCHIN_ACTIVE" | "PARCHIN_STABLE";

type CouponRow = {
  id: string;
  code: string;
  type: "SERVER_PURCHASE" | "WALLET_BONUS";
  scope: "PUBLIC" | "USER";
  discountBps: number | null;
  termMonths: number | null;
  minDepositRial: string | null;
  bonusRial: string | null;
  expiresAt: string | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  active: boolean;
};

type InitialConfiguration = {
  providers: Array<{
    provider: ProviderCode;
    markupBasisPoints: number;
    targetGrossMarginBps: number;
    enabled: boolean;
  }>;
  productMarkups: Array<{
    provider: string;
    apiVersion: string;
    productKind: ProductKindCode;
    markupBasisPoints: number;
    enabled: boolean;
  }>;
  taxBps: number;
  reminderDaysBeforeDue: number;
  suspendGraceDaysAfterZero: number;
  deleteDaysAfterSuspend: number;
  compassServicePrices: Record<string, string>;
  parchin: Array<{
    level: ParchinLevelCode;
    title: string;
    description: string | null;
    priceRial: string;
    active: boolean;
  }>;
  priceDisplay: {
    showHourlyPrice: boolean;
    showDailyPrice: boolean;
    showMonthlyPrice: boolean;
  };
  revisions: Array<{
    id: string;
    createdAt: string;
    reason: string | null;
    rollbackOfId: string | null;
    actorMobile: string | null;
  }>;
};

type PreviewBreakdown = {
  providerCostRial: string;
  providerMarkupRial: string;
  productMarkupRial: string;
  totalMarkupRial: string;
  parchinRial: string;
  addonsRial: string;
  subtotalBeforeDiscountRial: string;
  discountRial: string;
  taxableRial: string;
  taxRial: string;
  finalPriceRial: string;
  renewalPriceRial: string;
  effectiveMarkupBps: number;
  grossMarginBps: number;
  termMonths: 1 | 3 | 6 | 12;
  termDiscountBps: number;
  discountSource: "none" | "term" | "coupon";
  lineItems: Array<{
    type: string;
    label: string;
    amountIrr: string;
  }>;
};

type PreviewResponse = {
  guardrails: {
    level: "ok" | "warn" | "confirm";
    providerLevels: Array<{
      provider: ProviderCode;
      marginBps: number;
      markupBps: number;
      level: "ok" | "warn" | "confirm";
    }>;
  };
  simulation: {
    providerEnabled: boolean;
    productEnabled: boolean;
    breakdown: PreviewBreakdown;
  } | null;
  impact: {
    sampledPlans: number;
    affectedPlans: number;
    increasedPlans: number;
    decreasedPlans: number;
    unchangedPlans: number;
    notSellablePlans: number;
    topIncreases: ImpactRow[];
    topDecreases: ImpactRow[];
    rows: ImpactRow[];
  } | null;
  parity: {
    ok: boolean;
    mismatches: Array<{ planId: string; card: string; quote: string }>;
    sampled: number;
  } | null;
};

type ImpactRow = {
  planId: string;
  title: string;
  provider: string;
  currentFinalRial: string | null;
  candidateFinalRial: string | null;
  deltaRial: string | null;
  deltaBps: number | null;
  sellable: boolean;
};

const SECTIONS = [
  { id: "summary", label: "خلاصه", icon: Calculator },
  { id: "markup", label: "سود و قیمت‌گذاری", icon: TrendingUp },
  { id: "parchin", label: "پرچین", icon: Shield },
  { id: "tax", label: "مالیات و چرخه", icon: Percent },
  { id: "compass", label: "قطب‌نما", icon: Compass },
  { id: "coupons", label: "کد تخفیف", icon: Ticket },
] as const;

type FinanceSectionId = (typeof SECTIONS)[number]["id"];

const serviceLabels: Record<string, string> = {
  SITE_MIGRATION: "انتقال سایت/سورس",
  INITIAL_SETUP: "راه‌اندازی اولیه",
  DOMAIN_SSL: "دامنه و SSL",
  BACKUP_RESTORE: "بکاپ و آزمون بازگردانی",
  ARCHITECTURE_LIGHT: "همراهی معماری سبک",
};

function providerLabel(provider: ProviderCode) {
  return provider === "PARSPACK" ? "ParsPack" : "Arvan";
}

function productKindLabel(kind: ProductKindCode) {
  return kind === "CLOUD_SERVER" ? "سرور ابری" : "سرور آماده";
}

function parchinLevelLabel(level: ParchinLevelCode) {
  if (level === "PARCHIN_START") return "سطح ۱ · نو / شروع";
  if (level === "PARCHIN_ACTIVE") return "سطح ۲ · استوار / فعال";
  return "سطح ۳ · کهکشان / پایدار";
}

function rialToTomanDigits(rial: string) {
  try {
    return (BigInt(rial) / 10n).toString();
  } catch {
    return "0";
  }
}

function tomanDigitsToRial(toman: string): string {
  const cleaned = toman.replace(/[^\d]/g, "") || "0";
  return (BigInt(cleaned) * 10n).toString();
}

function percentToBps(percent: string): number | null {
  const raw = percent.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  const bps =
    Number.parseInt(whole, 10) * 100 +
    Number.parseInt(fraction.padEnd(2, "0") || "0", 10);
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 100_000) return null;
  return bps;
}

function bpsToPercent(bps: number) {
  const whole = Math.floor(bps / 100);
  const fraction = bps % 100;
  return fraction === 0
    ? String(whole)
    : `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}

function faDigits(value: string) {
  const cleaned = value.replace(/[^\d]/g, "");
  if (!cleaned) return "";
  return Number(cleaned).toLocaleString("fa-IR");
}

function formatTomanFromRialString(rial: string) {
  try {
    const value = BigInt(rial);
    const negative = value < 0n;
    const toman = (negative ? -value : value) / 10n;
    return `${negative ? "−" : ""}${toman.toLocaleString("fa-IR")} تومان`;
  } catch {
    return "—";
  }
}

export function FinanceCenterPanel({
  initialConfiguration,
  initialCoupons,
}: {
  initialConfiguration: InitialConfiguration;
  initialCoupons: CouponRow[];
}) {
  const [providers, setProviders] = useState(
    initialConfiguration.providers.map((item) => ({
      provider: item.provider,
      marginPercent: bpsToPercent(item.targetGrossMarginBps),
      enabled: item.enabled,
    })),
  );
  const [productMarkups, setProductMarkups] = useState(
    initialConfiguration.productMarkups
      .filter(
        (item): item is typeof item & { provider: ProviderCode } =>
          item.provider === "ARVAN" || item.provider === "PARSPACK",
      )
      .map((item) => ({
        provider: item.provider,
        productKind: item.productKind,
        markupPercent: bpsToPercent(item.markupBasisPoints),
        enabled: item.enabled,
      })),
  );
  const [taxPercent, setTaxPercent] = useState(
    bpsToPercent(initialConfiguration.taxBps),
  );
  const [lifecycle, setLifecycle] = useState({
    reminderDaysBeforeDue: initialConfiguration.reminderDaysBeforeDue,
    suspendGraceDaysAfterZero: initialConfiguration.suspendGraceDaysAfterZero,
    deleteDaysAfterSuspend: initialConfiguration.deleteDaysAfterSuspend,
  });
  const [compassPricesToman, setCompassPricesToman] = useState<
    Record<string, string>
  >(() =>
    Object.fromEntries(
      Object.keys(serviceLabels).map((code) => [
        code,
        rialToTomanDigits(
          initialConfiguration.compassServicePrices[code] ?? "0",
        ),
      ]),
    ),
  );
  const [parchin, setParchin] = useState(
    initialConfiguration.parchin.map((item) => ({
      ...item,
      priceToman: rialToTomanDigits(item.priceRial),
    })),
  );
  const [priceDisplay, setPriceDisplay] = useState(
    initialConfiguration.priceDisplay,
  );
  const [revisions, setRevisions] = useState(initialConfiguration.revisions);

  const [activeSection, setActiveSection] =
    useState<FinanceSectionId>("summary");
  const [simOpenMobile, setSimOpenMobile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [publishReview, setPublishReview] = useState<PreviewResponse | null>(
    null,
  );
  const [publishReason, setPublishReason] = useState("");
  const [highMarginText, setHighMarginText] = useState("");

  const serialized = JSON.stringify({
    providers,
    productMarkups,
    taxPercent,
    lifecycle,
    compassPricesToman,
    parchin,
    priceDisplay,
  });
  const [baselineSerialized, setBaselineSerialized] = useState(serialized);
  const dirty = serialized !== baselineSerialized;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeSection]);

  // ---- Simulator (server-computed via the production engine) ----
  const [simCostToman, setSimCostToman] = useState("300000");
  const [simProvider, setSimProvider] = useState<ProviderCode>("ARVAN");
  const [simProductKind, setSimProductKind] =
    useState<ProductKindCode>("CLOUD_SERVER");
  const [simTerm, setSimTerm] = useState<1 | 3 | 6 | 12>(3);
  const [simParchin, setSimParchin] =
    useState<ParchinLevelCode>("PARCHIN_START");
  const [simCouponPercent, setSimCouponPercent] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState("");

  const buildCandidate = useCallback(() => {
    const providerRows = providers.map((item) => ({
      provider: item.provider,
      targetGrossMarginBps: percentToBps(item.marginPercent),
      enabled: item.enabled,
    }));
    if (providerRows.some((row) => row.targetGrossMarginBps == null)) {
      return null;
    }
    const productRows = productMarkups.map((item) => ({
      provider: item.provider,
      productKind: item.productKind,
      markupBasisPoints: percentToBps(item.markupPercent),
      enabled: item.enabled,
    }));
    if (productRows.some((row) => row.markupBasisPoints == null)) return null;
    const taxBps = percentToBps(taxPercent);
    if (taxBps == null || taxBps > 10_000) return null;
    return {
      providers: providerRows,
      productMarkups: productRows,
      taxBps,
      reminderDaysBeforeDue: lifecycle.reminderDaysBeforeDue,
      suspendGraceDaysAfterZero: lifecycle.suspendGraceDaysAfterZero,
      deleteDaysAfterSuspend: lifecycle.deleteDaysAfterSuspend,
      compassServicePrices: Object.fromEntries(
        Object.keys(serviceLabels).map((code) => [
          code,
          tomanDigitsToRial(compassPricesToman[code] ?? "0"),
        ]),
      ),
      parchin: parchin.map((item) => ({
        level: item.level,
        title: item.title,
        description: item.description,
        priceRial: tomanDigitsToRial(item.priceToman),
        active: item.active,
      })),
      priceDisplay,
    };
  }, [
    compassPricesToman,
    lifecycle,
    parchin,
    priceDisplay,
    productMarkups,
    providers,
    taxPercent,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const candidate = buildCandidate();
      const cost = simCostToman.replace(/[^\d]/g, "");
      if (!candidate || !cost) {
        setPreview(null);
        return;
      }
      try {
        setPreviewError("");
        const response = await fetch("/api/admin/finance/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            candidate,
            simulator: {
              providerMonthlyCostRial: (BigInt(cost) * 10n).toString(),
              provider: simProvider,
              productKind: simProductKind,
              termMonths: simTerm,
              parchinLevel: simParchin,
              couponDiscountBps: simCouponPercent.trim()
                ? percentToBps(simCouponPercent)
                : null,
            },
          }),
        });
        const body = (await response.json()) as PreviewResponse & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(body.error ?? "پیش‌نمایش ممکن نشد.");
        }
        setPreview(body);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setPreview(null);
        setPreviewError(
          caught instanceof Error ? caught.message : "پیش‌نمایش ممکن نشد.",
        );
      }
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [
    buildCandidate,
    simCostToman,
    simCouponPercent,
    simParchin,
    simProductKind,
    simProvider,
    simTerm,
  ]);

  const guardrailLevel = preview?.guardrails.level ?? "ok";

  const overview = useMemo(() => {
    const arvan = providers.find((item) => item.provider === "ARVAN");
    const parspack = providers.find((item) => item.provider === "PARSPACK");
    const parchinStart = parchin.find(
      (item) => item.level === "PARCHIN_START",
    );
    const activeCoupons = initialCoupons.filter(
      (coupon) => coupon.active,
    ).length;
    return { arvan, parspack, parchinStart, activeCoupons };
  }, [initialCoupons, parchin, providers]);

  function equivalentMarkupPercent(marginPercent: string): string | null {
    const marginBps = percentToBps(marginPercent);
    if (marginBps == null || marginBps >= 10_000) return null;
    try {
      return bpsToPercent(grossMarginBpsToMarkupBps(marginBps));
    } catch {
      return null;
    }
  }

  async function startPublishReview() {
    const candidate = buildCandidate();
    if (!candidate) {
      setError("مقدارهای واردشده معتبر نیستند.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/finance/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate, includeImpact: true }),
      });
      const body = (await response.json()) as PreviewResponse & {
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "بررسی اثر ممکن نشد.");
      setPublishReview(body);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "بررسی اثر ممکن نشد.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function publishConfiguration() {
    const candidate = buildCandidate();
    if (!candidate) {
      setError("مقدارهای واردشده معتبر نیستند.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/finance/configuration", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          ...candidate,
          reason: publishReason.trim() || null,
          highMarginConfirmation: highMarginText.trim() || null,
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        revisionId?: string;
        configuration?: InitialConfiguration;
      };
      if (!response.ok) throw new Error(body.error ?? "انتشار ممکن نشد.");
      setBaselineSerialized(serialized);
      if (body.configuration) setRevisions(body.configuration.revisions);
      setPublishReview(null);
      setPublishReason("");
      setHighMarginText("");
      setMessage("تنظیمات مالی منتشر شد و روی فروش‌های بعدی اعمال می‌شود.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "انتشار ممکن نشد.");
    } finally {
      setSaving(false);
    }
  }

  async function rollbackTo(revisionId: string) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/finance/configuration", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ rollbackToRevisionId: revisionId }),
      });
      const body = (await response.json()) as {
        error?: string;
        configuration?: InitialConfiguration;
      };
      if (!response.ok) throw new Error(body.error ?? "بازگشت ممکن نشد.");
      if (body.configuration) {
        applyConfiguration(body.configuration);
        setRevisions(body.configuration.revisions);
      }
      setMessage("تنظیمات به نسخه انتخاب‌شده بازگشت و منتشر شد.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "بازگشت ممکن نشد.");
    } finally {
      setSaving(false);
    }
  }

  function applyConfiguration(configuration: InitialConfiguration) {
    setProviders(
      configuration.providers.map((item) => ({
        provider: item.provider,
        marginPercent: bpsToPercent(item.targetGrossMarginBps),
        enabled: item.enabled,
      })),
    );
    setProductMarkups(
      configuration.productMarkups
        .filter(
          (item): item is typeof item & { provider: ProviderCode } =>
            item.provider === "ARVAN" || item.provider === "PARSPACK",
        )
        .map((item) => ({
          provider: item.provider,
          productKind: item.productKind,
          markupPercent: bpsToPercent(item.markupBasisPoints),
          enabled: item.enabled,
        })),
    );
    setTaxPercent(bpsToPercent(configuration.taxBps));
    setLifecycle({
      reminderDaysBeforeDue: configuration.reminderDaysBeforeDue,
      suspendGraceDaysAfterZero: configuration.suspendGraceDaysAfterZero,
      deleteDaysAfterSuspend: configuration.deleteDaysAfterSuspend,
    });
    setCompassPricesToman(
      Object.fromEntries(
        Object.keys(serviceLabels).map((code) => [
          code,
          rialToTomanDigits(configuration.compassServicePrices[code] ?? "0"),
        ]),
      ),
    );
    setParchin(
      configuration.parchin.map((item) => ({
        ...item,
        priceToman: rialToTomanDigits(item.priceRial),
      })),
    );
    setPriceDisplay(configuration.priceDisplay);
    // New values become the saved baseline.
    setBaselineSerialized(JSON.stringify({
      providers: configuration.providers.map((item) => ({
        provider: item.provider,
        marginPercent: bpsToPercent(item.targetGrossMarginBps),
        enabled: item.enabled,
      })),
      productMarkups: configuration.productMarkups
        .filter(
          (item) => item.provider === "ARVAN" || item.provider === "PARSPACK",
        )
        .map((item) => ({
          provider: item.provider,
          productKind: item.productKind,
          markupPercent: bpsToPercent(item.markupBasisPoints),
          enabled: item.enabled,
        })),
      taxPercent: bpsToPercent(configuration.taxBps),
      lifecycle: {
        reminderDaysBeforeDue: configuration.reminderDaysBeforeDue,
        suspendGraceDaysAfterZero: configuration.suspendGraceDaysAfterZero,
        deleteDaysAfterSuspend: configuration.deleteDaysAfterSuspend,
      },
      compassPricesToman: Object.fromEntries(
        Object.keys(serviceLabels).map((code) => [
          code,
          rialToTomanDigits(configuration.compassServicePrices[code] ?? "0"),
        ]),
      ),
      parchin: configuration.parchin.map((item) => ({
        ...item,
        priceToman: rialToTomanDigits(item.priceRial),
      })),
      priceDisplay: configuration.priceDisplay,
    }));
  }

  const breakdown = preview?.simulation?.breakdown ?? null;
  const shareBps = useMemo(() => {
    if (!breakdown) return null;
    try {
      const final = BigInt(breakdown.finalPriceRial);
      if (final <= 0n) return null;
      const cost = Number((BigInt(breakdown.providerCostRial) * 10_000n) / final) / 100;
      const profit =
        Number((BigInt(breakdown.totalMarkupRial) * 10_000n) / final) / 100;
      return {
        cost,
        profit,
        rest: Math.max(0, 100 - cost - profit),
      };
    } catch {
      return null;
    }
  }, [breakdown]);

  const simulatorPanel = (
    <div className="finance-simulator">
      <div className="finance-simulator-head">
        <h3>شبیه‌ساز مبلغ فروش</h3>
        <p>
          محاسبه با موتور واقعی سرور انجام می‌شود؛ همان فرمول Quote و Checkout.
        </p>
      </div>
      <div className="finance-sim-fields">
        <label className="pricing-field">
          <span>قیمت خرید ماهانه (تومان)</span>
          <input
            inputMode="numeric"
            value={simCostToman}
            onChange={(event) => setSimCostToman(event.target.value)}
          />
          <span className="pricing-field-hint">
            {faDigits(simCostToman)
              ? `${faDigits(simCostToman)} تومان`
              : "عدد نمونه از کاتالوگ Provider"}
          </span>
        </label>
        <label className="pricing-field">
          <span>منبع</span>
          <select
            value={simProvider}
            onChange={(event) =>
              setSimProvider(event.target.value as ProviderCode)
            }
          >
            <option value="ARVAN">Arvan</option>
            <option value="PARSPACK">ParsPack</option>
          </select>
        </label>
        <label className="pricing-field">
          <span>نوع محصول</span>
          <select
            value={simProductKind}
            onChange={(event) =>
              setSimProductKind(event.target.value as ProductKindCode)
            }
          >
            <option value="CLOUD_SERVER">سرور ابری</option>
            <option value="READY_INSTANT_SERVER">سرور آماده</option>
          </select>
        </label>
        <label className="pricing-field">
          <span>مدت</span>
          <select
            value={simTerm}
            onChange={(event) =>
              setSimTerm(Number(event.target.value) as 1 | 3 | 6 | 12)
            }
          >
            <option value={1}>۱ ماه</option>
            <option value={3}>۳ ماه (۵٪ تخفیف)</option>
            <option value={6}>۶ ماه (۱۰٪ تخفیف)</option>
            <option value={12}>۱۲ ماه (۲۰٪ تخفیف)</option>
          </select>
        </label>
        <label className="pricing-field">
          <span>پرچین</span>
          <select
            value={simParchin}
            onChange={(event) =>
              setSimParchin(event.target.value as ParchinLevelCode)
            }
          >
            {parchin.map((item) => (
              <option key={item.level} value={item.level}>
                {item.title || parchinLevelLabel(item.level)}
              </option>
            ))}
          </select>
        </label>
        <label className="pricing-field">
          <span>کد تخفیف ٪ (اختیاری)</span>
          <input
            inputMode="decimal"
            placeholder="خالی = تخفیف ثابت دوره"
            value={simCouponPercent}
            onChange={(event) => setSimCouponPercent(event.target.value)}
          />
        </label>
      </div>

      {breakdown ? (
        <div className="finance-sim-result">
          <div className="finance-sim-lines">
            <div className="finance-sim-line finance-sim-line--cost">
              <div className="finance-sim-line-label">
                <span>قیمت خرید Provider</span>
                <small>
                  {simTerm.toLocaleString("fa-IR")} ماه ×{" "}
                  {providerLabel(simProvider)}
                </small>
              </div>
              <strong>
                {formatTomanFromRialString(breakdown.providerCostRial)}
              </strong>
            </div>
            <div className="finance-sim-line finance-sim-line--sale">
              <div className="finance-sim-line-label">
                <span>سود Markup منبع</span>
                <small>Markup {providerLabel(simProvider)}</small>
              </div>
              <strong>
                {formatTomanFromRialString(breakdown.providerMarkupRial)}
              </strong>
            </div>
            <div className="finance-sim-line finance-sim-line--sale">
              <div className="finance-sim-line-label">
                <span>سود Markup محصول</span>
                <small>{productKindLabel(simProductKind)} · جمع با منبع</small>
              </div>
              <strong>
                {formatTomanFromRialString(breakdown.productMarkupRial)}
              </strong>
            </div>
            <div className="finance-sim-line finance-sim-line--sale">
              <div className="finance-sim-line-label">
                <span>پرچین</span>
                <small>
                  {parchin.find((item) => item.level === simParchin)?.title ||
                    parchinLevelLabel(simParchin)}
                </small>
              </div>
              <strong>{formatTomanFromRialString(breakdown.parchinRial)}</strong>
            </div>
            <div className="finance-sim-line">
              <div className="finance-sim-line-label">
                <span>
                  {breakdown.discountSource === "coupon"
                    ? "تخفیف کد (جایگزین ۵/۱۰/۲۰)"
                    : `تخفیف دوره ${breakdown.termMonths.toLocaleString("fa-IR")} ماهه`}
                </span>
                <small>{bpsToPercent(breakdown.termDiscountBps)}٪</small>
              </div>
              <strong>
                {formatTomanFromRialString(`-${breakdown.discountRial}`)}
              </strong>
            </div>
            <div className="finance-sim-line">
              <div className="finance-sim-line-label">
                <span>مالیات VAT</span>
                <small>{taxPercent}٪ پس از تخفیف</small>
              </div>
              <strong>{formatTomanFromRialString(breakdown.taxRial)}</strong>
            </div>
          </div>
          <div className="finance-sim-total">
            <div>
              <span>مبلغ نهایی مشتری</span>
              <strong className="money-tone money-tone--sale">
                {formatTomanFromRialString(breakdown.finalPriceRial)}
              </strong>
            </div>
            <div>
              <span>حاشیه سود واقعی</span>
              <strong>
                {bpsToPercent(breakdown.grossMarginBps)}٪ از فروش زیرساخت
              </strong>
            </div>
            {shareBps ? (
              <>
                <div
                  className="finance-share-bar"
                  role="img"
                  aria-label={`سهم خرید ${shareBps.cost}٪، سهم سود ${shareBps.profit}٪`}
                >
                  <span
                    className="finance-share-bar-cost"
                    style={{ width: `${shareBps.cost}%` }}
                  />
                  <span
                    className="finance-share-bar-profit"
                    style={{ width: `${shareBps.profit}%` }}
                  />
                </div>
                <p className="finance-share-legend">
                  <span className="finance-legend-item finance-legend-item--cost">
                    خرید {shareBps.cost.toLocaleString("fa-IR")}٪
                  </span>
                  <span className="finance-legend-item finance-legend-item--profit">
                    سود {shareBps.profit.toLocaleString("fa-IR")}٪
                  </span>
                  <span className="finance-legend-item">
                    پرچین و مالیات {shareBps.rest.toLocaleString("fa-IR")}٪
                  </span>
                </p>
              </>
            ) : null}
            {preview?.simulation &&
            (!preview.simulation.providerEnabled ||
              !preview.simulation.productEnabled) ? (
              <p className="pricing-save-err">
                توجه: Markup {providerLabel(simProvider)} یا نوع محصول غیرفعال
                است؛ فروش واقعی این ترکیب قیمت نمی‌گیرد.
              </p>
            ) : null}
          </div>
        </div>
      ) : previewError ? (
        <p className="pricing-save-err">{previewError}</p>
      ) : (
        <p className="product-muted">قیمت خرید نمونه را وارد کن.</p>
      )}
    </div>
  );

  return (
    <div className="finance-center">
      <div className="finance-overview" role="list" aria-label="خلاصه مرکز مالی">
        <div className="finance-overview-chip" role="listitem">
          <span>حاشیه سود Arvan</span>
          <strong className="money-tone--sale">
            {overview.arvan ? `${overview.arvan.marginPercent}٪` : "—"}
          </strong>
          <small>{overview.arvan?.enabled ? "فعال" : "خاموش"}</small>
        </div>
        <div className="finance-overview-chip" role="listitem">
          <span>حاشیه سود ParsPack</span>
          <strong className="money-tone--sale">
            {overview.parspack ? `${overview.parspack.marginPercent}٪` : "—"}
          </strong>
          <small>{overview.parspack?.enabled ? "فعال" : "خاموش"}</small>
        </div>
        <div className="finance-overview-chip" role="listitem">
          <span>مالیات VAT</span>
          <strong>{taxPercent}٪</strong>
          <small>روی مبلغ پس از تخفیف</small>
        </div>
        <div className="finance-overview-chip" role="listitem">
          <span>پرچین شروع</span>
          <strong>
            {overview.parchinStart
              ? `${faDigits(overview.parchinStart.priceToman) || "۰"} تومان`
              : "—"}
          </strong>
          <small>ماهانه · داخل قیمت کارت و Quote</small>
        </div>
        <div className="finance-overview-chip" role="listitem">
          <span>کدهای تخفیف فعال</span>
          <strong>{overview.activeCoupons.toLocaleString("fa-IR")}</strong>
          <small>
            از {initialCoupons.length.toLocaleString("fa-IR")} کد اخیر
          </small>
        </div>
      </div>

      <nav className="finance-nav" aria-label="بخش‌های مرکز مالی" role="tablist">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          const selected = activeSection === section.id;
          return (
            <button
              key={section.id}
              type="button"
              role="tab"
              id={`finance-tab-${section.id}`}
              aria-selected={selected}
              aria-controls={`finance-panel-${section.id}`}
              className={
                selected
                  ? "finance-nav-pill finance-nav-pill--active"
                  : "finance-nav-pill"
              }
              onClick={() => setActiveSection(section.id)}
            >
              <Icon size={15} aria-hidden="true" />
              {section.label}
            </button>
          );
        })}
      </nav>

      <div className="finance-workspace">
        <div className="finance-main">
          {activeSection === "summary" ? (
            <section
              id="finance-panel-summary"
              role="tabpanel"
              aria-labelledby="finance-tab-summary"
              className="finance-section"
            >
              <SectionCard title="وضعیت فعلی قیمت‌گذاری">
                <p className="pricing-rules-lead finance-formula-line">
                  <strong className="money-tone--cost">خرید Provider</strong>
                  {" + "}
                  <strong className="money-tone--sale">سود منبع</strong>
                  {" + "}
                  <strong className="money-tone--sale">سود محصول</strong>
                  {" + "}
                  <strong className="money-tone--sale">پرچین</strong>
                  {" × مدت − تخفیف + VAT = "}
                  <strong className="money-tone--sale">مبلغ مشتری</strong>
                </p>
                <p className="pricing-field-hint">
                  همین فرمول در کارت، Quote، پرداخت و تمدید اجرا می‌شود؛ کارت و
                  Quote یک‌ماهه همیشه برابرند. تغییرها فقط بعد از انتشار روی
                  فروش بعدی اثر می‌گذارند و Snapshot سفارش‌های قبلی ثابت می‌ماند.
                </p>

                <div className="finance-next-actions">
                  <button
                    type="button"
                    className="product-btn product-btn--primary"
                    onClick={() => setActiveSection("markup")}
                  >
                    تنظیم حاشیه سود
                  </button>
                  <button
                    type="button"
                    className="product-btn product-btn--quiet"
                    onClick={() => setActiveSection("parchin")}
                  >
                    تنظیم پرچین
                  </button>
                  <button
                    type="button"
                    className="product-btn product-btn--quiet"
                    onClick={() => setActiveSection("coupons")}
                  >
                    کد تخفیف
                  </button>
                </div>

                <h3 className="finance-subtitle">نسخه‌های منتشرشده</h3>
                {revisions.length === 0 ? (
                  <p className="product-muted">
                    هنوز نسخه‌ای منتشر نشده است؛ اولین انتشار از دکمه پایین صفحه
                    ثبت می‌شود.
                  </p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table className="product-table">
                      <thead>
                        <tr>
                          <th>زمان</th>
                          <th>دلیل</th>
                          <th>Actor</th>
                          <th>عملیات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {revisions.slice(0, 8).map((revision, index) => (
                          <tr key={revision.id}>
                            <td>
                              {new Date(revision.createdAt).toLocaleString(
                                "fa-IR",
                              )}
                              {revision.rollbackOfId ? " · بازگشت" : ""}
                            </td>
                            <td>{revision.reason ?? "—"}</td>
                            <td dir="ltr">{revision.actorMobile ?? "—"}</td>
                            <td>
                              {index === 0 ? (
                                <StatusBadge label="فعلی" tone="success" />
                              ) : (
                                <button
                                  type="button"
                                  className="product-btn product-btn--quiet"
                                  disabled={saving}
                                  onClick={() => void rollbackTo(revision.id)}
                                >
                                  بازگشت به این نسخه
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>
            </section>
          ) : null}

          {activeSection === "markup" ? (
            <section
              id="finance-panel-markup"
              role="tabpanel"
              aria-labelledby="finance-tab-markup"
              className="finance-section"
            >
              <SectionCard title="حاشیه سود هدف و Markup">
                <p className="pricing-rules-lead">
                  ورودی اصلی «حاشیه سود هدف» است: سهم سود از قیمت فروش زیرساخت.
                  Markup معادل به‌صورت خودکار محاسبه و روی قیمت خرید اعمال
                  می‌شود. پیش‌فرض لانچ ۳۰٪ حاشیه (Markup ≈ ۴۲٫۸۶٪) است.
                </p>

                <h3 className="finance-subtitle">حاشیه سود منبع</h3>
                <div className="pricing-rules-grid pricing-rules-grid--cards">
                  {providers.map((item, index) => {
                    const equivalent = equivalentMarkupPercent(
                      item.marginPercent,
                    );
                    const marginBps = percentToBps(item.marginPercent);
                    const level =
                      marginBps == null || marginBps >= 10_000
                        ? "invalid"
                        : marginBps >= 7_000
                          ? "confirm"
                          : marginBps >= 5_000
                            ? "warn"
                            : "ok";
                    return (
                      <article
                        className="pricing-product-card"
                        key={item.provider}
                      >
                        <header>
                          <span
                            className="provider-code-badge"
                            data-code={item.provider}
                          >
                            {providerLabel(item.provider)}
                          </span>
                          <StatusBadge
                            label={item.enabled ? "فعال" : "خاموش"}
                            tone={item.enabled ? "success" : "warning"}
                          />
                        </header>
                        <label className="pricing-field">
                          <span>حاشیه سود هدف (٪ از قیمت فروش)</span>
                          <input
                            inputMode="decimal"
                            value={item.marginPercent}
                            onChange={(event) =>
                              setProviders((current) =>
                                current.map((row, rowIndex) =>
                                  rowIndex === index
                                    ? {
                                        ...row,
                                        marginPercent: event.target.value,
                                      }
                                    : row,
                                ),
                              )
                            }
                          />
                          <span className="pricing-field-hint">
                            {equivalent
                              ? `Markup معادل: ${equivalent}٪ روی قیمت خرید`
                              : "عدد بین ۰ تا کمتر از ۱۰۰ با حداکثر دو رقم اعشار"}
                          </span>
                        </label>
                        {level === "confirm" ? (
                          <p className="pricing-save-err">
                            حاشیه ۷۰٪ یا بیشتر: انتشار فقط با تأیید تایپی ممکن
                            است.
                          </p>
                        ) : level === "warn" ? (
                          <p className="finance-dirty-badge">
                            هشدار: حاشیه ۵۰٪ یا بیشتر قیمت نهایی را به‌شدت بالا
                            می‌برد.
                          </p>
                        ) : level === "invalid" ? (
                          <p className="pricing-save-err">
                            حاشیه باید کمتر از ۱۰۰٪ باشد.
                          </p>
                        ) : null}
                        <label className="pricing-check">
                          <input
                            type="checkbox"
                            checked={item.enabled}
                            onChange={(event) =>
                              setProviders((current) =>
                                current.map((row, rowIndex) =>
                                  rowIndex === index
                                    ? {
                                        ...row,
                                        enabled: event.target.checked,
                                      }
                                    : row,
                                ),
                              )
                            }
                          />
                          محاسبه قیمت نهایی برای این منبع فعال باشد
                        </label>
                      </article>
                    );
                  })}
                </div>

                <h3 className="finance-subtitle">Markup نوع محصول</h3>
                <p className="pricing-field-hint" style={{ marginBottom: 12 }}>
                  این درصد روی قیمت خرید محاسبه و به Markup منبع «اضافه»
                  می‌شود؛ جایگزین آن نیست. صفر یعنی فقط Markup منبع.
                </p>
                <div className="pricing-rules-grid pricing-rules-grid--cards">
                  {productMarkups.map((config, index) => {
                    const providerRow = providers.find(
                      (row) => row.provider === config.provider,
                    );
                    const providerMarginBps = providerRow
                      ? percentToBps(providerRow.marginPercent)
                      : null;
                    const providerMarkupBps =
                      providerMarginBps != null && providerMarginBps < 10_000
                        ? grossMarginBpsToMarkupBps(providerMarginBps)
                        : null;
                    const productBps = percentToBps(config.markupPercent);
                    const combined =
                      providerMarkupBps != null && productBps != null
                        ? providerMarkupBps + productBps
                        : null;
                    return (
                      <article
                        className="pricing-product-card"
                        key={`${config.provider}:${config.productKind}`}
                      >
                        <header>
                          <span
                            className="provider-code-badge"
                            data-code={config.provider}
                          >
                            {providerLabel(config.provider)}
                          </span>
                          <strong>{productKindLabel(config.productKind)}</strong>
                        </header>
                        <label className="pricing-field">
                          <span>Markup اضافه محصول (٪ روی قیمت خرید)</span>
                          <input
                            inputMode="decimal"
                            value={config.markupPercent}
                            onChange={(event) =>
                              setProductMarkups((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        markupPercent: event.target.value,
                                      }
                                    : item,
                                ),
                              )
                            }
                          />
                          <span className="pricing-field-hint">
                            {combined != null
                              ? `جمع با منبع: ${bpsToPercent(combined)}٪ Markup ⇒ حاشیه ${bpsToPercent(markupBpsToGrossMarginBps(combined))}٪`
                              : "صفر = فقط Markup منبع اعمال می‌شود"}
                          </span>
                        </label>
                        <label className="pricing-check">
                          <input
                            type="checkbox"
                            checked={config.enabled}
                            onChange={(event) =>
                              setProductMarkups((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        enabled: event.target.checked,
                                      }
                                    : item,
                                ),
                              )
                            }
                          />
                          فعال برای این نوع محصول
                        </label>
                      </article>
                    );
                  })}
                </div>
              </SectionCard>
            </section>
          ) : null}

          {activeSection === "parchin" ? (
            <section
              id="finance-panel-parchin"
              role="tabpanel"
              aria-labelledby="finance-tab-parchin"
              className="finance-section"
            >
              <SectionCard title="پرچین">
                <p className="pricing-rules-lead">
                  قیمت پرچین داخل مبلغ کارت و Quote است. قیمت صفر = رایگان؛
                  غیرفعال = حذف از مسیر فروش. پرچین شروع باید فعال بماند.
                </p>
                <div className="pricing-rules-grid pricing-rules-grid--cards">
                  {parchin.map((config, index) => (
                    <article
                      className="pricing-product-card"
                      key={config.level}
                    >
                      <header>
                        <strong>{parchinLevelLabel(config.level)}</strong>
                        <StatusBadge
                          label={config.active ? "فعال" : "غیرفعال"}
                          tone={config.active ? "success" : "neutral"}
                        />
                      </header>
                      <label className="pricing-field">
                        <span>عنوان نمایش در سایت</span>
                        <input
                          value={config.title}
                          onChange={(event) =>
                            setParchin((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, title: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                      </label>
                      <label className="pricing-field">
                        <span>دامنه خدمات</span>
                        <textarea
                          rows={2}
                          value={config.description ?? ""}
                          onChange={(event) =>
                            setParchin((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      description: event.target.value,
                                    }
                                  : item,
                              ),
                            )
                          }
                        />
                      </label>
                      <label className="pricing-field">
                        <span>قیمت ماهانه (تومان)</span>
                        <input
                          inputMode="numeric"
                          value={config.priceToman}
                          onChange={(event) =>
                            setParchin((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      priceToman: event.target.value,
                                    }
                                  : item,
                              ),
                            )
                          }
                        />
                        <span className="pricing-field-hint">
                          {faDigits(config.priceToman)
                            ? `${faDigits(config.priceToman)} تومان در ماه`
                            : "صفر = رایگان در صورتحساب"}
                        </span>
                      </label>
                      <label className="pricing-check">
                        <input
                          type="checkbox"
                          checked={config.active}
                          onChange={(event) =>
                            setParchin((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      active: event.target.checked,
                                    }
                                  : item,
                              ),
                            )
                          }
                        />
                        فعال در فروش
                      </label>
                    </article>
                  ))}
                </div>
              </SectionCard>
            </section>
          ) : null}

          {activeSection === "tax" ? (
            <section
              id="finance-panel-tax"
              role="tabpanel"
              aria-labelledby="finance-tab-tax"
              className="finance-section"
            >
              <SectionCard title="مالیات، چرخه و نمایش قیمت">
                <div className="pricing-rules-grid">
                  <label className="pricing-field">
                    <span>مالیات VAT (٪)</span>
                    <input
                      inputMode="decimal"
                      value={taxPercent}
                      onChange={(event) => setTaxPercent(event.target.value)}
                    />
                    <span className="pricing-field-hint">
                      پیش‌فرض لانچ ۱۰٪. روی مبلغ پس از تخفیف اعمال می‌شود.
                    </span>
                  </label>
                  <label className="pricing-field">
                    <span>SMS قبل از سررسید (روز)</span>
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={lifecycle.reminderDaysBeforeDue}
                      onChange={(event) =>
                        setLifecycle((current) => ({
                          ...current,
                          reminderDaysBeforeDue: Number(event.target.value),
                        }))
                      }
                    />
                    <span className="pricing-field-hint">
                      یادآوری تمدید به مشتری
                    </span>
                  </label>
                  <label className="pricing-field">
                    <span>مهلت تمدید تا تعلیق (روز)</span>
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={lifecycle.suspendGraceDaysAfterZero}
                      onChange={(event) =>
                        setLifecycle((current) => ({
                          ...current,
                          suspendGraceDaysAfterZero: Number(
                            event.target.value,
                          ),
                        }))
                      }
                    />
                    <span className="pricing-field-hint">
                      پس از صفر شدن کیف پول
                    </span>
                  </label>
                  <label className="pricing-field">
                    <span>روز تا بررسی حذف پس از تعلیق</span>
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={lifecycle.deleteDaysAfterSuspend}
                      onChange={(event) =>
                        setLifecycle((current) => ({
                          ...current,
                          deleteDaysAfterSuspend: Number(event.target.value),
                        }))
                      }
                    />
                    <span className="pricing-field-hint">
                      حذف فقط با Gate عملیاتی Admin
                    </span>
                  </label>
                </div>

                <h3 className="finance-subtitle">نمایش قیمت روی کارت</h3>
                <p className="pricing-field-hint" style={{ marginBottom: 10 }}>
                  قیمت اصلی کارت مبلغ نهایی یک‌ماهه است. ساعتی/روزانه فقط
                  «معادل مصرف» همان مبلغ‌اند، نه مدل پرداخت.
                </p>
                <div className="pricing-rules-grid">
                  <label className="pricing-check">
                    <input
                      type="checkbox"
                      checked={priceDisplay.showMonthlyPrice}
                      onChange={(event) =>
                        setPriceDisplay((current) => ({
                          ...current,
                          showMonthlyPrice: event.target.checked,
                        }))
                      }
                    />
                    نمایش قیمت ماهانه
                  </label>
                  <label className="pricing-check">
                    <input
                      type="checkbox"
                      checked={priceDisplay.showDailyPrice}
                      onChange={(event) =>
                        setPriceDisplay((current) => ({
                          ...current,
                          showDailyPrice: event.target.checked,
                        }))
                      }
                    />
                    نمایش معادل روزانه
                  </label>
                  <label className="pricing-check">
                    <input
                      type="checkbox"
                      checked={priceDisplay.showHourlyPrice}
                      onChange={(event) =>
                        setPriceDisplay((current) => ({
                          ...current,
                          showHourlyPrice: event.target.checked,
                        }))
                      }
                    />
                    نمایش معادل ساعتی
                  </label>
                </div>
              </SectionCard>
            </section>
          ) : null}

          {activeSection === "compass" ? (
            <section
              id="finance-panel-compass"
              role="tabpanel"
              aria-labelledby="finance-tab-compass"
              className="finance-section"
            >
              <SectionCard title="قیمت بسته‌های خدمت قطب‌نما">
                <p className="pricing-rules-lead">
                  مبالغ به تومان هستند و فقط در مسیر خدمت قطب‌نما پیشنهاد
                  می‌شوند — جدا از خرید سرور چینش.
                </p>
                <div className="pricing-rules-grid">
                  {Object.keys(serviceLabels).map((code) => (
                    <label className="pricing-field" key={code}>
                      <span>{serviceLabels[code]}</span>
                      <input
                        inputMode="numeric"
                        value={compassPricesToman[code] ?? ""}
                        onChange={(event) =>
                          setCompassPricesToman((current) => ({
                            ...current,
                            [code]: event.target.value.replace(/\D/g, ""),
                          }))
                        }
                      />
                      <span className="pricing-field-hint">
                        {faDigits(compassPricesToman[code] ?? "")
                          ? `${faDigits(compassPricesToman[code] ?? "")} تومان`
                          : "صفر = بدون پیشنهاد قیمت"}
                      </span>
                    </label>
                  ))}
                </div>
              </SectionCard>
            </section>
          ) : null}

          {activeSection === "coupons" ? (
            <section
              id="finance-panel-coupons"
              role="tabpanel"
              aria-labelledby="finance-tab-coupons"
              className="finance-section"
            >
              <CouponsPanel initial={initialCoupons} />
            </section>
          ) : null}
        </div>

        <aside className="finance-aside" aria-label="شبیه‌ساز مبلغ فروش">
          <div className="finance-aside-desktop">{simulatorPanel}</div>
          <details
            className="finance-aside-mobile"
            open={simOpenMobile}
            onToggle={(event) =>
              setSimOpenMobile((event.target as HTMLDetailsElement).open)
            }
          >
            <summary>
              شبیه‌سازی این قیمت
              {breakdown ? (
                <strong className="money-tone money-tone--sale">
                  {formatTomanFromRialString(breakdown.finalPriceRial)}
                </strong>
              ) : null}
            </summary>
            {simulatorPanel}
          </details>
        </aside>
      </div>

      {activeSection !== "coupons" ? (
        <div className="finance-save-bar">
          {publishReview ? (
            <div className="finance-publish-review">
              <div className="finance-publish-review-head">
                <strong>بررسی اثر پیش از انتشار</strong>
                <button
                  type="button"
                  className="product-btn product-btn--quiet"
                  disabled={saving}
                  onClick={() => setPublishReview(null)}
                >
                  انصراف
                </button>
              </div>
              {publishReview.impact ? (
                <p>
                  از {publishReview.impact.sampledPlans.toLocaleString("fa-IR")}{" "}
                  پلن واقعی نمونه:{" "}
                  {publishReview.impact.increasedPlans.toLocaleString("fa-IR")}{" "}
                  گران‌تر،{" "}
                  {publishReview.impact.decreasedPlans.toLocaleString("fa-IR")}{" "}
                  ارزان‌تر،{" "}
                  {publishReview.impact.unchangedPlans.toLocaleString("fa-IR")}{" "}
                  بدون تغییر
                  {publishReview.impact.notSellablePlans > 0
                    ? ` · ${publishReview.impact.notSellablePlans.toLocaleString("fa-IR")} پلن با این تنظیمات قابل فروش نیست`
                    : ""}
                  .
                </p>
              ) : null}
              {publishReview.impact &&
              (publishReview.impact.topIncreases.length > 0 ||
                publishReview.impact.topDecreases.length > 0) ? (
                <ul className="finance-impact-list">
                  {publishReview.impact.topIncreases.map((row) => (
                    <li key={`inc-${row.planId}`}>
                      بیشترین افزایش: {row.title} —{" "}
                      {formatTomanFromRialString(row.currentFinalRial ?? "0")} ←{" "}
                      {formatTomanFromRialString(row.candidateFinalRial ?? "0")}
                    </li>
                  ))}
                  {publishReview.impact.topDecreases.map((row) => (
                    <li key={`dec-${row.planId}`}>
                      بیشترین کاهش: {row.title} —{" "}
                      {formatTomanFromRialString(row.currentFinalRial ?? "0")} ←{" "}
                      {formatTomanFromRialString(row.candidateFinalRial ?? "0")}
                    </li>
                  ))}
                </ul>
              ) : null}
              {publishReview.parity ? (
                publishReview.parity.ok ? (
                  <p className="pricing-save-ok">
                    برابری Card و Quote یک‌ماهه تأیید شد (
                    {publishReview.parity.sampled.toLocaleString("fa-IR")} پلن).
                  </p>
                ) : (
                  <p className="pricing-save-err">
                    Card و Quote برابر نیستند؛ انتشار مسدود است.
                  </p>
                )
              ) : null}
              {publishReview.guardrails.level === "warn" ? (
                <p className="finance-dirty-badge">
                  هشدار: حاشیه سود ۵۰٪ یا بیشتر تنظیم شده است.
                </p>
              ) : null}
              {publishReview.guardrails.level === "confirm" ? (
                <label className="pricing-field">
                  <span>
                    برای حاشیه ۷۰٪ یا بیشتر، عبارت «
                    {HIGH_MARGIN_CONFIRMATION_PHRASE}» را تایپ کن
                  </span>
                  <input
                    value={highMarginText}
                    onChange={(event) => setHighMarginText(event.target.value)}
                    placeholder={HIGH_MARGIN_CONFIRMATION_PHRASE}
                  />
                </label>
              ) : null}
              <label className="pricing-field">
                <span>دلیل تغییر (در تاریخچه نسخه‌ها ثبت می‌شود)</span>
                <input
                  value={publishReason}
                  onChange={(event) => setPublishReason(event.target.value)}
                  placeholder="مثلاً اصلاح حاشیه لانچ به ۳۰٪"
                />
              </label>
              <button
                className="product-btn product-btn--primary"
                type="button"
                disabled={
                  saving ||
                  publishReview.parity?.ok === false ||
                  (publishReview.guardrails.level === "confirm" &&
                    highMarginText.trim() !== HIGH_MARGIN_CONFIRMATION_PHRASE)
                }
                onClick={() => void publishConfiguration()}
              >
                {saving ? "در حال انتشار…" : "انتشار تنظیمات مالی"}
              </button>
            </div>
          ) : (
            <>
              <button
                className="product-btn product-btn--primary"
                disabled={saving || !dirty}
                onClick={() => void startPublishReview()}
                type="button"
              >
                {saving ? "در حال بررسی…" : "بررسی اثر و انتشار"}
              </button>
              {error ? (
                <p className="pricing-save-err" aria-live="polite">
                  {error}
                </p>
              ) : dirty ? (
                <p className="finance-dirty-badge" aria-live="polite">
                  تغییرات منتشرنشده داری — تا انتشار روی سایت اعمال نمی‌شود.
                  {guardrailLevel === "confirm"
                    ? " (حاشیه بالا: تأیید تایپی لازم است)"
                    : guardrailLevel === "warn"
                      ? " (هشدار حاشیه ≥ ۵۰٪)"
                      : ""}
                </p>
              ) : message ? (
                <p className="pricing-save-ok" aria-live="polite">
                  {message}
                </p>
              ) : (
                <p className="pricing-field-hint">
                  همه تغییرات منتشر شده است.
                </p>
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
