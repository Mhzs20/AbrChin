"use client";

import { LoaderCircle, LogOut, MailCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  FormField,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "@/components/product";
import { performLogout } from "@/lib/auth-client";

type ProfileUser = {
  mobile: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  emailVerifiedAt: string | null;
  mobileVerifiedAt: string | null;
  createdAt: string;
};

export function ProfilePanel({ user }: { user: ProfileUser }) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(user.firstName ?? "");
  const [lastName, setLastName] = useState(user.lastName ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [emailVerifiedAt, setEmailVerifiedAt] = useState(user.emailVerifiedAt);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [verifyStep, setVerifyStep] = useState<"idle" | "code">("idle");
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email }),
      });
      const data = (await response.json()) as {
        error?: string;
        user?: {
          firstName?: string | null;
          lastName?: string | null;
          email?: string | null;
          emailVerifiedAt?: string | null;
          displayName?: string | null;
        };
      };
      if (!response.ok) {
        setError(data.error || "ذخیره پروفایل ممکن نشد.");
        return;
      }
      setFirstName(data.user?.firstName ?? firstName);
      setLastName(data.user?.lastName ?? lastName);
      setEmail(data.user?.email ?? email);
      setEmailVerifiedAt(data.user?.emailVerifiedAt ?? null);
      if (!data.user?.emailVerifiedAt) {
        setVerifyStep("idle");
        setVerifyCode("");
      }
      setMessage("پروفایل با موفقیت ذخیره شد.");
      router.refresh();
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
    } finally {
      setSaving(false);
    }
  }

  async function requestVerification() {
    setVerifyLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/account/email-verification/request", {
        method: "POST",
      });
      const data = (await response.json()) as {
        error?: string;
        resendAvailableIn?: number;
        retryAfterSeconds?: number;
      };
      if (!response.ok) {
        setError(data.error || "ارسال کد تأیید ممکن نشد.");
        if (data.retryAfterSeconds) setResendIn(data.retryAfterSeconds);
        return;
      }
      setVerifyStep("code");
      setResendIn(data.resendAvailableIn ?? 60);
      setMessage("کد تأیید به ایمیل شما ارسال شد.");
      window.setTimeout(() => {
        const tick = window.setInterval(() => {
          setResendIn((v) => {
            if (v <= 1) {
              window.clearInterval(tick);
              return 0;
            }
            return v - 1;
          });
        }, 1000);
      }, 0);
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
    } finally {
      setVerifyLoading(false);
    }
  }

  async function submitVerification(event: FormEvent) {
    event.preventDefault();
    setVerifyLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/account/email-verification/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: verifyCode }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error || "تأیید ایمیل ممکن نشد.");
        return;
      }
      setEmailVerifiedAt(new Date().toISOString());
      setVerifyStep("idle");
      setVerifyCode("");
      setMessage("ایمیل تأیید شده");
      router.refresh();
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
    } finally {
      setVerifyLoading(false);
    }
  }

  async function onLogout() {
    setLoggingOut(true);
    setError("");
    try {
      await performLogout("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "خروج ممکن نشد.");
      setLoggingOut(false);
    }
  }

  const joinedAt = new Date(user.createdAt).toLocaleDateString("fa-IR");
  const emailVerified = Boolean(emailVerifiedAt);

  return (
    <>
      <PageHeader
        title="پروفایل"
        description="هویت حساب، وضعیت تأیید ایمیل و خروج امن"
      />
      <SectionCard title="اطلاعات هویتی">
        <dl style={{ display: "grid", gap: 12, marginBottom: 24 }}>
          <div>
            <dt style={{ color: "var(--product-muted)", fontSize: 13 }}>
              شماره موبایل
            </dt>
            <dd className="product-tech" style={{ margin: "4px 0 0" }} dir="ltr">
              {user.mobile}
            </dd>
          </div>
          <div>
            <dt style={{ color: "var(--product-muted)", fontSize: 13 }}>
              وضعیت تأیید موبایل
            </dt>
            <dd style={{ margin: "4px 0 0" }}>
              {user.mobileVerifiedAt ? (
                <StatusBadge label="تأیید شده" tone="success" />
              ) : (
                <StatusBadge label="تأیید نشده" tone="warning" />
              )}
            </dd>
          </div>
          <div>
            <dt style={{ color: "var(--product-muted)", fontSize: 13 }}>
              تاریخ عضویت
            </dt>
            <dd style={{ margin: "4px 0 0" }}>{joinedAt}</dd>
          </div>
        </dl>

        <form onSubmit={onSave}>
          <FormField id="first-name" label="نام">
            <input
              id="first-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              maxLength={64}
              required
              disabled={saving || loggingOut}
              autoComplete="given-name"
            />
          </FormField>
          <FormField id="last-name" label="نام خانوادگی">
            <input
              id="last-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              maxLength={64}
              required
              disabled={saving || loggingOut}
              autoComplete="family-name"
            />
          </FormField>
          <FormField id="email" label="ایمیل">
            <input
              id="email"
              type="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
              required
              disabled={saving || loggingOut}
              autoComplete="email"
            />
          </FormField>

          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                color: "var(--product-muted)",
                fontSize: 13,
                marginBottom: 6,
              }}
            >
              وضعیت ایمیل
            </div>
            {emailVerified ? (
              <StatusBadge label="تأیید شده" tone="success" />
            ) : (
              <StatusBadge label="تأیید نشده" tone="warning" />
            )}
          </div>

          {error ? (
            <p className="product-error" role="alert">
              {error}
            </p>
          ) : null}
          {message ? (
            <p style={{ color: "#16845f" }} role="status">
              {message}
            </p>
          ) : null}

          <button
            type="submit"
            className="product-btn product-btn--primary"
            disabled={saving || loggingOut}
          >
            {saving ? (
              <LoaderCircle className="spin" size={16} aria-hidden="true" />
            ) : null}
            ذخیره پروفایل
          </button>
        </form>

        {!emailVerified && email ? (
          <div
            style={{
              marginTop: 24,
              paddingTop: 24,
              borderTop: "1px solid var(--product-line)",
            }}
          >
            <h3 style={{ marginTop: 0 }}>تأیید ایمیل</h3>
            <p style={{ color: "var(--product-muted)", fontSize: 14 }}>
              کد ۶ رقمی به ایمیل فعلی حساب ارسال می‌شود. خرید سرور به‌خاطر
              تأیید‌نشدن ایمیل مسدود نمی‌شود.
            </p>
            {verifyStep === "idle" ? (
              <button
                type="button"
                className="product-btn product-btn--quiet"
                disabled={verifyLoading || saving || loggingOut}
                onClick={() => void requestVerification()}
              >
                {verifyLoading ? (
                  <LoaderCircle className="spin" size={16} aria-hidden="true" />
                ) : (
                  <MailCheck size={16} aria-hidden="true" />
                )}
                تأیید ایمیل
              </button>
            ) : (
              <form onSubmit={submitVerification}>
                <FormField id="email-otp" label="کد تأیید ایمیل">
                  <input
                    id="email-otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    dir="ltr"
                    maxLength={6}
                    value={verifyCode}
                    onChange={(e) =>
                      setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    disabled={verifyLoading}
                    required
                  />
                </FormField>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="submit"
                    className="product-btn product-btn--primary"
                    disabled={verifyLoading || verifyCode.length !== 6}
                  >
                    {verifyLoading ? (
                      <LoaderCircle
                        className="spin"
                        size={16}
                        aria-hidden="true"
                      />
                    ) : null}
                    ثبت کد تأیید
                  </button>
                  <button
                    type="button"
                    className="product-btn product-btn--quiet"
                    disabled={verifyLoading || resendIn > 0}
                    onClick={() => void requestVerification()}
                  >
                    {resendIn > 0
                      ? `ارسال مجدد تا ${resendIn} ثانیه`
                      : "ارسال مجدد کد"}
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : null}

        <div
          style={{
            marginTop: 24,
            paddingTop: 24,
            borderTop: "1px solid var(--product-line)",
          }}
        >
          <button
            type="button"
            className="product-btn product-btn--quiet"
            onClick={onLogout}
            disabled={loggingOut || saving}
          >
            {loggingOut ? (
              <LoaderCircle className="spin" size={16} aria-hidden="true" />
            ) : (
              <LogOut size={16} aria-hidden="true" />
            )}
            خروج از حساب
          </button>
        </div>
      </SectionCard>
    </>
  );
}
