"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function ResultInner() {
  const params = useSearchParams();
  const status = params.get("status") || "failed";
  const topUpId = params.get("topUpId");
  const [detail, setDetail] = useState("");
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

  const title =
    status === "success" || detail === "SUCCEEDED"
      ? "شارژ با موفقیت انجام شد"
      : status === "canceled" || detail === "CANCELED"
        ? "پرداخت لغو شد"
        : "شارژ انجام نشد";

  return (
    <div className="auth-card">
      <div className="auth-card-head">
        <h1>{title}</h1>
        <p>{polling ? "در حال بررسی وضعیت پرداخت..." : "می‌توانید به کیف پول برگردید یا تراکنش‌ها را ببینید."}</p>
      </div>
      <div className="account-actions">
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
