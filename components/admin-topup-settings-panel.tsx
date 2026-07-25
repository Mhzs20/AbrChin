"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";

type Settings = {
  suggestedAmountsToman: number[];
  minTopUpToman: number;
  maxTopUpToman: number;
  updatedAt: string;
  updatedBy: { id: string; mobile: string; displayName: string | null } | null;
};

export function AdminTopUpSettingsPanel({ initialSettings }: { initialSettings: Settings }) {
  const [settings, setSettings] = useState(initialSettings);
  const [amounts, setAmounts] = useState(
    initialSettings.suggestedAmountsToman.map((value) => String(value)),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    setError("");
    setMessage("");

    const suggestedAmountsToman = amounts.map((value) => Number.parseInt(value, 10));

    try {
      const response = await fetch("/api/admin/wallet-topup-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestedAmountsToman }),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json.error || "ذخیره ناموفق بود.");
        return;
      }

      setSettings(json.settings);
      setAmounts(json.settings.suggestedAmountsToman.map((value: number) => String(value)));
      setMessage(json.message || "ذخیره شد.");
    } catch {
      setError("ارتباط برقرار نشد.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="account-card auth-form" onSubmit={save}>
      <div className="account-card-head">
        <h2>مبالغ پیشنهادی</h2>
        <p>
          چهار مبلغ ثابت برای دکمه‌های صفحه شارژ. هر مبلغ باید بین{" "}
          {settings.minTopUpToman.toLocaleString("fa-IR")} تا {settings.maxTopUpToman.toLocaleString("fa-IR")} تومان باشد.
        </p>
      </div>

      <div className="topup-settings-grid">
        {amounts.map((value, index) => (
          <label key={index} className="auth-field" htmlFor={`suggestion-${index}`}>
            <span>مبلغ {index + 1} (تومان)</span>
            <input
              id={`suggestion-${index}`}
              inputMode="numeric"
              dir="ltr"
              value={value}
              disabled={loading}
              onChange={(event) => {
                const next = [...amounts];
                next[index] = event.target.value.replace(/\D/g, "");
                setAmounts(next);
              }}
            />
          </label>
        ))}
      </div>

      <p className="topup-summary">
        آخرین ویرایش: {new Date(settings.updatedAt).toLocaleString("fa-IR")}
        {settings.updatedBy ? ` · ${settings.updatedBy.displayName || settings.updatedBy.mobile}` : ""}
      </p>

      {error ? <p className="auth-error">{error}</p> : null}
      {message ? <p className="auth-success">{message}</p> : null}

      <button className="button button-primary" type="submit" disabled={loading}>
        {loading ? <LoaderCircle className="spin" size={18} /> : null}
        ذخیره مبالغ پیشنهادی
      </button>
    </form>
  );
}
