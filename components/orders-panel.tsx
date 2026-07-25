"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

type Order = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  amountTomanFa: string;
  planCode: string | null;
};

const PLANS = [
  { code: "STARTER", label: "شروع" },
  { code: "GROWTH", label: "رشد" },
  { code: "MANAGED", label: "مدیریت‌شده" },
];

export function OrdersPanel() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch("/api/orders", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "error");
    setOrders(data.orders || []);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        await refresh();
      } catch {
        if (!cancelled) setError("دریافت سفارش‌ها ممکن نشد.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function createOrder(planCode: string) {
    setError("");
    setMessage("");
    setBusyId(planCode);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planCode }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "ایجاد سفارش ممکن نشد.");
        return;
      }
      setMessage(`سفارش «${data.order.title}» ساخته شد.`);
      await refresh();
    } catch {
      setError("ارتباط برقرار نشد.");
    } finally {
      setBusyId(null);
    }
  }

  async function pay(orderId: string) {
    setError("");
    setMessage("");
    setBusyId(orderId);
    try {
      const response = await fetch(`/api/orders/${orderId}/pay-with-wallet`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "پرداخت ممکن نشد.");
        return;
      }
      setMessage("پرداخت با کیف پول انجام شد.");
      await refresh();
    } catch {
      setError("ارتباط برقرار نشد.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="account-grid">
      <section className="account-card">
        <div className="account-card-head">
          <h2>بسته‌های آزمایشی</h2>
          <p>قیمت‌ها سمت سرور ثابت‌اند و از کیف پول پرداخت می‌شوند.</p>
        </div>
        <div className="account-actions">
          {PLANS.map((plan) => (
            <button
              key={plan.code}
              className="button button-quiet"
              type="button"
              disabled={busyId === plan.code}
              onClick={() => createOrder(plan.code)}
            >
              {busyId === plan.code ? <LoaderCircle className="spin" size={16} /> : null}
              سفارش {plan.label}
            </button>
          ))}
        </div>
        {error ? <p className="auth-error">{error}</p> : null}
        {message ? <p className="auth-success">{message}</p> : null}
      </section>

      <section className="account-card">
        <div className="account-card-head"><h2>سفارش‌های شما</h2></div>
        {loading ? <p className="account-empty">در حال بارگذاری...</p> : null}
        {!loading && orders.length === 0 ? <p className="account-empty">سفارشی نیست.</p> : null}
        <ul className="account-list">
          {orders.map((order) => (
            <li key={order.id}>
              <strong>{order.title}</strong>
              <span>{order.amountTomanFa} تومان · {order.status}</span>
              <small>{order.description}</small>
              {order.status === "PENDING_PAYMENT" ? (
                <button
                  className="button button-primary button-compact"
                  type="button"
                  disabled={busyId === order.id}
                  onClick={() => pay(order.id)}
                >
                  پرداخت با کیف پول
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
