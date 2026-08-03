"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { useToast } from "@/components/product/toast";

type Cadence = "HOURLY" | "DAILY";

export function CloudActivationPanel({
  quoteId,
  hourlyEstimateToman,
  dailyEstimateToman,
  hourlyMinimumCreditToman,
  dailyMinimumCreditToman,
  walletBalanceToman,
  availability,
  displayMode,
}: {
  quoteId: string;
  hourlyEstimateToman: string;
  dailyEstimateToman: string;
  hourlyMinimumCreditToman: string;
  dailyMinimumCreditToman: string;
  walletBalanceToman: string;
  availability: "HOURLY_ONLY" | "DAILY_ONLY" | "HOURLY_AND_DAILY";
  displayMode: "HOURLY" | "DAILY" | "BOTH";
}) {
  const { showToast } = useToast();
  const [cadence, setCadence] = useState<Cadence>(
    availability === "DAILY_ONLY" ? "DAILY" : "HOURLY",
  );
  const [loading, setLoading] = useState(false);
  const [activation, setActivation] = useState<{
    id: string;
    serviceOrderId: string;
    status: string;
  } | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  async function submit() {
    setLoading(true);
    try {
      idempotencyKey.current ??= crypto.randomUUID();
      const response = await fetch("/api/activation-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify({ quoteId, cadence }),
      });
      const body = (await response.json()) as {
        error?: string;
        activation?: {
          id: string;
          serviceOrderId: string;
          status: string;
        };
      };
      if (!response.ok || !body.activation) {
        throw new Error(body.error ?? "ثبت درخواست فعال‌سازی ممکن نشد.");
      }
      setActivation(body.activation);
      showToast(
        body.activation.status === "CREDIT_REQUIRED"
          ? "برای ادامه، کیف پول را تا حداقل اعتبار لازم شارژ کنید."
          : "درخواست فعال‌سازی ثبت شد و منتظر تأیید Admin است.",
      );
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "ثبت درخواست ناموفق بود.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="product-card" aria-labelledby="activation-title">
      <h2 id="activation-title" style={{ marginTop: 0 }}>
        فعال‌سازی Wallet-first
      </h2>
      {availability === "HOURLY_AND_DAILY" ? (
        <label>
          دوره تسویه
          <select
            value={cadence}
            onChange={(event) => setCadence(event.target.value as Cadence)}
          >
            <option value="HOURLY">ساعتی</option>
            <option value="DAILY">روزانه</option>
          </select>
        </label>
      ) : null}
      <p>
        {displayMode !== "DAILY" ? (
          <>
            تخمین ساعتی: <strong>{hourlyEstimateToman} تومان</strong>
          </>
        ) : null}
        {displayMode === "BOTH" ? <br /> : null}
        {displayMode !== "HOURLY" ? (
          <>
            تخمین ۲۴ ساعت: <strong>{dailyEstimateToman} تومان</strong>
          </>
        ) : null}
      </p>
      <p>
        موجودی Wallet: <strong>{walletBalanceToman} تومان</strong>
        <br />
        حداقل اعتبار فعال‌سازی:{" "}
        <strong>
          {cadence === "HOURLY"
            ? hourlyMinimumCreditToman
            : dailyMinimumCreditToman}{" "}
          تومان
        </strong>
      </p>
      <small>
        این مبلغ Estimate است؛ Invoice نهایی می‌تواند Traffic یا Add-onهای
        قابل‌اندازه‌گیری و تأییدشده را جداگانه نشان دهد. ثبت درخواست هیچ مبلغی
        از Wallet کم نمی‌کند و هیچ Provider Mutation اجرا نمی‌شود.
      </small>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
        <button
          className="product-btn product-btn--primary"
          disabled={loading}
          onClick={submit}
          type="button"
        >
          {loading ? "در حال ثبت..." : "ثبت درخواست فعال‌سازی"}
        </button>
        <Link
          className="product-btn product-btn--quiet"
          href={`/account/wallet/topup?returnTo=${encodeURIComponent(`/cloud-servers/quote/${quoteId}`)}`}
        >
          شارژ Wallet
        </Link>
      </div>
      {activation ? (
        <p role="status">
          {activation.status === "CREDIT_REQUIRED"
            ? "درخواست حفظ شد؛ پس از شارژ Wallet همین دکمه را دوباره بزنید."
            : "درخواست ثبت شد؛ آماده‌سازی فقط پس از تأیید اول Admin شروع می‌شود."}
          {" "}
          <Link href={`/account/orders/${activation.serviceOrderId}`}>
            پیگیری درخواست
          </Link>
        </p>
      ) : null}
    </section>
  );
}
