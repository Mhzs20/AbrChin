"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type TopUpFormProps = {
  gatewayAvailable: boolean;
  gatewayDisplayName: string | null;
  suggestedAmountsToman: number[];
  minTopUpToman: number;
  maxTopUpToman: number;
  returnTo?: string | null;
};

export function TopUpForm({
  gatewayAvailable,
  gatewayDisplayName,
  suggestedAmountsToman,
  minTopUpToman,
  maxTopUpToman,
  returnTo,
}: TopUpFormProps) {
  const router = useRouter();
  const defaultAmount = suggestedAmountsToman[0] ?? minTopUpToman;
  const [amount, setAmount] = useState(defaultAmount);
  const [custom, setCustom] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selected = custom ? Number.parseInt(custom, 10) : amount;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (loading || !gatewayAvailable) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/wallet/topups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountToman: selected,
          couponCode: couponCode.trim() || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "ایجاد شارژ ممکن نشد.");
        setLoading(false);
        return;
      }
      if (returnTo) {
        window.sessionStorage.setItem(
          "abrchin.walletTopup.returnTo",
          returnTo,
        );
      }
      window.location.href = data.redirectUrl;
    } catch {
      setError("ارتباط برقرار نشد.");
      setLoading(false);
    }
  }

  return (
    <form className="auth-card auth-form" onSubmit={submit}>
      <div className="auth-card-head">
        <h1>شارژ کیف پول</h1>
        <p>
          مبلغ را به تومان انتخاب کنید. حداقل {minTopUpToman.toLocaleString("fa-IR")} و حداکثر{" "}
          {maxTopUpToman.toLocaleString("fa-IR")} تومان.
        </p>
      </div>

      {gatewayAvailable && gatewayDisplayName ? (
        <p className="topup-gateway-note">پرداخت امن از طریق {gatewayDisplayName}</p>
      ) : (
        <p className="auth-error">درگاه پرداخت موقتاً در دسترس نیست</p>
      )}

      <div className="topup-suggestions">
        {suggestedAmountsToman.map((value) => (
          <button
            key={value}
            type="button"
            className={`button button-quiet${selected === value && !custom ? " selected" : ""}`}
            onClick={() => {
              setAmount(value);
              setCustom("");
            }}
            disabled={!gatewayAvailable}
          >
            {value.toLocaleString("fa-IR")} تومان
          </button>
        ))}
      </div>

      <label className="auth-field" htmlFor="custom-amount">
        <span>مبلغ دلخواه (تومان)</span>
        <input
          id="custom-amount"
          inputMode="numeric"
          dir="ltr"
          placeholder="مثلاً 200000"
          value={custom}
          disabled={!gatewayAvailable}
          onChange={(e) => setCustom(e.target.value.replace(/\D/g, ""))}
        />
      </label>

      <label className="auth-field" htmlFor="coupon-code">
        <span>کد افزایش اعتبار (اختیاری)</span>
        <input
          id="coupon-code"
          dir="ltr"
          maxLength={32}
          placeholder="مثلاً BONUS50"
          value={couponCode}
          disabled={!gatewayAvailable}
          onChange={(e) => setCouponCode(e.target.value)}
        />
      </label>

      <p className="topup-summary">مبلغ نهایی: {(Number.isFinite(selected) ? selected : 0).toLocaleString("fa-IR")} تومان</p>
      {error ? <p className="auth-error">{error}</p> : null}

      <button
        className="button button-primary button-large"
        type="submit"
        disabled={loading || !selected || !gatewayAvailable}
      >
        {loading ? <LoaderCircle className="spin" size={18} /> : null}
        تأیید و انتقال به درگاه
      </button>
      <button className="button button-quiet" type="button" onClick={() => router.push("/account/wallet")} disabled={loading}>
        انصراف
      </button>
    </form>
  );
}
