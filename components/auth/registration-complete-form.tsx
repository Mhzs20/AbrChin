"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { safeCustomerReturnPath } from "@/lib/customer/navigation";

export function RegistrationCompleteForm({ mobile }: { mobile: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/complete-registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error || "تکمیل ثبت‌نام ممکن نشد.");
        return;
      }
      const next =
        safeCustomerReturnPath(searchParams.get("next") ?? undefined) ??
        "/account";
      router.replace(next);
      router.refresh();
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-card">
      <div className="auth-card-head">
        <span className="eyebrow">تکمیل ثبت‌نام</span>
        <h1>اطلاعات هویتی خود را وارد کنید</h1>
        <p>
          موبایل <span dir="ltr">{mobile}</span> تأیید شد. برای ورود به پنل، نام،
          نام خانوادگی و ایمیل لازم است.
        </p>
      </div>

      <form className="auth-form" onSubmit={onSubmit}>
        <label className="auth-field" htmlFor="reg-first-name">
          <span>نام</span>
          <input
            id="reg-first-name"
            name="firstName"
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            disabled={loading}
            required
            maxLength={64}
          />
        </label>
        <label className="auth-field" htmlFor="reg-last-name">
          <span>نام خانوادگی</span>
          <input
            id="reg-last-name"
            name="lastName"
            autoComplete="family-name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            disabled={loading}
            required
            maxLength={64}
          />
        </label>
        <label className="auth-field" htmlFor="reg-email">
          <span>ایمیل</span>
          <input
            id="reg-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            required
            maxLength={254}
          />
        </label>

        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}

        <button
          className="button button-primary button-large"
          type="submit"
          disabled={loading}
        >
          {loading ? (
            <LoaderCircle size={18} className="spin" aria-hidden="true" />
          ) : null}
          تکمیل ثبت‌نام و ادامه
        </button>
        <div className="auth-secondary">
          <button
            className="button button-quiet"
            type="button"
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              try {
                await fetch("/api/auth/logout", { method: "POST" });
              } catch {
                // continue to login
              }
              router.replace("/login");
              router.refresh();
            }}
          >
            خروج و ورود با شماره دیگر
          </button>
        </div>
      </form>
    </div>
  );
}
