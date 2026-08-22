import type { Metadata } from "next";
import Link from "next/link";

import { AdminWalletsPanel } from "@/components/admin-wallets-panel";
import {
  DataTable,
  MoneyDisplay,
  PageHeader,
  SectionCard,
  StatCard,
  StatusBadge,
} from "@/components/product";
import { getAdminWalletsOverview } from "@/lib/admin/wallets-overview";
import { getAdminPageAccess } from "@/lib/auth/guards";
import { formatTomanFa } from "@/lib/money";

export const metadata: Metadata = {
  title: "کیف پول‌ها | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function AdminWalletsPage({
  searchParams,
}: {
  searchParams: Promise<{ mobile?: string }>;
}) {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

  const params = await searchParams;
  const initialMobile =
    typeof params.mobile === "string" ? params.mobile.trim() : "";

  const overview = await getAdminWalletsOverview();

  const columns = [
    { key: "mobile", header: "موبایل" },
    { key: "name", header: "نام" },
    { key: "role", header: "نقش" },
    { key: "balance", header: "موجودی کیف پول" },
    { key: "status", header: "وضعیت" },
    { key: "action", header: "اقدام" },
  ];

  const rows = overview.users.map((user) => ({
    id: user.id,
    cells: {
      mobile: <span className="product-tech">{user.mobile}</span>,
      name: user.displayName || "—",
      role: (
        <StatusBadge
          label={user.role === "ADMIN" ? "مدیر" : "مشتری"}
          tone={user.role === "ADMIN" ? "info" : "neutral"}
        />
      ),
      balance: user.wallet ? (
        <MoneyDisplay amount={formatTomanFa(user.wallet.availableBalanceRial)} />
      ) : (
        "۰ تومان"
      ),
      status: user.wallet ? (
        <StatusBadge
          label={user.wallet.status === "ACTIVE" ? "فعال" : "مسدود"}
          tone={user.wallet.status === "ACTIVE" ? "success" : "danger"}
        />
      ) : (
        <StatusBadge label="بدون کیف پول" tone="neutral" />
      ),
      action: (
        <Link
          href={`/admin/wallets?mobile=${encodeURIComponent(user.mobile)}`}
          className="product-btn product-btn--quiet"
        >
          Ledger / تعدیل
        </Link>
      ),
    },
  }));

  return (
    <>
      <PageHeader
        title="کیف پول‌ها"
        description="موجودی کاربران، جمع شارژ سایت، Ledger و تعدیل امن."
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <StatCard
          label="جمع شارژ موفق کیف پول"
          value={<MoneyDisplay amount={formatTomanFa(overview.topUpCreditRial)} />}
          hint={`${overview.topUpCreditCount.toLocaleString("fa-IR")} سند شارژ کیف پول تکمیل‌شده`}
        />
        <StatCard
          label="شارژ خالص (پس از Refund)"
          value={<MoneyDisplay amount={formatTomanFa(overview.netTopUpRial)} />}
          hint={
            overview.topUpRefundRial > 0n
              ? `${formatTomanFa(overview.topUpRefundRial)} تومان Refund ثبت شده`
              : "Refund ثبت‌شده‌ای نیست"
          }
        />
        <StatCard
          label="موجودی کل کیف پول‌ها"
          value={
            <MoneyDisplay
              amount={formatTomanFa(overview.totalAvailableBalanceRial)}
            />
          }
          hint={`${overview.walletCount.toLocaleString("fa-IR")} کیف پول · ${overview.customerCount.toLocaleString("fa-IR")} مشتری`}
        />
        <StatCard
          label="شارژ موفق از درگاه"
          value={
            <MoneyDisplay
              amount={formatTomanFa(overview.succeededGatewayTopUpRial)}
            />
          }
          hint={`${overview.succeededGatewayTopUpCount.toLocaleString("fa-IR")} Top-up درگاهی`}
        />
      </div>

      <SectionCard title="کاربران و موجودی">
        <p style={{ marginTop: 0, color: "var(--product-muted)" }}>
          تا {overview.listedCount.toLocaleString("fa-IR")} کاربر اخیر، مرتب‌شده
          بر اساس موجودی. برای Ledger و تعدیل روی «Ledger / تعدیل» بزنید.
        </p>
        <DataTable
          columns={columns}
          rows={rows}
          emptyMessage="هنوز کاربری ثبت نشده است."
        />
      </SectionCard>

      <SectionCard title="جست‌وجو و تعدیل امن">
        <AdminWalletsPanel initialMobile={initialMobile} />
      </SectionCard>
    </>
  );
}
