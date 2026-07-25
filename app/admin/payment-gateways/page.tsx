import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminPaymentGatewaysPanel } from "@/components/admin-payment-gateways-panel";
import { listGatewayConfigs } from "@/lib/payments";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "مدیریت درگاه‌های پرداخت | ابرچین",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function AdminPaymentGatewaysPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/payment-gateways");
  if (user.role !== "ADMIN") redirect("/account");

  const gateways = await listGatewayConfigs();

  return (
    <section className="account-page page-view">
      <div className="page-heading">
        <h1>مدیریت درگاه‌های پرداخت</h1>
        <p>فعال‌سازی، اولویت و درگاه پیش‌فرض بدون نیاز به Deploy.</p>
      </div>
      <AdminPaymentGatewaysPanel initialGateways={gateways} />
    </section>
  );
}
