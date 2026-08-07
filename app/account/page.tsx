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
  const nearestRenewalLabel = overview.nearestRenewal
    ? `${overview.nearestRenewal.instanceName} · ${new Date(
        overview.nearestRenewal.currentPeriodEnd,
      ).toLocaleDateString("fa-IR")}`
    : null;

  if (overview.isNewUser) {
    return (
      <>
        <PageHeader
          title={greeting ? `سلام، ${greeting}` : "سلام"}
          description="حساب شما آماده شروع است"
          actions={
            <Link href="/cloud-servers" className="product-btn product-btn--primary">
              انتخاب سرور
            </Link>
          }
        />
        <SectionCard title="شروع">
          <EmptyState
            title="هنوز سرویسی ندارید"
            description="یک سرور انتخاب کنید تا پیش‌فاکتور، پرداخت و تحویل را از همین حساب دنبال کنید."
            action={
              <Link href="/cloud-servers" className="product-btn product-btn--primary">
                انتخاب سرور
              </Link>
            }
          />
        </SectionCard>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={greeting ? `سلام، ${greeting}` : "سلام"}
        description="خلاصه وضعیت سرویس‌ها، تمدید، کیف پول و پشتیبانی"
        actions={
          <Link href="/account/services" className="product-btn product-btn--primary">
            مشاهده سرویس‌ها
          </Link>
        }
      />

      <div className="product-stat-grid">
        <StatCard
          label="سرویس‌های فعال"
          value={overview.activeServices.toLocaleString("fa-IR")}
        />
        <StatCard
          label="نزدیک‌ترین تمدید"
          value={nearestRenewalLabel ?? "تمدیدی در صف نیست"}
        />
        <StatCard
          label="موجودی کیف پول"
          value={<MoneyDisplay amount={formatTomanFa(overview.walletBalanceRial)} />}
        />
        <StatCard
          label="درخواست‌های پشتیبانی باز"
          value={overview.openSupportRequests.toLocaleString("fa-IR")}
          action={
            <Link href="/account/support" className="product-btn product-btn--quiet">
              پشتیبانی
            </Link>
          }
        />
        <StatCard
          label="سفارش‌های نیازمند توجه"
          value={overview.pendingOrders.toLocaleString("fa-IR")}
          action={
            overview.pendingOrders > 0 ? (
              <Link href="/account/orders" className="product-btn product-btn--quiet">
                مشاهده سفارش‌ها
              </Link>
            ) : undefined
          }
        />
      </div>

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
          <EmptyState
            title="تراکنشی ثبت نشده"
            description="پس از شارژ کیف پول یا پرداخت سفارش، تراکنش‌ها اینجا دیده می‌شوند."
            action={
              <Link href="/account/wallet/topup" className="product-btn product-btn--quiet">
                شارژ کیف پول
              </Link>
            }
          />
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
