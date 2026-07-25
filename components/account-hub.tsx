"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LoaderCircle, LogOut, Receipt, ShoppingBag, Wallet } from "lucide-react";

type WalletSummary = {
  balanceTomanFa: string;
  status: string;
};

type Tx = {
  id: string;
  type: string;
  amountTomanFa: string;
  description: string | null;
  createdAt: string;
};

type Order = {
  id: string;
  title: string;
  status: string;
  amountTomanFa: string;
};

const typeLabel: Record<string, string> = {
  TOP_UP: "شارژ",
  SERVICE_PURCHASE: "خرید سرویس",
  REFUND: "بازگشت وجه",
  ADMIN_ADJUSTMENT: "تعدیل",
};

export function AccountHub({
  mobile,
  displayName,
  role,
}: {
  mobile: string;
  displayName: string | null;
  role: string;
}) {
  const router = useRouter();
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [name, setName] = useState(displayName ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [walletRes, ordersRes] = await Promise.all([
          fetch("/api/wallet", { cache: "no-store" }),
          fetch("/api/orders", { cache: "no-store" }),
        ]);
        if (!cancelled) {
          if (walletRes.ok) {
            const data = await walletRes.json();
            setWallet(data.wallet);
            setTxs(data.recentTransactions || []);
          }
          if (ordersRes.ok) {
            const data = await ordersRes.json();
            setOrders(data.orders || []);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveName(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "ذخیره نام ممکن نشد.");
        return;
      }
      setName(data.user?.displayName ?? name);
      setMessage("نام ذخیره شد.");
      router.refresh();
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="account-grid">
      <section className="account-card">
        <div className="account-card-head">
          <h2>خلاصه حساب</h2>
          <p>شماره تأییدشده و اطلاعات پروفایل</p>
        </div>
        <dl className="account-meta">
          <div>
            <dt>شماره موبایل</dt>
            <dd dir="ltr">{mobile}</dd>
          </div>
          <div>
            <dt>نقش</dt>
            <dd>{role === "ADMIN" ? "مدیر" : "مشتری"}</dd>
          </div>
        </dl>
        <form className="auth-form" onSubmit={saveName}>
          <label className="auth-field" htmlFor="display-name">
            <span>نام نمایشی</span>
            <input
              id="display-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={2}
              maxLength={64}
              required
              disabled={saving}
            />
          </label>
          {error ? <p className="auth-error">{error}</p> : null}
          {message ? <p className="auth-success">{message}</p> : null}
          <div className="account-actions">
            <button className="button button-primary" type="submit" disabled={saving}>
              {saving ? <LoaderCircle className="spin" size={16} /> : null}
              ذخیره نام
            </button>
            <button className="button button-quiet" type="button" onClick={logout} disabled={loggingOut}>
              <LogOut size={16} /> خروج
            </button>
          </div>
        </form>
      </section>

      <section className="account-card">
        <div className="account-card-head">
          <span className="account-icon"><Wallet size={20} /></span>
          <h2>کیف پول</h2>
          <p>{loading ? "در حال بارگذاری..." : wallet ? `${wallet.balanceTomanFa} تومان` : "—"}</p>
        </div>
        <div className="account-actions">
          <Link className="button button-primary" href="/account/wallet">مشاهده کیف پول</Link>
          <Link className="button button-quiet" href="/account/wallet/topup">شارژ کیف پول</Link>
        </div>
      </section>

      <section className="account-card">
        <div className="account-card-head">
          <span className="account-icon"><Receipt size={20} /></span>
          <h2>آخرین تراکنش‌ها</h2>
        </div>
        {txs.length === 0 ? <p className="account-empty">هنوز تراکنشی ندارید.</p> : (
          <ul className="account-list">
            {txs.map((tx) => (
              <li key={tx.id}>
                <strong>{typeLabel[tx.type] || tx.type}</strong>
                <span>{tx.amountTomanFa} تومان</span>
                <small>{tx.description || "—"}</small>
              </li>
            ))}
          </ul>
        )}
        <Link className="button button-quiet" href="/account/transactions">همه تراکنش‌ها</Link>
      </section>

      <section className="account-card">
        <div className="account-card-head">
          <span className="account-icon"><ShoppingBag size={20} /></span>
          <h2>سفارش‌های من</h2>
        </div>
        {orders.length === 0 ? <p className="account-empty">سفارشی ثبت نشده است.</p> : (
          <ul className="account-list">
            {orders.slice(0, 3).map((order) => (
              <li key={order.id}>
                <strong>{order.title}</strong>
                <span>{order.amountTomanFa} تومان</span>
                <small>{order.status}</small>
              </li>
            ))}
          </ul>
        )}
        <Link className="button button-quiet" href="/account/orders">مدیریت سفارش‌ها</Link>
        {role === "ADMIN" ? (
          <>
            <Link className="button button-quiet" href="/admin/wallets">پنل ادمین کیف پول</Link>
            <Link className="button button-quiet" href="/admin/payment-gateways">مدیریت درگاه‌های پرداخت</Link>
          </>
        ) : null}
      </section>
    </div>
  );
}
