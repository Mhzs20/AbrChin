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
  const paymentKey = useRef<string | null>(null);

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

      paymentKey.current ??= crypto.randomUUID();
      const payRes = await fetch(`/api/orders/${createBody.order.id}/payment`, {
        method: "POST",
        headers: { "Idempotency-Key": paymentKey.current },
      });
      const payBody = await payRes.json();
      if (!payRes.ok) {
        throw new Error(payBody.error ?? "پرداخت ناموفق بود");
      }
      if (payBody.alreadyPaid) {
        router.push(`/account/orders/${createBody.order.id}`);
        router.refresh();
        return;
      }
      if (!payBody.redirectUrl) {
        throw new Error("انتقال امن به درگاه پرداخت ممکن نشد.");
      }
      showToast(`در حال انتقال به درگاه پرداخت برای ${planTitle}`);
      window.location.assign(payBody.redirectUrl);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "عملیات ناموفق بود");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="product-card" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0 }}>ثبت سفارش</h2>
      <p>مبلغ قابل پرداخت: <strong>{priceToman} تومان</strong></p>
      <button type="button" className="product-btn product-btn--primary" disabled={loading} onClick={handlePurchase}>
        {loading ? "در حال پردازش..." : "خرید و ثبت سفارش"}
      </button>
    </section>
  );
}
