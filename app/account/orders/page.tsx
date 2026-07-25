import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { OrdersPanel } from "@/components/orders-panel";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "سفارش‌ها | ابرچین", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account/orders");
  return (
    <section className="account-page page-view">
      <div className="page-heading">
        <h1>سفارش‌های من</h1>
        <p>ثبت و پرداخت بسته‌های آزمایشی ابرچین از کیف پول.</p>
      </div>
      <OrdersPanel />
    </section>
  );
}
