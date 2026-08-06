"use client";

import { useMemo, useState } from "react";

import { SectionCard, StatusBadge } from "@/components/product";

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

function rialToTomanLabel(rial: string | null) {
  if (!rial) return "—";
  try {
    return `${(BigInt(rial) / 10n).toLocaleString("fa-IR")} تومان`;
  } catch {
    return "—";
  }
}

function bpsToPercentLabel(bps: number | null) {
  if (bps == null) return "—";
  const whole = Math.floor(bps / 100);
  const fraction = bps % 100;
  if (fraction === 0) return `${whole.toLocaleString("fa-IR")}٪`;
  return `${whole.toLocaleString("fa-IR")}٫${String(fraction).padStart(2, "0")}٪`;
}

function typeLabel(type: CouponRow["type"]) {
  return type === "SERVER_PURCHASE" ? "تخفیف خرید سرور" : "افزایش اعتبار کیف پول";
}

function scopeLabel(scope: CouponRow["scope"]) {
  return scope === "PUBLIC" ? "عمومی" : "مخصوص کاربر";
}

function tomanDigitsToRialString(tomanDigits: string): string | null {
  const cleaned = tomanDigits.replace(/[^\d]/g, "");
  if (!cleaned) return null;
  try {
    return (BigInt(cleaned) * 10n).toString();
  } catch {
    return null;
  }
}

export function CouponsPanel({ initial }: { initial: CouponRow[] }) {
  const [coupons, setCoupons] = useState(initial);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    code: "",
    type: "SERVER_PURCHASE" as CouponRow["type"],
    scope: "PUBLIC" as CouponRow["scope"],
    discountPercent: "20",
    termMonths: "3",
    minDepositToman: "",
    bonusToman: "",
    expiresAt: "",
    userId: "",
    maxRedemptions: "100",
  });

  const preview = useMemo(() => {
    if (form.type === "SERVER_PURCHASE") {
      const percent = Number(form.discountPercent);
      const months = form.termMonths;
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        return "درصد تخفیف را بین ۰ تا ۱۰۰ وارد کن.";
      }
      return `با این کد، تخفیف ثابت ۵/۱۰/۲۰٪ برداشته می‌شود و ${percent.toLocaleString("fa-IR")}٪ برای شارژ ${Number(months).toLocaleString("fa-IR")} ماهه اعمال می‌شود.`;
    }
    const deposit = form.minDepositToman.replace(/[^\d]/g, "");
    const bonus = form.bonusToman.replace(/[^\d]/g, "");
    if (!deposit || !bonus) {
      return "حداقل واریز و شارژ اضافه را به تومان وارد کن.";
    }
    return `با واریز حداقل ${Number(deposit).toLocaleString("fa-IR")} تومان، ${Number(bonus).toLocaleString("fa-IR")} تومان اضافه به کیف پول شارژ می‌شود.`;
  }, [form]);

  async function createCoupon() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const discountBps = Math.round(Number(form.discountPercent) * 100);
      const minDepositRial = tomanDigitsToRialString(form.minDepositToman);
      const bonusRial = tomanDigitsToRialString(form.bonusToman);

      if (form.type === "SERVER_PURCHASE") {
        if (
          !Number.isInteger(discountBps) ||
          discountBps < 0 ||
          discountBps > 10_000
        ) {
          throw new Error("درصد تخفیف معتبر نیست.");
        }
      } else if (!minDepositRial || !bonusRial) {
        throw new Error("مبالغ افزایش اعتبار را به تومان وارد کن.");
      }

      if (form.scope === "PUBLIC" && !form.expiresAt && !form.maxRedemptions) {
        throw new Error("کد عمومی باید تاریخ انقضا یا سقف مصرف داشته باشد.");
      }
      if (form.scope === "USER" && !form.userId.trim()) {
        throw new Error("برای کد مخصوص کاربر، شناسه کاربر لازم است.");
      }

      const response = await fetch("/api/admin/coupons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code,
          type: form.type,
          scope: form.scope,
          discountBps,
          termMonths: Number(form.termMonths),
          minDepositRial,
          bonusRial,
          expiresAt: form.expiresAt || null,
          userId: form.userId || null,
          maxRedemptions:
            form.scope === "USER" ? 1 : Number(form.maxRedemptions),
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
      setMessage(`کد ${body.coupon.code} ذخیره شد.`);
      setForm((current) => ({
        ...current,
        code: "",
        userId: "",
        minDepositToman: "",
        bonusToman: "",
      }));
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "ذخیره ناموفق بود.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="کدهای تخفیف">
      <p className="pricing-rules-lead">
        دو مدل مجاز فاز ۱: تخفیف خرید سرور (جایگزین ۵/۱۰/۲۰٪) و افزایش اعتبار
        کیف پول. قوانین دیگر را عوض نکن؛ فقط کد بساز و مصرف را ببین.
      </p>

      <div className="coupon-type-switch" role="tablist" aria-label="نوع کد تخفیف">
        <button
          type="button"
          role="tab"
          aria-selected={form.type === "SERVER_PURCHASE"}
          className={
            form.type === "SERVER_PURCHASE"
              ? "coupon-type-card coupon-type-card--active"
              : "coupon-type-card"
          }
          onClick={() =>
            setForm((current) => ({ ...current, type: "SERVER_PURCHASE" }))
          }
        >
          <strong>تخفیف خرید سرور</strong>
          <span>
            درصد مشخص + مدت ماه مشخص. در حضور این کد، تخفیف ثابت دوره حذف
            می‌شود.
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={form.type === "WALLET_BONUS"}
          className={
            form.type === "WALLET_BONUS"
              ? "coupon-type-card coupon-type-card--active"
              : "coupon-type-card"
          }
          onClick={() =>
            setForm((current) => ({ ...current, type: "WALLET_BONUS" }))
          }
        >
          <strong>افزایش اعتبار کیف پول</strong>
          <span>
            با واریز حداقل X تومان، N تومان اضافه شارژ می‌شود. X و N را همین‌جا
            تعیین کن.
          </span>
        </button>
      </div>

      <div className="coupon-form-panel">
        <div className="pricing-rules-grid">
          <label className="pricing-field">
            <span>کد</span>
            <input
              value={form.code}
              autoComplete="off"
              spellCheck={false}
              placeholder="مثلاً SPRING20"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  code: event.target.value.toUpperCase(),
                }))
              }
            />
            <span className="pricing-field-hint">
              فقط حروف انگلیسی، عدد، خط تیره یا زیرخط — ۳ تا ۳۲ کاراکتر
            </span>
          </label>

          <label className="pricing-field">
            <span>دامنه مصرف</span>
            <select
              value={form.scope}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  scope: event.target.value as CouponRow["scope"],
                }))
              }
            >
              <option value="PUBLIC">عمومی — تاریخ انقضا / سقف مصرف</option>
              <option value="USER">مخصوص کاربر — یک‌بارمصرف</option>
            </select>
            <span className="pricing-field-hint">
              {form.scope === "PUBLIC"
                ? "کد عمومی باید تاریخ انقضا یا سقف مصرف داشته باشد."
                : "کد مخصوص کاربر فقط یک‌بار برای همان کاربر قابل استفاده است."}
            </span>
          </label>

          {form.type === "SERVER_PURCHASE" ? (
            <>
              <label className="pricing-field">
                <span>درصد تخفیف</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={form.discountPercent}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      discountPercent: event.target.value,
                    }))
                  }
                />
                <span className="pricing-field-hint">
                  مثلاً ۲۰ یعنی ۲۰٪. جایگزین تخفیف ثابت ۳→۵٪ / ۶→۱۰٪ / ۱۲→۲۰٪
                </span>
              </label>
              <label className="pricing-field">
                <span>مدت ماه</span>
                <select
                  value={form.termMonths}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      termMonths: event.target.value,
                    }))
                  }
                >
                  <option value="1">۱ ماه</option>
                  <option value="3">۳ ماه</option>
                  <option value="6">۶ ماه</option>
                  <option value="12">۱۲ ماه</option>
                </select>
                <span className="pricing-field-hint">
                  کد فقط برای همین مدت شارژ اعمال می‌شود.
                </span>
              </label>
            </>
          ) : (
            <>
              <label className="pricing-field">
                <span>حداقل واریز (تومان)</span>
                <input
                  inputMode="numeric"
                  value={form.minDepositToman}
                  placeholder="مثلاً 500000"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      minDepositToman: event.target.value,
                    }))
                  }
                />
                <span className="pricing-field-hint">
                  مشتری باید حداقل این مبلغ را واریز کند تا پاداش بگیرد.
                </span>
              </label>
              <label className="pricing-field">
                <span>شارژ اضافه (تومان)</span>
                <input
                  inputMode="numeric"
                  value={form.bonusToman}
                  placeholder="مثلاً 100000"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      bonusToman: event.target.value,
                    }))
                  }
                />
                <span className="pricing-field-hint">
                  این مبلغ علاوه بر واریز، به کیف پول اضافه می‌شود.
                </span>
              </label>
            </>
          )}

          {form.scope === "PUBLIC" ? (
            <>
              <label className="pricing-field">
                <span>تاریخ انقضا</span>
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
                <span className="pricing-field-hint">
                  برای کد عمومی توصیه می‌شود؛ یا سقف مصرف را پر کن.
                </span>
              </label>
              <label className="pricing-field">
                <span>سقف مصرف</span>
                <input
                  type="number"
                  min={1}
                  value={form.maxRedemptions}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      maxRedemptions: event.target.value,
                    }))
                  }
                />
                <span className="pricing-field-hint">
                  حداکثر تعداد استفادهٔ کل کد برای همه کاربران.
                </span>
              </label>
            </>
          ) : (
            <label className="pricing-field">
              <span>شناسه کاربر</span>
              <input
                value={form.userId}
                placeholder="User ID از صفحه کاربران"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    userId: event.target.value,
                  }))
                }
              />
              <span className="pricing-field-hint">
                فقط همین کاربر یک‌بار می‌تواند از کد استفاده کند.
              </span>
            </label>
          )}
        </div>

        <div className="coupon-preview" aria-live="polite">
          <strong>پیش‌نمایش اثر کد</strong>
          <p>{preview}</p>
        </div>

        <div className="pricing-rules-actions">
          <button
            className="product-btn product-btn--primary"
            type="button"
            disabled={saving || !form.code.trim()}
            onClick={() => void createCoupon()}
          >
            {saving ? "در حال ساخت…" : "ساخت کد"}
          </button>
          {message ? <p className="pricing-save-ok">{message}</p> : null}
          {error ? <p className="pricing-save-err">{error}</p> : null}
        </div>
      </div>

      <div className="coupon-list">
        <div className="coupon-list-head">
          <h3>کدهای ثبت‌شده</h3>
          <span className="product-muted">
            {coupons.length.toLocaleString("fa-IR")} مورد اخیر
          </span>
        </div>

        {coupons.length === 0 ? (
          <p className="product-muted">هنوز کدی ساخته نشده است.</p>
        ) : (
          <div className="product-table-wrap">
            <table className="product-table">
              <thead>
                <tr>
                  <th>کد</th>
                  <th>نوع</th>
                  <th>دامنه</th>
                  <th>شرایط</th>
                  <th>مصرف</th>
                  <th>انقضا</th>
                  <th>وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {coupons.map((coupon) => (
                  <tr key={coupon.id}>
                    <td>
                      <strong className="product-tech">{coupon.code}</strong>
                    </td>
                    <td>{typeLabel(coupon.type)}</td>
                    <td>{scopeLabel(coupon.scope)}</td>
                    <td>
                      {coupon.type === "SERVER_PURCHASE" ? (
                        <>
                          {bpsToPercentLabel(coupon.discountBps)} برای{" "}
                          {(coupon.termMonths ?? 0).toLocaleString("fa-IR")} ماه
                        </>
                      ) : (
                        <>
                          واریز {rialToTomanLabel(coupon.minDepositRial)} ← اضافه{" "}
                          {rialToTomanLabel(coupon.bonusRial)}
                        </>
                      )}
                    </td>
                    <td>
                      {coupon.redemptionCount.toLocaleString("fa-IR")}
                      {coupon.maxRedemptions != null
                        ? ` / ${coupon.maxRedemptions.toLocaleString("fa-IR")}`
                        : ""}
                    </td>
                    <td>
                      {coupon.expiresAt
                        ? new Date(coupon.expiresAt).toLocaleString("fa-IR")
                        : "—"}
                    </td>
                    <td>
                      <StatusBadge
                        label={coupon.active ? "فعال" : "غیرفعال"}
                        tone={coupon.active ? "success" : "neutral"}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
