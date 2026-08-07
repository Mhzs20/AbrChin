"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function ResultInner() {
  const params = useSearchParams();
  const status = params.get("status") || "failed";
  const topUpId = params.get("topUpId");
  const [detail, setDetail] = useState("");
  const [resumePath, setResumePath] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = window.sessionStorage.getItem(
      "abrchin.walletTopup.returnTo",
    );
    return stored?.startsWith("/") && !stored.startsWith("//")
      ? stored
      : null;
  });
  const [retryable, setRetryable] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [polling, setPolling] = useState(Boolean(params.get("topUpId")));

  useEffect(() => {
    if (!topUpId) return;
    let attempts = 0;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      attempts += 1;
      try {
        const response = await fetch(`/api/wallet/topups/${topUpId}`, { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled) return;
        setDetail(data.topUp?.status || "");
        const apiResume =
          typeof data.topUp?.resumePath === "string"
            ? data.topUp.resumePath
            : null;
        // Prefer explicit quote returnTo from checkout; never wipe it with null.
        if (apiResume) {
          setResumePath(apiResume);
        }
        setRetryable(Boolean(data.topUp?.retryable));
        if (data.topUp?.status === "SUCCEEDED" || data.topUp?.status === "FAILED" || data.topUp?.status === "CANCELED" || attempts >= 8) {
          window.clearInterval(timer);
          setPolling(false);
        }
      } catch {
        if (attempts >= 8) {
          window.clearInterval(timer);
          setPolling(false);
        }
      }
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [topUpId]);

  async function retryPayment() {
    if (!topUpId || retrying) return;
    setRetrying(true);
    try {
      const response = await fetch(`/api/wallet/topups/${topUpId}/retry`, {
        method: "POST",
        headers: {
          "Idempotency-Key": `customer-topup-retry-${crypto.randomUUID()}`,
        },
      });
      const data = await response.json();
      if (!response.ok || typeof data.redirectUrl !== "string") {
        setRetrying(false);
        return;
      }
      window.location.href = data.redirectUrl;
    } catch {
      setRetrying(false);
    }
  }

  const title =
    status === "success" || detail === "SUCCEEDED"
      ? "شارژ با موفقیت انجام شد"
      : status === "review"
        ? "پرداخت در حال تطبیق است"
      : status === "canceled" || detail === "CANCELED"
        ? "پرداخت لغو شد"
        : "شارژ انجام نشد";

  return (
    <div className="auth-card">
      <div className="auth-card-head">
        <h1>{title}</h1>
        <p>
          {polling
            ? "در حال بررسی وضعیت پرداخت..."
            : status === "review"
              ? "وجه دوباره دریافت نمی‌شود؛ نتیجه در صف تطبیق امن بررسی خواهد شد."
              : "می‌توانید به کیف پول برگردید یا تراکنش‌ها را ببینید."}
        </p>
      </div>
      <div className="account-actions">
        {retryable ? (
          <button
            className="button button-primary"
            disabled={retrying}
            onClick={() => void retryPayment()}
            type="button"
          >
            {retrying ? "در حال ساخت تلاش جدید..." : "تلاش پرداخت جدید"}
          </button>
        ) : null}
        {resumePath && (status === "success" || detail === "SUCCEEDED") ? (
          <Link
            className="button button-primary"
            href={resumePath}
            onClick={() => {
              window.sessionStorage.removeItem("abrchin.walletTopup.returnTo");
            }}
          >
            ادامه خرید
          </Link>
        ) : null}
        <Link className="button button-primary" href="/account/wallet">کیف پول</Link>
        <Link className="button button-quiet" href="/account/transactions">تراکنش‌ها</Link>
      </div>
    </div>
  );
}

export function TopUpResultPanel() {
  return (
    <Suspense fallback={<p className="account-empty">در حال بارگذاری نتیجه...</p>}>
      <ResultInner />
    </Suspense>
  );
}
