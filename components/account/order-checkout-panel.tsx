"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useToast } from "@/components/product/toast";

export function OrderCheckoutPanel({
  planId,
  planTitle,
  priceToman,
}: {
  planId: string;
  planTitle: string;
  priceToman: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);

  async function handlePurchase() {
    setLoading(true);
    try {
      const createRes = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const createBody = await createRes.json();
      if (!createRes.ok) throw new Error(createBody.error ?? "ساخت سفارش ناموفق بود");

      const payRes = await fetch(`/api/orders/${createBody.order.id}/pay-with-wallet`, { method: "POST" });
      const payBody = await payRes.json();
      if (!payRes.ok) throw new Error(payBody.error ?? "پرداخت ناموفق بود");

      showToast(`سفارش ${planTitle} با موفقیت پرداخت شد.`);
      router.push("/account/orders");
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
