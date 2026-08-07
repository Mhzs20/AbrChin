"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

type Lookup = {
  user: { mobile: string; displayName: string | null; role: string };
  wallet: { balanceTomanFa: string; status: string };
  ledger: Array<{
    id: string;
    type: string;
    direction: string;
    amountTomanFa: string;
    balanceAfterTomanFa: string;
    description: string | null;
    createdAt: string;
  }>;
};

export function AdminWalletsPanel({
  initialMobile = "",
}: {
  initialMobile?: string;
}) {
  const [mobile, setMobile] = useState(initialMobile);
  const [data, setData] = useState<Lookup | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [amountToman, setAmountToman] = useState("10000");
  const [direction, setDirection] = useState<"CREDIT" | "DEBIT">("CREDIT");
  const [reason, setReason] = useState("");
  // Sync a changed initialMobile during render (React-sanctioned pattern)
  // instead of setState inside an effect.
  const [previousInitialMobile, setPreviousInitialMobile] =
    useState(initialMobile);
  if (previousInitialMobile !== initialMobile) {
    setPreviousInitialMobile(initialMobile);
    setMobile(initialMobile);
  }

  async function lookupMobile(targetMobile: string) {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/admin/wallets?mobile=${encodeURIComponent(targetMobile)}`,
        { cache: "no-store" },
      );
      const json = await response.json();
      if (!response.ok) {
        setData(null);
        setError(json.error || "جست‌وجو ناموفق بود.");
        return;
      }
      setData(json);
    } catch {
      setError("ارتباط برقرار نشد.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!initialMobile.trim()) return;
    // Defer past the render commit so the lookup's loading state never
    // cascades synchronously inside the effect.
    const timer = setTimeout(() => {
      void lookupMobile(initialMobile.trim());
    }, 0);
    return () => clearTimeout(timer);
  }, [initialMobile]);

  async function lookup(event: FormEvent) {
    event.preventDefault();
    await lookupMobile(mobile);
  }

  async function adjust(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/wallets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mobile,
          direction,
          amountToman: Number.parseInt(amountToman, 10),
          reason,
        }),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json.error || "ثبت تعدیل ممکن نشد.");
        return;
      }
      setMessage("تعدیل ثبت شد.");
      await lookupMobile(mobile);
    } catch {
      setError("ارتباط برقرار نشد.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="account-grid">
      <section className="account-card">
        <form className="auth-form" onSubmit={lookup}>
          <label className="auth-field">
            <span>جست‌وجوی موبایل</span>
            <input
              dir="ltr"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              required
            />
          </label>
          <button className="button button-primary" type="submit" disabled={loading}>
            {loading ? <LoaderCircle className="spin" size={16} /> : null}
            جست‌وجو
          </button>
        </form>
        {error ? <p className="auth-error">{error}</p> : null}
        {message ? <p className="auth-success">{message}</p> : null}
      </section>

      {data ? (
        <>
          <section className="account-card">
            <div className="account-card-head">
              <h2>{data.user.mobile}</h2>
              <p>
                {data.user.displayName || "بدون نام"} · موجودی{" "}
                {data.wallet.balanceTomanFa} تومان
              </p>
            </div>
            <form className="auth-form" onSubmit={adjust}>
              <label className="auth-field">
                <span>نوع</span>
                <select
                  value={direction}
                  onChange={(e) =>
                    setDirection(e.target.value as "CREDIT" | "DEBIT")
                  }
                >
                  <option value="CREDIT">افزایش</option>
                  <option value="DEBIT">کاهش</option>
                </select>
              </label>
              <label className="auth-field">
                <span>مبلغ تومان</span>
                <input
                  dir="ltr"
                  value={amountToman}
                  onChange={(e) =>
                    setAmountToman(e.target.value.replace(/\D/g, ""))
                  }
                  required
                />
              </label>
              <label className="auth-field">
                <span>دلیل</span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  minLength={3}
                  required
                />
              </label>
              <button
                className="button button-primary"
                type="submit"
                disabled={loading}
              >
                ثبت تعدیل
              </button>
            </form>
          </section>
          <section className="account-card">
            <div className="account-card-head">
              <h2>Ledger</h2>
            </div>
            <ul className="account-list dense">
              {data.ledger.map((entry) => (
                <li key={entry.id}>
                  <strong>
                    {entry.type} · {entry.direction}
                  </strong>
                  <span>{entry.amountTomanFa} تومان</span>
                  <small>
                    {entry.description || "—"} ·{" "}
                    {new Date(entry.createdAt).toLocaleString("fa-IR")}
                  </small>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}
