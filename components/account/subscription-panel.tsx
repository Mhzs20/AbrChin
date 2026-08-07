"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/components/product/confirm-dialog";
import { QuoteCountdown } from "@/components/quote-countdown";
import { formatTomanFa } from "@/lib/money";

type RenewalQuote = {
  id: string;
  finalPriceRial: string;
  currency: string;
  providerPriceCheckedAt: string;
  periodStart: string;
  periodEnd: string;
  expiresAt: string;
};

export function SubscriptionPanel({
  instanceId,
  status: initialStatus,
  currentPeriodEnd: initialPeriodEnd,
  graceEndsAt,
  previousPeriodAmountRial = null,
  serverName = null,
  resourcesLabel = null,
}: {
  instanceId: string;
  status: string;
  currentPeriodEnd: string;
  graceEndsAt: string;
  /** Last paid period amount (source order or previous renewal), rial string. */
  previousPeriodAmountRial?: string | null;
  serverName?: string | null;
  resourcesLabel?: string | null;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState(initialPeriodEnd);
  const [quote, setQuote] = useState<RenewalQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmPay, setConfirmPay] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadQuote() {
    setLoading(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/account/instances/${instanceId}/renew`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "دریافت قیمت تمدید ممکن نیست.");
      setQuote(body.quote);
    } catch (caught) {
      setQuote(null);
      setError(caught instanceof Error ? caught.message : "دریافت قیمت تمدید ممکن نیست.");
    } finally {
      setLoading(false);
    }
  }

  async function renew() {
    if (!quote) return;
    setLoading(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/account/instances/${instanceId}/renew`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ renewalQuoteId: quote.id }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 409) await loadQuote();
        throw new Error(body.error ?? "تمدید ممکن نیست.");
      }
      setStatus(body.subscription.status);
      setCurrentPeriodEnd(body.subscription.currentPeriodEnd);
      setQuote(null);
      setConfirmPay(false);
      setMessage("تمدید با قیمت تأییدشده انجام شد و دوره جدید ثبت شد.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تمدید ممکن نیست.");
    } finally {
      setLoading(false);
    }
  }

  const statusLabels: Record<string, string> = {
    ACTIVE: "فعال",
    PAST_DUE: "در مهلت پرداخت",
    SUSPENDED: "معلق",
    CANCELED: "لغوشده",
    TERMINATED: "خاتمه‌یافته",
  };

  const previous = previousPeriodAmountRial ? BigInt(previousPeriodAmountRial) : null;
  const current = quote ? BigInt(quote.finalPriceRial) : null;
  const delta =
    previous != null && current != null ? current - previous : null;

  return (
    <div>
      <p>وضعیت اشتراک: <strong>{statusLabels[status] ?? status}</strong></p>
      <p>
        اعتبار تا: <strong>{new Date(currentPeriodEnd).toLocaleString("fa-IR")}</strong>
      </p>
      {status === "PAST_DUE" ? (
        <p>
          پایان مهلت پرداخت: <strong>{new Date(graceEndsAt).toLocaleString("fa-IR")}</strong>
        </p>
      ) : null}
      {serverName ? (
        <p>
          سرور: <strong dir="ltr">{serverName}</strong>
        </p>
      ) : null}
      {resourcesLabel ? (
        <p>
          منابع فعلی: <strong dir="ltr">{resourcesLabel}</strong>
        </p>
      ) : null}
      {quote ? (
        <>
          {previous != null ? (
            <p>
              مبلغ دوره قبل:{" "}
              <strong>{formatTomanFa(previous)} تومان</strong>
            </p>
          ) : null}
          <p>
            مبلغ تمدید فعلی:{" "}
            <strong>{formatTomanFa(BigInt(quote.finalPriceRial))} تومان</strong>
          </p>
          {delta != null ? (
            <p>
              اختلاف:{" "}
              <strong>
                {delta === 0n
                  ? "بدون تغییر"
                  : `${delta > 0n ? "+" : "−"}${formatTomanFa(
                      delta < 0n ? -delta : delta,
                    )} تومان`}
              </strong>
              {delta !== 0n ? (
                <small>
                  {" "}
                  (به‌خاطر به‌روزرسانی قیمت فروش فعلی؛ هزینه تأمین‌کننده نمایش
                  داده نمی‌شود)
                </small>
              ) : null}
            </p>
          ) : null}
          <p>
            دوره جدید تا {new Date(quote.periodEnd).toLocaleString("fa-IR")} ·{" "}
            <QuoteCountdown expiresAt={quote.expiresAt} />
          </p>
          <button
            type="button"
            className="product-btn product-btn--primary"
            style={{ minHeight: 44 }}
            disabled={loading || status === "CANCELED" || status === "TERMINATED"}
            onClick={() => setConfirmPay(true)}
          >
            {loading ? "در حال تمدید..." : "تأیید قیمت و پرداخت با کیف پول"}
          </button>
        </>
      ) : (
        <button
          type="button"
          className="product-btn product-btn--quiet"
          style={{ minHeight: 44 }}
          disabled={loading}
          onClick={loadQuote}
        >
          {loading ? "در حال دریافت قیمت..." : "دریافت قیمت تمدید"}
        </button>
      )}
      <p style={{ fontSize: 13 }}>
        تمدید خودکار وجود ندارد؛ هر تمدید فقط بعد از نمایش و تأیید قیمت انجام
        می‌شود.
      </p>
      {message ? <p className="product-success">{message}</p> : null}
      {error ? <p className="product-error">{error}</p> : null}

      <ConfirmDialog
        open={confirmPay}
        title="تأیید پرداخت تمدید"
        loading={loading}
        confirmLabel="پرداخت از کیف پول"
        cancelLabel="انصراف"
        onCancel={() => setConfirmPay(false)}
        onConfirm={() => void renew()}
      >
        {quote ? (
          <>
            <p>
              مبلغ قابل‌پرداخت:{" "}
              <strong>
                {formatTomanFa(BigInt(quote.finalPriceRial))} تومان
              </strong>
            </p>
            <p>
              دوره جدید تا{" "}
              {new Date(quote.periodEnd).toLocaleString("fa-IR")}
            </p>
          </>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
