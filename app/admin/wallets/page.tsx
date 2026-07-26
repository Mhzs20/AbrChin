import type { Metadata } from "next";

import { AdminWalletsPanel } from "@/components/admin-wallets-panel";
import { PageHeader } from "@/components/product";

export const metadata: Metadata = {
  title: "کیف پول‌ها | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default function AdminWalletsPage() {
  return (
    <>
      <PageHeader title="کیف پول‌ها" description="جست‌وجو، Ledger و تعدیل امن" />
      <AdminWalletsPanel />
    </>
  );
}
