import type { Metadata } from "next";
import Link from "next/link";

import {
  EmptyState,
  MoneyDisplay,
  PageHeader,
  SectionCard,
  StatCard,
  StatusBadge,
} from "@/components/product";
import { getAccountOverview } from "@/lib/account/queries";
import { requireCustomerPage } from "@/lib/auth/guards";
import { serviceOrderStatusLabel } from "@/lib/labels/infrastructure";
import { formatTomanFa } from "@/lib/money";

export const metadata: Metadata = {
  title: "نمای کلی | حساب من | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AccountOverviewPage() {
  const user = await requireCustomerPage();

  const overview = await getAccountOverview(user.id);
  const greeting = user.displayName;

  return (
    <>
      <PageHeader
        title={greeting ? `سلام، ${greeting}` : "سلام"}
        description="خلاصه وضعیت حساب، کیف پول و سرویس‌های شما"
        actions={
          overview.isNewUser ? (
            <Link href="/account/order" className="product-btn product-btn--primary">
              انتخاب راهکار و شروع
            </Link>
          ) : (
            <Link href="/account/services" className="product-btn product-btn--primary">
              مشاهده سرویس‌ها
            </Link>
          )
        }
      />

      <div className="product-stat-grid">
        <StatCard label="موجودی کیف پول" value={<MoneyDisplay amount={formatTomanFa(overview.walletBalanceRial)} />} />
        <StatCard label="سرویس‌های فعال" value={overview.activeServices.toLocaleString("fa-IR")} />
        <StatCard label="سفارش‌های در جریان" value={overview.pendingOrders.toLocaleString("fa-IR")} />
      </div>

      {overview.isNewUser ? (
        <SectionCard title="شروع کار">
          <EmptyState
            title="هنوز سرویسی ندارید"
            description="برای شروع، کیف پول خود را شارژ کنید و اولین سرور را سفارش دهید."
            action={
              <Link href="/account/wallet/topup" className="product-btn product-btn--primary">
                شارژ کیف پول
              </Link>
            }
          />
        </SectionCard>
      ) : null}

      {overview.latestOrder ? (
        <SectionCard title="آخرین سفارش">
          <p>
            <strong>{overview.latestOrder.title}</strong>
            {" — "}
            <StatusBadge label={serviceOrderStatusLabel[overview.latestOrder.status]} tone="info" />
          </p>
          {overview.latestOrder.stage ? <p>{overview.latestOrder.stage}</p> : null}
          <Link href="/account/orders" className="product-btn product-btn--quiet">
            جزئیات سفارش‌ها
          </Link>
        </SectionCard>
      ) : null}

      <SectionCard title="آخرین تراکنش‌ها">
        {overview.recentTransactions.length === 0 ? (
          <EmptyState title="تراکنشی ثبت نشده" />
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 12 }}>
            {overview.recentTransactions.map((tx) => (
              <li key={tx.id} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span>{tx.type}</span>
                <span><MoneyDisplay amount={tx.amountTomanFa} /></span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </>
  );
}
