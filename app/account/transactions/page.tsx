import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { TransactionsPanel } from "@/components/transactions-panel";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "تراکنش‌ها | ابرچین", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account/transactions");
  return (
    <section className="account-page page-view">
      <div className="page-heading">
        <h1>تاریخچه تراکنش‌ها</h1>
        <p>همه حرکت‌های کیف پول شما به تومان.</p>
      </div>
      <TransactionsPanel />
    </section>
  );
}
