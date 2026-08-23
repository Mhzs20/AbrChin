"use client";

import { useState } from "react";

import { SectionCard } from "@/components/product";

type PricingState = {
  taxBps: number;
  reminderDaysBeforeDue: number;
  suspendGraceDaysAfterZero: number;
  deleteDaysAfterSuspend: number;
  compassServicePrices: {
    SITE_MIGRATION: string;
    INITIAL_SETUP: string;
    DOMAIN_SSL: string;
    BACKUP_RESTORE: string;
    ARCHITECTURE_LIGHT: string;
  };
  productMarkups: Array<{
    provider: "ARVAN";
    apiVersion: string;
    productKind: "CLOUD_SERVER" | "READY_INSTANT_SERVER";
    markupBasisPoints: number;
    enabled: boolean;
  }>;
  parchin: Array<{
    level: "PARCHIN_START" | "PARCHIN_ACTIVE" | "PARCHIN_STABLE";
    title: string;
    description: string | null;
    priceRial: string;
    active: boolean;
  }>;
};

const serviceLabels: Record<keyof PricingState["compassServicePrices"], string> = {
  SITE_MIGRATION: "انتقال سایت/سورس",
  INITIAL_SETUP: "راه‌اندازی اولیه",
  DOMAIN_SSL: "دامنه و SSL",
  BACKUP_RESTORE: "بکاپ و آزمون بازگردانی",
  ARCHITECTURE_LIGHT: "همراهی معماری سبک",
};

function productKindLabel(kind: PricingState["productMarkups"][number]["productKind"]) {
  return kind === "CLOUD_SERVER" ? "سرور ابری" : "سرور آماده";
}

function bpsToPercentLabel(bps: number) {
  const whole = Math.floor(bps / 100);
  const fraction = bps % 100;
  if (fraction === 0) return `${whole.toLocaleString("fa-IR")}٪`;
  return `${whole.toLocaleString("fa-IR")}٫${String(fraction).padStart(2, "0")}٪`;
}

export function CommercePricingPanel({ initial }: { initial: PricingState }) {
  const [state, setState] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/infrastructure/pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const body = (await response.json()) as { error?: string };
      setMessage(response.ok ? "تنظیمات قیمت ذخیره شد." : body.error ?? "ذخیره ناموفق بود.");
    } catch {
      setMessage("ارتباط برقرار نشد.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pricing-rules-layout">
      <SectionCard title="۱. مالیات و مبلغ نهایی">
        <p className="pricing-rules-lead">
          VAT روی قیمت فروش اعمال می‌شود. پیش‌فرض لانچ ۱۰٪ است (۱۰۰۰ BPS).
        </p>
        <div className="pricing-rules-grid">
          <label className="pricing-field">
            <span>مالیات (BPS)</span>
            <strong>الان: {bpsToPercentLabel(state.taxBps)}</strong>
            <input
              min={0}
              max={10000}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  taxBps: Number(event.target.value),
                }))
              }
              type="number"
              value={state.taxBps}
            />
          </label>
        </div>
      </SectionCard>

      <SectionCard title="۲. Markup نوع محصول (Arvan)">
        <p className="pricing-rules-lead">
          علاوه بر Markup سراسری هر منبع، Markup جدا برای نوع محصول تنظیم می‌شود.
        </p>
        <div className="pricing-rules-grid pricing-rules-grid--cards">
          {state.productMarkups.map((config, index) => (
            <article
              className="pricing-product-card"
              key={`${config.provider}:${config.productKind}`}
            >
              <header>
                <span className="provider-code-badge" data-code={config.provider}>
                  Arvan
                </span>
                <strong>{productKindLabel(config.productKind)}</strong>
              </header>
              <label className="pricing-field">
                <span>Markup (BPS)</span>
                <strong>{bpsToPercentLabel(config.markupBasisPoints)}</strong>
                <input
                  min={0}
                  max={100000}
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      productMarkups: current.productMarkups.map(
                        (item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                markupBasisPoints: Number(event.target.value),
                              }
                            : item,
                      ),
                    }))
                  }
                  type="number"
                  value={config.markupBasisPoints}
                />
              </label>
              <label className="pricing-check">
                <input
                  checked={config.enabled}
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      productMarkups: current.productMarkups.map(
                        (item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, enabled: event.target.checked }
                            : item,
                      ),
                    }))
                  }
                  type="checkbox"
                />
                محاسبه برای این نوع محصول فعال باشد
              </label>
            </article>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="۳. پرچین (الزامی روی همه فروش‌ها)">
        <p className="pricing-rules-lead">
          عنوان و قیمت همین‌جا روی سایت، چینش و قطب‌نما اعمال می‌شود. قیمت را صفر
          کن اگر می‌خواهی در صورتحساب رایگان باشد؛ غیرفعال‌کردن سطح یعنی از مسیر
          فروش کنار می‌رود. بعد از ویرایش حتماً «ذخیره همه قواعد قیمت» را بزن.
        </p>
        <div className="pricing-rules-grid pricing-rules-grid--cards">
          {state.parchin.map((config, index) => (
            <article className="pricing-product-card" key={config.level}>
              <header>
                <strong>
                  {config.level === "PARCHIN_START"
                    ? "سطح ۱"
                    : config.level === "PARCHIN_ACTIVE"
                      ? "سطح ۲"
                      : "سطح ۳"}
                </strong>
                <span className="pricing-field-hint" dir="ltr">
                  {config.level}
                </span>
              </header>
              <label className="pricing-field">
                <span>عنوان نمایش در سایت</span>
                <input
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      parchin: current.parchin.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, title: event.target.value }
                          : item,
                      ),
                    }))
                  }
                  value={config.title}
                />
                <small className="pricing-field-hint">
                  مشتری همین عنوان را می‌بیند (مثلاً پرچین نو).
                </small>
              </label>
              <label className="pricing-field">
                <span>دامنه خدمات</span>
                <textarea
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      parchin: current.parchin.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, description: event.target.value }
                          : item,
                      ),
                    }))
                  }
                  rows={2}
                  value={config.description ?? ""}
                />
              </label>
              <label className="pricing-field">
                <span>قیمت (ریال)</span>
                <input
                  inputMode="numeric"
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      parchin: current.parchin.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, priceRial: event.target.value }
                          : item,
                      ),
                    }))
                  }
                  value={config.priceRial}
                />
              </label>
              <label className="pricing-check">
                <input
                  checked={config.active}
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      parchin: current.parchin.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, active: event.target.checked }
                          : item,
                      ),
                    }))
                  }
                  type="checkbox"
                />
                فعال
              </label>
            </article>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="۴. چرخه یادآوری / تعلیق / حذف (روز)">
        <div className="pricing-rules-grid">
          <label className="pricing-field">
            <span>SMS قبل از سررسید</span>
            <input
              min={1}
              max={90}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  reminderDaysBeforeDue: Number(event.target.value),
                }))
              }
              type="number"
              value={state.reminderDaysBeforeDue}
            />
          </label>
          <label className="pricing-field">
            <span>مهلت تمدید تا تعلیق</span>
            <input
              min={1}
              max={90}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  suspendGraceDaysAfterZero: Number(event.target.value),
                }))
              }
              type="number"
              value={state.suspendGraceDaysAfterZero}
            />
          </label>
          <label className="pricing-field">
            <span>روز تا بررسی حذف پس از تعلیق</span>
            <input
              min={1}
              max={90}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  deleteDaysAfterSuspend: Number(event.target.value),
                }))
              }
              type="number"
              value={state.deleteDaysAfterSuspend}
            />
          </label>
        </div>
      </SectionCard>

      <SectionCard title="۵. قیمت بسته‌های خدمت قطب‌نما">
        <p className="pricing-rules-lead">مبالغ به ریال هستند و در پیشنهاد قطب‌نما دیده می‌شوند.</p>
        <div className="pricing-rules-grid">
          {(
            Object.keys(serviceLabels) as Array<
              keyof PricingState["compassServicePrices"]
            >
          ).map((code) => (
            <label className="pricing-field" key={code}>
              <span>{serviceLabels[code]}</span>
              <input
                inputMode="numeric"
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    compassServicePrices: {
                      ...current.compassServicePrices,
                      [code]: event.target.value.replace(/\D/g, ""),
                    },
                  }))
                }
                value={state.compassServicePrices[code]}
              />
            </label>
          ))}
        </div>
      </SectionCard>

      <div className="pricing-rules-actions pricing-rules-actions--sticky">
        <button
          className="product-btn product-btn--primary"
          disabled={saving}
          onClick={() => void save()}
          type="button"
        >
          {saving ? "در حال ذخیره…" : "ذخیره همه قواعد قیمت"}
        </button>
        {message ? (
          <p aria-live="polite" className={message.includes("ذخیره شد") ? "pricing-save-ok" : "pricing-save-err"}>
            {message}
          </p>
        ) : (
          <p className="pricing-field-hint">بدون ذخیره، تغییرها روی سایت اعمال نمی‌شود.</p>
        )}
      </div>
    </div>
  );
}
