import type { Metadata } from "next";
import Link from "next/link";

import { AccountingCenterPanel } from "@/components/admin/accounting-center-panel";
import { PageHeader } from "@/components/product";
import { getAdminPageAccess } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: "حسابداری | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminAccountingPage() {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

  return (
    <>
      <PageHeader
        title="حسابداری عملیاتی"
        description="سود و زیان مدیریتی فروش سرور، هزینه عملیاتی، مالیات و تطبیق — نه دفتر قانونی."
        actions={
          <>
            <Link
              href="/admin/finance"
              className="product-btn product-btn--quiet"
            >
              مرکز مالی
            </Link>
            <Link
              href="/admin/transactions"
              className="product-btn product-btn--primary"
            >
              تراکنش‌ها
            </Link>
          </>
        }
      />
      <AccountingCenterPanel />
    </>
  );
}
