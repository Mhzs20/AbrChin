"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { EmptyState, ErrorState, LoadingSkeleton, MoneyDisplay, PageHeader, SectionCard } from "@/components/product";

type WalletData = {
  balanceTomanFa: string;
  status: string;
  gatewayStatus?: string;
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
  const [suggestions, setSuggestions] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [walletRes, settingsRes] = await Promise.all([
          fetch("/api/wallet", { cache: "no-store" }),
          fetch("/api/wallet/topup-settings", { cache: "no-store" }),
        ]);
        const data = await walletRes.json();
        if (!walletRes.ok) {
          if (!cancelled) setError(data.error || "خطا در دریافت کیف پول");
          return;
        }
        if (!cancelled) {
          setWallet(data.wallet);
          setTxs(data.recentTransactions || []);
        }
        if (settingsRes.ok) {
          const settings = await settingsRes.json();
          if (!cancelled) setSuggestions(settings.suggestedAmountsToman || []);
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

  if (loading) {
    return (
      <>
        <PageHeader title="کیف پول" description="موجودی به تومان نمایش داده می‌شود." />
        <LoadingSkeleton rows={4} />
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHeader title="کیف پول" />
        <ErrorState message={error} />
      </>
    );
  }
  if (!wallet) {
    return (
      <>
        <PageHeader title="کیف پول" />
        <EmptyState title="کیف پول پیدا نشد" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="کیف پول"
        description="موجودی به تومان نمایش داده می‌شود؛ ذخیره داخلی به ریال است."
        actions={
          <Link href="/account/wallet/topup" className="product-btn product-btn--primary">
            شارژ کیف پول
          </Link>
        }
      />

      <SectionCard>
        <div className="product-stat-card-value" style={{ fontSize: 32 }}>
          <MoneyDisplay amount={wallet.balanceTomanFa} />
        </div>
        <p style={{ color: "var(--product-muted)", marginTop: 8 }}>
          وضعیت: {wallet.status === "ACTIVE" ? "فعال" : "مسدود"}
          {wallet.gatewayStatus ? ` · درگاه: ${wallet.gatewayStatus}` : ""}
        </p>
      </SectionCard>

      {suggestions.length > 0 ? (
        <SectionCard title="مبالغ پیشنهادی شارژ">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {suggestions.map((amount) => (
              <Link
                key={amount}
                href={`/account/wallet/topup?amount=${amount}`}
                className="product-btn product-btn--quiet"
              >
                {amount.toLocaleString("fa-IR")} تومان
              </Link>
            ))}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="آخرین تراکنش‌ها">
        {txs.length === 0 ? (
          <EmptyState title="تراکنشی نیست" />
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 12 }}>
            {txs.map((tx) => (
              <li key={tx.id} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span>{tx.type}</span>
                <span><MoneyDisplay amount={tx.amountTomanFa} /></span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/account/transactions" className="product-btn product-btn--quiet" style={{ marginTop: 16 }}>
          همه تراکنش‌ها
        </Link>
      </SectionCard>
    </>
  );
}
