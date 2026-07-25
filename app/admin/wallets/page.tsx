import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminWalletsPanel } from "@/components/admin-wallets-panel";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "ادمین کیف پول | ابرچین", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminWalletsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/wallets");
  if (user.role !== "ADMIN") redirect("/account");

  return (
    <section className="account-page page-view">
      <div className="page-heading">
        <h1>ادمین کیف پول</h1>
        <p>جست‌وجو، مشاهده Ledger و تعدیل امن با سند حسابداری.</p>
      </div>
      <AdminWalletsPanel />
    </section>
  );
}
