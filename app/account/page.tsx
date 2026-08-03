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
            <Link href="/cloud-servers" className="product-btn product-btn--primary">
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
        <StatCard label="مصرف امروز UTC" value={<MoneyDisplay amount={formatTomanFa(overview.billing.todayUsageRial)} />} />
        <StatCard label="سرویس‌های فعال" value={overview.activeServices.toLocaleString("fa-IR")} />
        <StatCard label="سفارش‌های در جریان" value={overview.pendingOrders.toLocaleString("fa-IR")} />
      </div>

      <SectionCard title="Billing مصرفی">
        <p>
          {overview.billing.displayMode !== "DAILY" ? (
            <>
              تخمین ساعتی:{" "}
              <strong>
                {overview.billing.hourlyEstimateRial == null
                  ? "—"
                  : `${formatTomanFa(overview.billing.hourlyEstimateRial)} تومان`}
              </strong>
            </>
          ) : null}
          {overview.billing.displayMode === "BOTH" ? " · " : null}
          {overview.billing.displayMode !== "HOURLY" ? (
            <>
              تخمین ۲۴ ساعت:{" "}
              <strong>
                {overview.billing.dailyEstimateRial == null
                  ? "—"
                  : `${formatTomanFa(overview.billing.dailyEstimateRial)} تومان`}
              </strong>
            </>
          ) : null}
        </p>
        <p>
          Cadence مالی:{" "}
          <strong>
            {overview.billing.cadence === "HOURLY"
              ? "تسویه ساعتی"
              : overview.billing.cadence === "DAILY"
                ? "تسویه روزانه"
                : "—"}
          </strong>
          {" · "}
          Settlement بعدی:{" "}
          <strong>
            {overview.billing.nextSettlementAt
              ? new Date(
                  overview.billing.nextSettlementAt,
                ).toLocaleString("fa-IR")
              : "—"}
          </strong>
        </p>
        <p>
          Runway تقریبی:{" "}
          <strong>
            {overview.billing.runwaySeconds == null
              ? "—"
              : `${Number(overview.billing.runwaySeconds / 3_600n).toLocaleString("fa-IR")} ساعت`}
          </strong>
          {" · "}
          تغییر منابع در انتظار:{" "}
          <strong>{overview.billing.pendingResourceChanges.toLocaleString("fa-IR")}</strong>
        </p>
        <p>
          بدهی باز:{" "}
          <strong>{formatTomanFa(overview.billing.outstandingRial)} تومان</strong>
          {" · "}
          آخرین Settlement:{" "}
          <strong>
            {overview.billing.latestSettlement
              ? `${new Date(overview.billing.latestSettlement.periodEnd).toLocaleString("fa-IR")} — ${overview.billing.latestSettlement.status}`
              : "—"}
          </strong>
        </p>
        {overview.billing.currentResources ? (
          <p>
            منابع فعلی:{" "}
            <strong dir="ltr">
              {overview.billing.currentResources.vcpu} vCPU /{" "}
              {Math.floor(overview.billing.currentResources.ramMb / 1024)} GB
              RAM / {overview.billing.currentResources.diskGb} GB Disk
            </strong>
          </p>
        ) : null}
        <small>
          Estimate قطعی نیست؛ Traffic و Add-onهای قابل‌اندازه‌گیری پس از دریافت
          داده معتبر در Invoice نهایی ثبت می‌شوند.
        </small>
      </SectionCard>

      {overview.isNewUser ? (
        <SectionCard title="شروع کار">
          <EmptyState
            title="هنوز سرویسی ندارید"
            description="منابع را انتخاب کنید، Estimate را ببینید و در صورت نیاز Wallet را شارژ کنید."
            action={
              <Link href="/cloud-servers" className="product-btn product-btn--primary">
                انتخاب منابع
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
