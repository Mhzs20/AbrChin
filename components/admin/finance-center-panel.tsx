"use client";

import { useMemo, useState } from "react";

import { CouponsPanel } from "@/components/admin/coupons-panel";
import { SectionCard, StatusBadge } from "@/components/product";

type ProductMarkup = {
  provider: "ARVAN" | "PARSPACK";
  apiVersion: string;
  productKind: "CLOUD_SERVER" | "READY_INSTANT_SERVER";
  markupBasisPoints: number;
  enabled: boolean;
};

type ParchinRow = {
  level: "PARCHIN_START" | "PARCHIN_ACTIVE" | "PARCHIN_STABLE";
  title: string;
  description: string | null;
  priceRial: string;
  active: boolean;
};

type ProviderMarkup = {
  provider: "ARVAN" | "PARSPACK";
  markupPercent: string;
  enabled: boolean;
};

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

type CommerceState = {
  taxPercent: string;
  reminderDaysBeforeDue: number;
  suspendGraceDaysAfterZero: number;
  deleteDaysAfterSuspend: number;
  compassServicePricesToman: {
    SITE_MIGRATION: string;
    INITIAL_SETUP: string;
    DOMAIN_SSL: string;
    BACKUP_RESTORE: string;
    ARCHITECTURE_LIGHT: string;
  };
  productMarkups: Array<ProductMarkup & { markupPercent: string }>;
  parchin: Array<
    ParchinRow & {
      priceToman: string;
    }
  >;
};

const SECTIONS = [
  { id: "calc", label: "شیوه محاسبه" },
  { id: "markup", label: "سود و Markup" },
  { id: "parchin", label: "پرچین" },
  { id: "tax", label: "مالیات و چرخه" },
  { id: "compass", label: "قطب‌نما" },
  { id: "coupons", label: "کد تخفیف" },
] as const;

const TERM_DISCOUNT_BPS: Record<1 | 3 | 6 | 12, number> = {
  1: 0,
  3: 500,
  6: 1_000,
  12: 2_000,
};

const serviceLabels: Record<
  keyof CommerceState["compassServicePricesToman"],
  string
> = {
  SITE_MIGRATION: "انتقال سایت/سورس",
  INITIAL_SETUP: "راه‌اندازی اولیه",
  DOMAIN_SSL: "دامنه و SSL",
  BACKUP_RESTORE: "بکاپ و آزمون بازگردانی",
  ARCHITECTURE_LIGHT: "همراهی معماری سبک",
};

function providerLabel(provider: "ARVAN" | "PARSPACK") {
  return provider === "PARSPACK" ? "ParsPack" : "Arvan";
}

function productKindLabel(kind: ProductMarkup["productKind"]) {
  return kind === "CLOUD_SERVER" ? "سرور ابری" : "سرور آماده";
}

function parchinLevelLabel(level: ParchinRow["level"]) {
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

function formatTomanFromRial(rial: bigint) {
  return `${(rial / 10n).toLocaleString("fa-IR")} تومان`;
}

function ceilBps(amount: bigint, bps: number) {
  if (amount <= 0n || bps <= 0) return 0n;
  return (amount * BigInt(bps) + 9_999n) / 10_000n;
}

function scrollToSection(id: string) {
  const el = document.getElementById(`finance-${id}`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function FinanceCenterPanel({
  initialCommerce,
  initialProviders,
  initialCoupons,
}: {
  initialCommerce: {
    taxBps: number;
    reminderDaysBeforeDue: number;
    suspendGraceDaysAfterZero: number;
    deleteDaysAfterSuspend: number;
    compassServicePrices: Record<string, string>;
    productMarkups: ProductMarkup[];
    parchin: ParchinRow[];
  };
  initialProviders: ProviderMarkup[];
  initialCoupons: CouponRow[];
}) {
  const [commerce, setCommerce] = useState<CommerceState>(() => ({
    taxPercent: bpsToPercent(initialCommerce.taxBps),
    reminderDaysBeforeDue: initialCommerce.reminderDaysBeforeDue,
    suspendGraceDaysAfterZero: initialCommerce.suspendGraceDaysAfterZero,
    deleteDaysAfterSuspend: initialCommerce.deleteDaysAfterSuspend,
    compassServicePricesToman: {
      SITE_MIGRATION: rialToTomanDigits(
        initialCommerce.compassServicePrices.SITE_MIGRATION ?? "0",
      ),
      INITIAL_SETUP: rialToTomanDigits(
        initialCommerce.compassServicePrices.INITIAL_SETUP ?? "0",
      ),
      DOMAIN_SSL: rialToTomanDigits(
        initialCommerce.compassServicePrices.DOMAIN_SSL ?? "0",
      ),
      BACKUP_RESTORE: rialToTomanDigits(
        initialCommerce.compassServicePrices.BACKUP_RESTORE ?? "0",
      ),
      ARCHITECTURE_LIGHT: rialToTomanDigits(
        initialCommerce.compassServicePrices.ARCHITECTURE_LIGHT ?? "0",
      ),
    },
    productMarkups: initialCommerce.productMarkups.map((item) => ({
      ...item,
      markupPercent: bpsToPercent(item.markupBasisPoints),
    })),
    parchin: initialCommerce.parchin.map((item) => ({
      ...item,
      priceToman: rialToTomanDigits(item.priceRial),
    })),
  }));
  const [providers, setProviders] = useState(initialProviders);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [simCostToman, setSimCostToman] = useState("300000");
  const [simProvider, setSimProvider] = useState<"ARVAN" | "PARSPACK">("ARVAN");
  const [simProductKind, setSimProductKind] = useState<
    ProductMarkup["productKind"]
  >("CLOUD_SERVER");
  const [simTerm, setSimTerm] = useState<1 | 3 | 6 | 12>(3);
  const [simParchin, setSimParchin] = useState<ParchinRow["level"]>(
    "PARCHIN_START",
  );
  const [simCouponPercent, setSimCouponPercent] = useState("");

  const simulation = useMemo(() => {
    const costToman = simCostToman.replace(/[^\d]/g, "");
    if (!costToman) return null;
    const providerMonthly = BigInt(costToman) * 10n;
    const providerCfg = providers.find((item) => item.provider === simProvider);
    const productCfg = commerce.productMarkups.find(
      (item) =>
        item.provider === simProvider && item.productKind === simProductKind,
    );
    const providerBps = percentToBps(providerCfg?.markupPercent ?? "0") ?? 0;
    const productBps = percentToBps(productCfg?.markupPercent ?? "0") ?? 0;
    const taxBps = percentToBps(commerce.taxPercent) ?? 0;
    const parchinRow = commerce.parchin.find(
      (item) => item.level === simParchin,
    );
    const parchinMonthly =
      BigInt(tomanDigitsToRial(parchinRow?.priceToman ?? "0"));
    const markupBps = providerBps + productBps;
    const monthlyMarkup = ceilBps(providerMonthly, markupBps);
    const monthlyPretax =
      providerMonthly + monthlyMarkup + parchinMonthly;
    const term = BigInt(simTerm);
    const termPretax = monthlyPretax * term;
    const couponBps = simCouponPercent.trim()
      ? percentToBps(simCouponPercent)
      : null;
    const discountBps =
      couponBps != null ? couponBps : TERM_DISCOUNT_BPS[simTerm];
    const discountSource =
      couponBps != null ? "coupon" : discountBps > 0 ? "term" : "none";
    const discount = ceilBps(termPretax, discountBps);
    const taxable = termPretax - discount;
    const tax = ceilBps(taxable, taxBps);
    const final = taxable + tax;
    const buyShare =
      final > 0n
        ? Number((providerMonthly * term * 10_000n) / final) / 100
        : 0;
    const profitShare =
      final > 0n
        ? Number((monthlyMarkup * term * 10_000n) / final) / 100
        : 0;

    return {
      lines: [
        {
          key: "buy",
          tone: "cost" as const,
          label: "قیمت خرید Provider (ماهانه × دوره)",
          amount: providerMonthly * term,
        },
        {
          key: "markup",
          tone: "sale" as const,
          label: `سود Markup ابرچین (${bpsToPercent(markupBps)}٪ = Provider + محصول)`,
          amount: monthlyMarkup * term,
        },
        {
          key: "parchin",
          tone: "sale" as const,
          label: `پرچین · ${parchinRow?.title || simParchin}`,
          amount: parchinMonthly * term,
        },
        {
          key: "discount",
          tone: "neutral" as const,
          label:
            discountSource === "coupon"
              ? `تخفیف کد (${bpsToPercent(discountBps)}٪ — جایگزین ۵/۱۰/۲۰)`
              : discountSource === "term"
                ? `تخفیف دوره ${simTerm} ماهه (${bpsToPercent(discountBps)}٪)`
                : "تخفیف دوره",
          amount: -discount,
        },
        {
          key: "tax",
          tone: "neutral" as const,
          label: `مالیات (${commerce.taxPercent}٪)`,
          amount: tax,
        },
      ],
      final,
      buyShare,
      profitShare,
      providerEnabled: providerCfg?.enabled !== false,
      productEnabled: productCfg?.enabled !== false,
    };
  }, [
    commerce.parchin,
    commerce.productMarkups,
    commerce.taxPercent,
    providers,
    simCostToman,
    simCouponPercent,
    simParchin,
    simProductKind,
    simProvider,
    simTerm,
  ]);

  async function saveAll() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const taxBps = percentToBps(commerce.taxPercent);
      if (taxBps == null || taxBps > 10_000) {
        throw new Error("مالیات باید بین ۰ تا ۱۰۰٪ باشد.");
      }
      for (const item of commerce.productMarkups) {
        if (percentToBps(item.markupPercent) == null) {
          throw new Error(
            `Markup محصول ${providerLabel(item.provider)} / ${productKindLabel(item.productKind)} معتبر نیست.`,
          );
        }
      }
      for (const item of providers) {
        if (percentToBps(item.markupPercent) == null) {
          throw new Error(
            `Markup منبع ${providerLabel(item.provider)} معتبر نیست.`,
          );
        }
      }

      const commerceBody = {
        taxBps,
        reminderDaysBeforeDue: commerce.reminderDaysBeforeDue,
        suspendGraceDaysAfterZero: commerce.suspendGraceDaysAfterZero,
        deleteDaysAfterSuspend: commerce.deleteDaysAfterSuspend,
        compassServicePrices: {
          SITE_MIGRATION: tomanDigitsToRial(
            commerce.compassServicePricesToman.SITE_MIGRATION,
          ),
          INITIAL_SETUP: tomanDigitsToRial(
            commerce.compassServicePricesToman.INITIAL_SETUP,
          ),
          DOMAIN_SSL: tomanDigitsToRial(
            commerce.compassServicePricesToman.DOMAIN_SSL,
          ),
          BACKUP_RESTORE: tomanDigitsToRial(
            commerce.compassServicePricesToman.BACKUP_RESTORE,
          ),
          ARCHITECTURE_LIGHT: tomanDigitsToRial(
            commerce.compassServicePricesToman.ARCHITECTURE_LIGHT,
          ),
        },
        productMarkups: commerce.productMarkups.map((item) => ({
          provider: item.provider,
          apiVersion: item.apiVersion,
          productKind: item.productKind,
          markupBasisPoints: percentToBps(item.markupPercent)!,
          enabled: item.enabled,
        })),
        parchin: commerce.parchin.map((item) => ({
          level: item.level,
          title: item.title,
          description: item.description,
          priceRial: tomanDigitsToRial(item.priceToman),
          active: item.active,
        })),
      };

      const commerceRes = await fetch("/api/admin/infrastructure/pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(commerceBody),
      });
      const commerceJson = (await commerceRes.json()) as { error?: string };
      if (!commerceRes.ok) {
        throw new Error(commerceJson.error ?? "ذخیره قواعد قیمت ناموفق بود.");
      }

      for (const item of providers) {
        const res = await fetch("/api/admin/infrastructure/providers/markup", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: item.provider,
            markupPercent: item.markupPercent,
            enabled: item.enabled,
          }),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) {
          throw new Error(
            json.error ??
              `ذخیره Markup ${providerLabel(item.provider)} ناموفق بود.`,
          );
        }
      }

      setMessage("مرکز مالی ذخیره شد و روی فروش‌های بعدی اعمال می‌شود.");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "ذخیره ناموفق بود.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="finance-center">
      <nav className="finance-nav" aria-label="بخش‌های مرکز مالی">
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            className="finance-nav-pill"
            onClick={() => scrollToSection(section.id)}
          >
            {section.label}
          </button>
        ))}
      </nav>

      <section id="finance-calc" className="finance-section">
        <SectionCard title="شیوه محاسبه قیمت در فروش">
          <p className="pricing-rules-lead">
            هر فروش سرور از همین خط‌ها ساخته می‌شود. سبز = قیمت خرید، آبی = سود /
            قیمت فروش ابرچین. پرداخت موفق خودش Provision نمی‌زند؛ فقط مبلغ Quote
            همین فرمول را قفل می‌کند.
          </p>

          <ol className="finance-pipeline">
            <li className="finance-pipeline-step finance-pipeline-step--cost">
              <span>۱</span>
              <div>
                <strong>قیمت خرید Provider</strong>
                <p>هزینه ماهانه Arvan / ParsPack از کاتالوگ Sync</p>
              </div>
            </li>
            <li className="finance-pipeline-step finance-pipeline-step--sale">
              <span>۲</span>
              <div>
                <strong>سود Markup</strong>
                <p>Markup منبع + Markup نوع محصول (یا Override روی SKU)</p>
              </div>
            </li>
            <li className="finance-pipeline-step finance-pipeline-step--sale">
              <span>۳</span>
              <div>
                <strong>پرچین</strong>
                <p>خط خدمت الزامی روی فروش مدیریت‌شده</p>
              </div>
            </li>
            <li className="finance-pipeline-step">
              <span>۴</span>
              <div>
                <strong>× مدت ماه</strong>
                <p>۱ / ۳ / ۶ / ۱۲ ماه</p>
              </div>
            </li>
            <li className="finance-pipeline-step">
              <span>۵</span>
              <div>
                <strong>تخفیف</strong>
                <p>ثابت ۵/۱۰/۲۰٪ یا کد تخفیف خرید سرور (جایگزین)</p>
              </div>
            </li>
            <li className="finance-pipeline-step">
              <span>۶</span>
              <div>
                <strong>مالیات</strong>
                <p>VAT روی مبلغ پس از تخفیف</p>
              </div>
            </li>
            <li className="finance-pipeline-step finance-pipeline-step--sale">
              <span>۷</span>
              <div>
                <strong>مبلغ نهایی مشتری</strong>
                <p>همان عددی که قبل از درگاه می‌بیند</p>
              </div>
            </li>
          </ol>

          <div className="finance-process-grid">
            <article>
              <h3>چینش / خرید سرور</h3>
              <p>
                فرمول کامل بالا. مشتری نام Provider و قیمت خرید را نمی‌بیند.
              </p>
            </article>
            <article>
              <h3>قطب‌نما / خدمات</h3>
              <p>
                قیمت بسته‌های خدمت (انتقال، راه‌اندازی، …) جدا از Markup سرور
                تنظیم می‌شود و به‌صورت پیشنهاد خدمت دیده می‌شود.
              </p>
            </article>
            <article>
              <h3>شارژ کیف پول</h3>
              <p>
                مبلغ شارژ = واریز مشتری. کد افزایش اعتبار فقط در صورت رسیدن به
                حداقل واریز، N تومان اضافه می‌دهد.
              </p>
            </article>
            <article>
              <h3>SKU دستی ابرچین</h3>
              <p>
                اگر قیمت پایه را Admin دستی بگذارد، Markup منبع/محصول روی آن صفر
                می‌شود؛ فقط پرچین و مالیات و تخفیف دوره اعمال می‌شود.
              </p>
            </article>
          </div>

          <div className="finance-simulator">
            <div className="finance-simulator-head">
              <h3>شبیه‌ساز مبلغ فروش</h3>
              <p>با اعداد فعلی مرکز مالی، خروجی را همین‌جا ببین.</p>
            </div>
            <div className="pricing-rules-grid">
              <label className="pricing-field">
                <span>قیمت خرید ماهانه (تومان)</span>
                <input
                  inputMode="numeric"
                  value={simCostToman}
                  onChange={(event) => setSimCostToman(event.target.value)}
                />
              </label>
              <label className="pricing-field">
                <span>منبع</span>
                <select
                  value={simProvider}
                  onChange={(event) =>
                    setSimProvider(
                      event.target.value as "ARVAN" | "PARSPACK",
                    )
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
                    setSimProductKind(
                      event.target.value as ProductMarkup["productKind"],
                    )
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
                  <option value={3}>۳ ماه (۵٪)</option>
                  <option value={6}>۶ ماه (۱۰٪)</option>
                  <option value={12}>۱۲ ماه (۲۰٪)</option>
                </select>
              </label>
              <label className="pricing-field">
                <span>پرچین</span>
                <select
                  value={simParchin}
                  onChange={(event) =>
                    setSimParchin(event.target.value as ParchinRow["level"])
                  }
                >
                  {commerce.parchin.map((item) => (
                    <option key={item.level} value={item.level}>
                      {item.title || parchinLevelLabel(item.level)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pricing-field">
                <span>کد تخفیف٪ (اختیاری)</span>
                <input
                  inputMode="decimal"
                  placeholder="خالی = تخفیف ثابت دوره"
                  value={simCouponPercent}
                  onChange={(event) => setSimCouponPercent(event.target.value)}
                />
              </label>
            </div>

            {simulation ? (
              <div className="finance-sim-result">
                <div className="finance-sim-lines">
                  {simulation.lines.map((line) => (
                    <div
                      key={line.key}
                      className={`finance-sim-line finance-sim-line--${line.tone}`}
                    >
                      <span>{line.label}</span>
                      <strong>
                        {line.amount < 0n ? "−" : ""}
                        {formatTomanFromRial(
                          line.amount < 0n ? -line.amount : line.amount,
                        )}
                      </strong>
                    </div>
                  ))}
                </div>
                <div className="finance-sim-total">
                  <div>
                    <span>مبلغ نهایی مشتری</span>
                    <strong className="money-tone money-tone--sale">
                      {formatTomanFromRial(simulation.final)}
                    </strong>
                  </div>
                  <p>
                    سهم تقریبی خرید{" "}
                    <span className="money-tone money-tone--cost">
                      {simulation.buyShare.toLocaleString("fa-IR")}٪
                    </span>
                    {" · "}
                    سهم Markup{" "}
                    <span className="money-tone money-tone--sale">
                      {simulation.profitShare.toLocaleString("fa-IR")}٪
                    </span>
                    {!simulation.providerEnabled || !simulation.productEnabled
                      ? " · توجه: یکی از Markupها غیرفعال است"
                      : ""}
                  </p>
                </div>
              </div>
            ) : (
              <p className="product-muted">قیمت خرید نمونه را وارد کن.</p>
            )}
          </div>
        </SectionCard>
      </section>

      <section id="finance-markup" className="finance-section">
        <SectionCard title="سود و Markup منابع و محصولات">
          <p className="pricing-rules-lead">
            پیش‌فرض لانچ: حدود ۳۰٪ هزینه تأمین و ۷۰٪ سود (مارکاپ حدود ۲۳۳٫۳۳٪ روی
            قیمت خرید). تغییر فقط فروش‌های بعدی را عوض می‌کند.
          </p>

          <h3 className="finance-subtitle">Markup سراسری منبع</h3>
          <div className="pricing-rules-grid pricing-rules-grid--cards">
            {providers.map((item, index) => (
              <article className="pricing-product-card" key={item.provider}>
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
                  <span>Markup روی قیمت خرید (٪)</span>
                  <input
                    inputMode="decimal"
                    value={item.markupPercent}
                    onChange={(event) =>
                      setProviders((current) =>
                        current.map((row, rowIndex) =>
                          rowIndex === index
                            ? { ...row, markupPercent: event.target.value }
                            : row,
                        ),
                      )
                    }
                  />
                  <span className="pricing-field-hint">
                    مثلاً ۲۳۳٫۳۳ یعنی سود حدود ۷۰٪ از مبلغ زیرساخت پیش از پرچین
                  </span>
                </label>
                <label className="pricing-check">
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={(event) =>
                      setProviders((current) =>
                        current.map((row, rowIndex) =>
                          rowIndex === index
                            ? { ...row, enabled: event.target.checked }
                            : row,
                        ),
                      )
                    }
                  />
                  محاسبه قیمت نهایی برای این منبع فعال باشد
                </label>
              </article>
            ))}
          </div>

          <h3 className="finance-subtitle">Markup نوع محصول</h3>
          <p className="pricing-field-hint" style={{ marginBottom: 12 }}>
            این درصد به Markup منبع اضافه می‌شود. Override اختصاصی روی یک SKU
            فقط در ویرایش همان SKU (حالت پیشرفته) باقی مانده است.
          </p>
          <div className="pricing-rules-grid pricing-rules-grid--cards">
            {commerce.productMarkups.map((config, index) => (
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
                  <span>Markup اضافه محصول (٪)</span>
                  <input
                    inputMode="decimal"
                    value={config.markupPercent}
                    onChange={(event) =>
                      setCommerce((current) => ({
                        ...current,
                        productMarkups: current.productMarkups.map(
                          (item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  markupPercent: event.target.value,
                                }
                              : item,
                        ),
                      }))
                    }
                  />
                </label>
                <label className="pricing-check">
                  <input
                    type="checkbox"
                    checked={config.enabled}
                    onChange={(event) =>
                      setCommerce((current) => ({
                        ...current,
                        productMarkups: current.productMarkups.map(
                          (item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, enabled: event.target.checked }
                              : item,
                        ),
                      }))
                    }
                  />
                  فعال برای این نوع محصول
                </label>
              </article>
            ))}
          </div>
        </SectionCard>
      </section>

      <section id="finance-parchin" className="finance-section">
        <SectionCard title="پرچین">
          <p className="pricing-rules-lead">
            عنوان و قیمت همین‌جا روی سایت، چینش و قطب‌نما اعمال می‌شود. قیمت صفر =
            رایگان در صورتحساب؛ غیرفعال = کنار رفتن از مسیر فروش.
          </p>
          <div className="pricing-rules-grid pricing-rules-grid--cards">
            {commerce.parchin.map((config, index) => (
              <article className="pricing-product-card" key={config.level}>
                <header>
                  <strong>{parchinLevelLabel(config.level)}</strong>
                </header>
                <label className="pricing-field">
                  <span>عنوان نمایش در سایت</span>
                  <input
                    value={config.title}
                    onChange={(event) =>
                      setCommerce((current) => ({
                        ...current,
                        parchin: current.parchin.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, title: event.target.value }
                            : item,
                        ),
                      }))
                    }
                  />
                </label>
                <label className="pricing-field">
                  <span>دامنه خدمات</span>
                  <textarea
                    rows={2}
                    value={config.description ?? ""}
                    onChange={(event) =>
                      setCommerce((current) => ({
                        ...current,
                        parchin: current.parchin.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, description: event.target.value }
                            : item,
                        ),
                      }))
                    }
                  />
                </label>
                <label className="pricing-field">
                  <span>قیمت ماهانه (تومان)</span>
                  <input
                    inputMode="numeric"
                    value={config.priceToman}
                    onChange={(event) =>
                      setCommerce((current) => ({
                        ...current,
                        parchin: current.parchin.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, priceToman: event.target.value }
                            : item,
                        ),
                      }))
                    }
                  />
                </label>
                <label className="pricing-check">
                  <input
                    type="checkbox"
                    checked={config.active}
                    onChange={(event) =>
                      setCommerce((current) => ({
                        ...current,
                        parchin: current.parchin.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, active: event.target.checked }
                            : item,
                        ),
                      }))
                    }
                  />
                  فعال در فروش
                </label>
              </article>
            ))}
          </div>
        </SectionCard>
      </section>

      <section id="finance-tax" className="finance-section">
        <SectionCard title="مالیات و چرخه یادآوری">
          <div className="pricing-rules-grid">
            <label className="pricing-field">
              <span>مالیات VAT (٪)</span>
              <input
                inputMode="decimal"
                value={commerce.taxPercent}
                onChange={(event) =>
                  setCommerce((current) => ({
                    ...current,
                    taxPercent: event.target.value,
                  }))
                }
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
                value={commerce.reminderDaysBeforeDue}
                onChange={(event) =>
                  setCommerce((current) => ({
                    ...current,
                    reminderDaysBeforeDue: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label className="pricing-field">
              <span>مهلت تمدید تا تعلیق (روز)</span>
              <input
                type="number"
                min={1}
                max={90}
                value={commerce.suspendGraceDaysAfterZero}
                onChange={(event) =>
                  setCommerce((current) => ({
                    ...current,
                    suspendGraceDaysAfterZero: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label className="pricing-field">
              <span>روز تا بررسی حذف پس از تعلیق</span>
              <input
                type="number"
                min={1}
                max={90}
                value={commerce.deleteDaysAfterSuspend}
                onChange={(event) =>
                  setCommerce((current) => ({
                    ...current,
                    deleteDaysAfterSuspend: Number(event.target.value),
                  }))
                }
              />
            </label>
          </div>
        </SectionCard>
      </section>

      <section id="finance-compass" className="finance-section">
        <SectionCard title="قیمت بسته‌های خدمت قطب‌نما">
          <p className="pricing-rules-lead">
            مبالغ به تومان هستند و فقط در مسیر خدمت قطب‌نما پیشنهاد می‌شوند — جدا
            از خرید سرور چینش.
          </p>
          <div className="pricing-rules-grid">
            {(
              Object.keys(serviceLabels) as Array<
                keyof CommerceState["compassServicePricesToman"]
              >
            ).map((code) => (
              <label className="pricing-field" key={code}>
                <span>{serviceLabels[code]}</span>
                <input
                  inputMode="numeric"
                  value={commerce.compassServicePricesToman[code]}
                  onChange={(event) =>
                    setCommerce((current) => ({
                      ...current,
                      compassServicePricesToman: {
                        ...current.compassServicePricesToman,
                        [code]: event.target.value.replace(/\D/g, ""),
                      },
                    }))
                  }
                />
              </label>
            ))}
          </div>
        </SectionCard>
      </section>

      <div className="pricing-rules-actions pricing-rules-actions--sticky">
        <button
          className="product-btn product-btn--primary"
          disabled={saving}
          onClick={() => void saveAll()}
          type="button"
        >
          {saving ? "در حال ذخیره…" : "ذخیره مرکز مالی"}
        </button>
        {message ? <p className="pricing-save-ok">{message}</p> : null}
        {error ? <p className="pricing-save-err">{error}</p> : null}
        {!message && !error ? (
          <p className="pricing-field-hint">
            بدون ذخیره، تغییر Markup / پرچین / مالیات روی سایت اعمال نمی‌شود.
          </p>
        ) : null}
      </div>

      <section id="finance-coupons" className="finance-section">
        <CouponsPanel initial={initialCoupons} />
      </section>
    </div>
  );
}
