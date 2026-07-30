"use client";

import { ArrowRight, LoaderCircle, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

type Step = "mobile" | "otp";

function toEnglishDigits(value: string) {
  return value.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
}

export function LoginForm({ nextPath = "/account" }: { nextPath?: string }) {
  const router = useRouter();
  const mobileRef = useRef<HTMLInputElement>(null);
  const otpRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("mobile");
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (step === "mobile") mobileRef.current?.focus();
    if (step === "otp") otpRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  async function requestOtp(nextMobile = mobile) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: nextMobile }),
      });
      const data = (await response.json()) as {
        error?: string;
        resendAvailableIn?: number;
        retryAfterSeconds?: number;
      };

      if (!response.ok) {
        setError(data.error || "ارسال کد ممکن نشد.");
        if (data.retryAfterSeconds) setResendIn(data.retryAfterSeconds);
        return false;
      }

      setResendIn(data.resendAvailableIn ?? 60);
      setStep("otp");
      return true;
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitMobile(event: FormEvent) {
    event.preventDefault();
    const normalizedInput = toEnglishDigits(mobile).replace(/\s+/g, "");
    setMobile(normalizedInput);
    await requestOtp(normalizedInput);
  }

  async function onSubmitOtp(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile, code: toEnglishDigits(code) }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error || "تأیید کد ممکن نشد.");
        return;
      }

      try {
        const raw = window.sessionStorage.getItem(
          "abrchin:conversation:v1",
        );
        const draft = raw
          ? (JSON.parse(raw) as {
              sessionId?: string;
              guestToken?: string;
            })
          : null;
        if (draft?.sessionId && draft.guestToken) {
          await fetch(
            `/api/recommendations/sessions/${draft.sessionId}/claim`,
            {
              method: "POST",
              headers: {
                "x-recommendation-session-token": draft.guestToken,
              },
            },
          );
        }
      } catch {
        // Login must succeed even when a stale guest conversation cannot be
        // claimed. The server-side conversation remains fail-closed.
      }

      router.replace(nextPath);
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
        <span className="eyebrow">
          <Smartphone size={15} aria-hidden="true" />
          ورود با موبایل
        </span>
        <h1>{step === "mobile" ? "ورود به حساب ابرچین" : "کد تأیید را وارد کنید"}</h1>
        <p>
          {step === "mobile"
            ? "شماره موبایل خود را وارد کنید تا کد یکبارمصرف برایتان ارسال شود."
            : `کد ۶ رقمی ارسال‌شده به ${mobile} را وارد کنید.`}
        </p>
      </div>

      {step === "mobile" ? (
        <form className="auth-form" onSubmit={onSubmitMobile}>
          <label className="auth-field" htmlFor="login-mobile">
            <span>شماره موبایل</span>
            <input
              ref={mobileRef}
              id="login-mobile"
              name="mobile"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="09123456789"
              value={mobile}
              onChange={(event) => setMobile(toEnglishDigits(event.target.value))}
              disabled={loading}
              required
              dir="ltr"
            />
          </label>

          {error ? <p className="auth-error" role="alert">{error}</p> : null}

          <button className="button button-primary button-large" type="submit" disabled={loading}>
            {loading ? <LoaderCircle size={18} className="spin" aria-hidden="true" /> : null}
            دریافت کد تأیید
          </button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={onSubmitOtp}>
          <label className="auth-field" htmlFor="login-otp">
            <span>کد تأیید</span>
            <input
              ref={otpRef}
              id="login-otp"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(toEnglishDigits(event.target.value).replace(/\D/g, "").slice(0, 6))}
              disabled={loading}
              required
              dir="ltr"
            />
          </label>

          {error ? <p className="auth-error" role="alert">{error}</p> : null}

          <button className="button button-primary button-large" type="submit" disabled={loading || code.length !== 6}>
            {loading ? <LoaderCircle size={18} className="spin" aria-hidden="true" /> : null}
            تأیید و ورود
          </button>

          <div className="auth-secondary">
            <button
              className="button button-quiet"
              type="button"
              disabled={loading || resendIn > 0}
              onClick={() => requestOtp()}
            >
              {resendIn > 0 ? `ارسال مجدد تا ${resendIn} ثانیه` : "ارسال مجدد کد"}
            </button>
            <button
              className="auth-back"
              type="button"
              disabled={loading}
              onClick={() => {
                setStep("mobile");
                setCode("");
                setError("");
              }}
            >
              <ArrowRight size={16} aria-hidden="true" />
              اصلاح شماره
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
