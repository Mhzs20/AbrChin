"use client";

import { useEffect, useState } from "react";

type Item = {
  id: string;
  type: string;
  direction: string;
  amountTomanFa: string;
  balanceAfterTomanFa: string;
  description: string | null;
  createdAt: string;
  status: string;
};

export function TransactionsPanel() {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/wallet/transactions?page=1&pageSize=50", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) {
          if (!cancelled) setError(data.error || "خطا");
          return;
        }
        if (!cancelled) setItems(data.items || []);
      } catch {
        if (!cancelled) setError("ارتباط برقرار نشد.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className="account-empty">در حال بارگذاری...</p>;
  if (error) return <p className="auth-error">{error}</p>;
  if (items.length === 0) return <p className="account-empty">تراکنشی ثبت نشده است.</p>;

  return (
    <div className="account-card">
      <ul className="account-list dense">
        {items.map((item) => (
          <li key={item.id}>
            <strong>{item.type} · {item.direction}</strong>
            <span>{item.amountTomanFa} تومان</span>
            <small>
              {item.description || "—"} · مانده {item.balanceAfterTomanFa} ·{" "}
              {new Date(item.createdAt).toLocaleString("fa-IR")}
            </small>
          </li>
        ))}
      </ul>
    </div>
  );
}
