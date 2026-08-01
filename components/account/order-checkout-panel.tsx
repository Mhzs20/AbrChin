"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { useToast } from "@/components/product/toast";

export function OrderCheckoutPanel({
  planId,
  quoteId,
  planTitle,
  priceToman,
}: {
  planId?: string;
  quoteId?: string;
  planTitle: string;
  priceToman: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const topUpKey = useRef<string | null>(null);

  async function handlePurchase() {
    setLoading(true);
    try {
      const createRes = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quoteId ? { quoteId } : { planId }),
      });
      const createBody = await createRes.json();
      if (!createRes.ok) {
        if (createBody.replacementQuote?.id) {
          showToast("قیمت تغییر کرده؛ پیشنهاد تازه نمایش داده شد.");
          router.push(`/account/order/quote/${createBody.replacementQuote.id}`);
          router.refresh();
          return;
        }
        throw new Error(createBody.error ?? "ساخت سفارش ناموفق بود");
      }
      if (createBody.order.amountTomanFa !== priceToman) {
        showToast("قیمت تغییر کرده است؛ قیمت تازه را بررسی و دوباره تأیید کنید.");
        router.refresh();
        return;
      }

      const payRes = await fetch(`/api/orders/${createBody.order.id}/pay-with-wallet`, { method: "POST" });
      const payBody = await payRes.json();
      if (!payRes.ok) {
        if (payBody.replacementQuote?.id) {
          showToast("قیمت تغییر کرده؛ پیشنهاد تازه نمایش داده شد.");
          router.push(`/account/order/quote/${payBody.replacementQuote.id}`);
          router.refresh();
          return;
        }
        if (
          payRes.status === 402 &&
          payBody.code === "insufficient_funds" &&
          payBody.orderId
        ) {
          topUpKey.current ??= crypto.randomUUID();
          const topUpRes = await fetch("/api/wallet/topups", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": topUpKey.current,
            },
            body: JSON.stringify({ orderId: payBody.orderId }),
          });
          const topUpBody = await topUpRes.json();
          if (!topUpRes.ok || !topUpBody.redirectUrl) {
            throw new Error(
              topUpBody.error ?? "ایجاد پرداخت کسری کیف پول ممکن نشد.",
            );
          }
          showToast("فقط کسری دقیق کیف پول از درگاه شارژ می‌شود.");
          window.location.href = topUpBody.redirectUrl;
          return;
        }
        throw new Error(payBody.error ?? "پرداخت ناموفق بود");
      }

      showToast(`سفارش ${planTitle} با موفقیت پرداخت شد.`);
      router.push(`/account/orders/${createBody.order.id}`);
      router.refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "عملیات ناموفق بود");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="product-card" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0 }}>پرداخت</h2>
      <p>مبلغ قابل پرداخت: <strong>{priceToman} تومان</strong></p>
      <button type="button" className="product-btn product-btn--primary" disabled={loading} onClick={handlePurchase}>
        {loading ? "در حال پردازش..." : "پرداخت با کیف پول"}
      </button>
    </section>
  );
}
