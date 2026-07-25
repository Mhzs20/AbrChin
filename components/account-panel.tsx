"use client";

import { LoaderCircle, LogOut, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { performLogout } from "@/lib/auth-client";

type AccountUser = {
  mobile: string;
  displayName: string | null;
};

export function AccountPanel({ user }: { user: AccountUser }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(user.displayName ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const data = (await response.json()) as { error?: string; user?: AccountUser };
      if (!response.ok) {
        setError(data.error || "ذخیره نام ممکن نشد.");
        return;
      }
      setDisplayName(data.user?.displayName ?? displayName);
      setMessage("نام با موفقیت ذخیره شد.");
      router.refresh();
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
    } finally {
      setSaving(false);
    }
  }

  async function onLogout() {
    setLoggingOut(true);
    setError("");
    try {
      await performLogout("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "خروج ممکن نشد. دوباره تلاش کنید.");
      setLoggingOut(false);
    }
  }

  return (
    <div className="account-grid">
      <section className="account-card" aria-labelledby="account-profile-title">
        <div className="account-card-head">
          <h2 id="account-profile-title">پروفایل</h2>
          <p>اطلاعات پایه‌ی حساب شما</p>
        </div>

        <dl className="account-meta">
          <div>
            <dt>شماره موبایل</dt>
            <dd dir="ltr">{user.mobile}</dd>
          </div>
          <div>
            <dt>نام فعلی</dt>
            <dd>{user.displayName || "هنوز تنظیم نشده"}</dd>
          </div>
        </dl>

        <form className="auth-form" onSubmit={onSave}>
          <label className="auth-field" htmlFor="display-name">
            <span>نام نمایشی</span>
            <input
              id="display-name"
              name="displayName"
              type="text"
              autoComplete="name"
              placeholder="مثلاً محمد"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              disabled={saving}
              required
              minLength={2}
              maxLength={64}
            />
          </label>

          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          {message ? <p className="auth-success" role="status">{message}</p> : null}

          <div className="account-actions">
            <button className="button button-primary" type="submit" disabled={saving}>
              {saving ? <LoaderCircle size={17} className="spin" aria-hidden="true" /> : null}
              ذخیره نام
            </button>
          </div>
        </form>

        <div className="account-actions account-actions--footer">
          <button className="button button-quiet" type="button" onClick={onLogout} disabled={loggingOut || saving}>
            {loggingOut ? <LoaderCircle size={17} className="spin" aria-hidden="true" /> : <LogOut size={17} aria-hidden="true" />}
            خروج از حساب
          </button>
        </div>
      </section>

      <section className="account-card account-placeholder" aria-labelledby="wallet-title">
        <div className="account-card-head">
          <span className="account-icon" aria-hidden="true">
            <Wallet size={20} />
          </span>
          <h2 id="wallet-title">کیف پول</h2>
          <p>در فاز بعد فعال می‌شود</p>
        </div>
      </section>
    </div>
  );
}
