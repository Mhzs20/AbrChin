"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type WalletData = {
  balanceTomanFa: string;
  status: string;
  currency: string;
};

type Tx = {
  id: string;
  type: string;
  amountTomanFa: string;
  balanceAfterTomanFa: string;
  description: string | null;
  createdAt: string;
};

export function WalletPanel() {
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/wallet", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) {
          if (!cancelled) setError(data.error || "خطا در دریافت کیف پول");
          return;
        }
        if (!cancelled) {
          setWallet(data.wallet);
          setTxs(data.recentTransactions || []);
        }
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

  if (loading) return <p className="account-empty">در حال بارگذاری کیف پول...</p>;
  if (error) return <p className="auth-error">{error}</p>;
  if (!wallet) return <p className="account-empty">کیف پول پیدا نشد.</p>;

  return (
    <div className="account-grid">
      <section className="account-card">
        <div className="account-card-head">
          <h2>موجودی</h2>
          <p className="wallet-balance">{wallet.balanceTomanFa} تومان</p>
          <small>وضعیت: {wallet.status === "ACTIVE" ? "فعال" : "مسدود"}</small>
        </div>
        <div className="account-actions">
          <Link className="button button-primary" href="/account/wallet/topup">شارژ کیف پول</Link>
          <Link className="button button-quiet" href="/account/transactions">تاریخچه</Link>
        </div>
      </section>
      <section className="account-card">
        <div className="account-card-head"><h2>آخرین تراکنش‌ها</h2></div>
        {txs.length === 0 ? <p className="account-empty">تراکنشی نیست.</p> : (
          <ul className="account-list">
            {txs.map((tx) => (
              <li key={tx.id}>
                <strong>{tx.type}</strong>
                <span>{tx.amountTomanFa} تومان</span>
                <small>مانده: {tx.balanceAfterTomanFa}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
