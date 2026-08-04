"use client";

import { useState } from "react";

import { SectionCard } from "@/components/product";

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

export function CouponsPanel({ initial }: { initial: CouponRow[] }) {
  const [coupons, setCoupons] = useState(initial);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    code: "",
    type: "SERVER_PURCHASE" as CouponRow["type"],
    scope: "PUBLIC" as CouponRow["scope"],
    discountBps: "2000",
    termMonths: "3",
    minDepositRial: "",
    bonusRial: "",
    expiresAt: "",
    userId: "",
    maxRedemptions: "100",
  });

  async function createCoupon() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/coupons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code,
          type: form.type,
          scope: form.scope,
          discountBps: Number(form.discountBps),
          termMonths: Number(form.termMonths),
          minDepositRial: form.minDepositRial || null,
          bonusRial: form.bonusRial || null,
          expiresAt: form.expiresAt || null,
          userId: form.userId || null,
          maxRedemptions: Number(form.maxRedemptions),
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        coupon?: CouponRow;
      };
      if (!response.ok || !body.coupon) {
        throw new Error(body.error ?? "ذخیره ناموفق بود.");
      }
      setCoupons((current) => [body.coupon!, ...current]);
      setMessage("کد ذخیره شد.");
      setForm((current) => ({ ...current, code: "" }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ذخیره ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="کدهای تخفیف">
      <p>
        دو مدل: تخفیف درصد خرید سرور برای N ماه (جایگزین ۵/۱۰/۲۰)، و افزایش اعتبار
        کیف پول با واریز X و دریافت N.
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        <label>
          کد
          <input
            value={form.code}
            onChange={(event) =>
              setForm((current) => ({ ...current, code: event.target.value }))
            }
          />
        </label>
        <label>
          نوع
          <select
            value={form.type}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                type: event.target.value as CouponRow["type"],
              }))
            }
          >
            <option value="SERVER_PURCHASE">تخفیف خرید سرور</option>
            <option value="WALLET_BONUS">افزایش اعتبار کیف پول</option>
          </select>
        </label>
        <label>
          دامنه
          <select
            value={form.scope}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                scope: event.target.value as CouponRow["scope"],
              }))
            }
          >
            <option value="PUBLIC">عمومی</option>
            <option value="USER">مخصوص کاربر (یک‌بارمصرف)</option>
          </select>
        </label>
        {form.type === "SERVER_PURCHASE" ? (
          <>
            <label>
              درصد (basis points، ۲۰٪ = ۲۰۰۰)
              <input
                type="number"
                value={form.discountBps}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    discountBps: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              مدت ماه
              <select
                value={form.termMonths}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    termMonths: event.target.value,
                  }))
                }
              >
                <option value="1">1</option>
                <option value="3">3</option>
                <option value="6">6</option>
                <option value="12">12</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <label>
              حداقل واریز (ریال)
              <input
                value={form.minDepositRial}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    minDepositRial: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              شارژ اضافه (ریال)
              <input
                value={form.bonusRial}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    bonusRial: event.target.value,
                  }))
                }
              />
            </label>
          </>
        )}
        {form.scope === "PUBLIC" ? (
          <label>
            تاریخ انقضا
            <input
              type="datetime-local"
              value={form.expiresAt}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  expiresAt: event.target.value,
                }))
              }
            />
          </label>
        ) : (
          <label>
            شناسه کاربر
            <input
              value={form.userId}
              onChange={(event) =>
                setForm((current) => ({ ...current, userId: event.target.value }))
              }
            />
          </label>
        )}
        <button
          className="product-btn product-btn--primary"
          type="button"
          disabled={saving}
          onClick={() => void createCoupon()}
        >
          ساخت کد
        </button>
        {message ? <p aria-live="polite">{message}</p> : null}
      </div>
      <ul style={{ marginTop: 16, paddingRight: 18 }}>
        {coupons.map((coupon) => (
          <li key={coupon.id}>
            <strong>{coupon.code}</strong> — {coupon.type} / {coupon.scope} —{" "}
            مصرف {coupon.redemptionCount}
            {coupon.discountBps != null ? ` — ${coupon.discountBps} bps` : ""}
            {coupon.bonusRial ? ` — bonus ${coupon.bonusRial}` : ""}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
