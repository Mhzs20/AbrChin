import type { Metadata } from "next";
import Link from "next/link";

import { MoneyDisplay, PageHeader, SectionCard, StatCard, StatusBadge } from "@/components/product";
import { getAdminDashboardStats, getRecentAdminOperations, getSystemStatuses } from "@/lib/admin/dashboard";
import { infrastructureOrderStatusLabel } from "@/lib/labels/infrastructure";
import { ledgerTypeLabel } from "@/lib/labels/ledger";
import { formatTomanFa } from "@/lib/money";

export const metadata: Metadata = {
  title: "داشبورد | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const [stats, system, recent] = await Promise.all([
    getAdminDashboardStats(),
    getSystemStatuses(),
    getRecentAdminOperations(),
  ]);

  return (
    <>
      <PageHeader
        title="داشبورد عملیاتی"
        description="نمای کلی سفارش‌ها، مالی و وضعیت سرویس‌ها"
        actions={
          <Link href="/admin/infrastructure/orders" className="product-btn product-btn--primary">
            سفارش‌های منتظر تأمین
          </Link>
        }
      />

      <div className="product-stat-grid">
        <StatCard label="منتظر تأمین" value={stats.waitingFunding.toLocaleString("fa-IR")} />
        <StatCard label="در صف" value={stats.queuedOrders.toLocaleString("fa-IR")} />
        <StatCard label="Provisioning در حال اجرا" value={stats.provisioningJobs.toLocaleString("fa-IR")} />
        <StatCard label="Provisioning ناموفق" value={stats.failedJobs.toLocaleString("fa-IR")} />
        <StatCard label="Blocked" value={stats.blockedOrders.toLocaleString("fa-IR")} />
        <StatCard label="Needs Reconciliation" value={stats.reconciliationOrders.toLocaleString("fa-IR")} />
        <StatCard label="سرورهای فعال" value={stats.activeInstances.toLocaleString("fa-IR")} />
        <StatCard label="کاربران" value={stats.totalUsers.toLocaleString("fa-IR")} />
        <StatCard label="کاربران جدید امروز" value={stats.newUsersToday.toLocaleString("fa-IR")} />
        <StatCard label="شارژ امروز" value={<MoneyDisplay amount={formatTomanFa(stats.topUpsTodayRial)} />} />
        <StatCard label="خرید امروز" value={<MoneyDisplay amount={formatTomanFa(stats.purchasesTodayRial)} />} />
        <StatCard label="تراکنش ناموفق امروز" value={stats.failedTransactionsToday.toLocaleString("fa-IR")} />
        <StatCard label="اعلان خوانده‌نشده" value={stats.unreadNotifications.toLocaleString("fa-IR")} />
      </div>

      <SectionCard title="وضعیت سرویس‌ها">
        <div className="product-stat-grid">
          <StatCard label="Zibal" value={<StatusBadge label={system.zibal.enabled ? "فعال" : "غیرفعال"} tone={system.zibal.enabled ? "success" : "neutral"} />} />
          <StatCard label="ZarinPal" value={<StatusBadge label={system.zarinpal.enabled ? "فعال" : "غیرفعال"} tone={system.zarinpal.enabled ? "success" : "neutral"} />} />
          <StatCard label="Kavenegar" value={<StatusBadge label={system.kavenegar.configured ? "سالم" : "تنظیم نشده"} tone={system.kavenegar.configured ? "success" : "warning"} />} />
          <StatCard label="هشدار عملیاتی SMS" value={<StatusBadge label={system.kavenegar.operationalAlerts.status} tone={system.kavenegar.operationalAlerts.status === "READY" ? "success" : "warning"} />} />
          <StatCard label="PostgreSQL" value={<StatusBadge label={system.postgres.configured ? "سالم" : "خطا"} tone={system.postgres.configured ? "success" : "danger"} />} />
          <StatCard label="ParsPack" value={<StatusBadge label={system.parspack.message} tone={system.parspack.status === "healthy" ? "success" : "warning"} />} />
          <StatCard label="Worker Provisioning" value={<StatusBadge label={system.worker.label} tone={system.worker.status === "healthy" ? "success" : system.worker.status === "stale" ? "warning" : "danger"} />} />
        </div>
      </SectionCard>

      <SectionCard title="آخرین سفارش‌های منتظر شارژ پارس‌پک">
        {recent.waitingOrders.length === 0 ? (
          <p>موردی نیست.</p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 10 }}>
            {recent.waitingOrders.map((order) => (
              <li key={order.id}>
                {order.user.mobile} — {order.plan.title} — {infrastructureOrderStatusLabel[order.status]}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="آخرین تراکنش‌های مالی">
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
          {recent.recentTransactions.map((tx) => (
            <li key={tx.id}>
              {tx.wallet.user.mobile} — {ledgerTypeLabel[tx.type]} — <MoneyDisplay amount={formatTomanFa(tx.amount)} />
            </li>
          ))}
        </ul>
      </SectionCard>
    </>
  );
}
