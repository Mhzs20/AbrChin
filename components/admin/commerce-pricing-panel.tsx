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
    provider: "ARVAN" | "PARSPACK";
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
  SITE_MIGRATION: "انتقال سایت/سورس (ریال)",
  INITIAL_SETUP: "راه‌اندازی اولیه (ریال)",
  DOMAIN_SSL: "دامنه و SSL (ریال)",
  BACKUP_RESTORE: "بکاپ و آزمون بازگردانی (ریال)",
  ARCHITECTURE_LIGHT: "همراهی معماری سبک (ریال)",
};

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
      setMessage(response.ok ? "تنظیمات ذخیره شد." : body.error ?? "ذخیره ناموفق بود.");
    } catch {
      setMessage("ارتباط برقرار نشد.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="مالیات، پرچین، یادآوری و قیمت خدمت">
      <p>
        این بخش روی مبلغ نهایی مشتری اثر دارد. VAT پیش‌فرض ۱۰٪ است. قیمت پرچین
        را می‌توانی صفر یا غیرفعال کنی. روزهای SMS / تعلیق / حذف و قیمت بسته‌های
        قطب‌نما هم اینجاست.
      </p>
      <label>
        Tax BPS (۱۰٪ = ۱۰۰۰)
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
      <fieldset style={{ display: "grid", gap: 8, border: 0, padding: 0 }}>
        <legend>یادآوری و چرخه تعلیق / حذف (روز)</legend>
        <label>
          روزهای SMS قبل از سررسید
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
        <label>
          روز فرصت تمدید پس از صفر شدن کیف پول (تعلیق)
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
        <label>
          روز تا حذف پس از تعلیق
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
      </fieldset>
      <fieldset style={{ display: "grid", gap: 8, border: 0, padding: 0 }}>
        <legend>قیمت بسته‌های خدمت قطب‌نما (ریال)</legend>
        {(
          Object.keys(serviceLabels) as Array<
            keyof PricingState["compassServicePrices"]
          >
        ).map((code) => (
          <label key={code}>
            {serviceLabels[code]}
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
      </fieldset>
      {state.productMarkups.map((config, index) => (
        <div key={`${config.provider}:${config.productKind}`}>
          <label>
            {config.provider} / {config.productKind} Markup BPS
            <input
              min={0}
              max={100000}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  productMarkups: current.productMarkups.map((item, itemIndex) =>
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
          <label>
            <input
              checked={config.enabled}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  productMarkups: current.productMarkups.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, enabled: event.target.checked }
                      : item,
                  ),
                }))
              }
              type="checkbox"
            />
            این Product Kind فعال باشد
          </label>
        </div>
      ))}
      {state.parchin.map((config, index) => (
        <div key={config.level}>
          <label>
            عنوان سطح
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
          </label>
          <label>
            دامنه خدمات
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
          <label>
            قیمت IRR (صفر = رایگان در صورتحساب)
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
          <label>
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
        </div>
      ))}
      <button
        className="product-btn product-btn--primary"
        disabled={saving}
        onClick={save}
        type="button"
      >
        ذخیره تنظیمات مالی
      </button>
      {message ? <p aria-live="polite">{message}</p> : null}
    </SectionCard>
  );
}
