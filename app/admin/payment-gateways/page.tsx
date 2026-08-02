import type { Metadata } from "next";

import { AdminPaymentGatewaysPanel } from "@/components/admin-payment-gateways-panel";
import { PageHeader } from "@/components/product";
import { getAdminPageAccess } from "@/lib/auth/guards";
import { listGatewayConfigs } from "@/lib/payments";

export const metadata: Metadata = {
  title: "درگاه‌های پرداخت | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function AdminPaymentGatewaysPage() {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

  const gateways = await listGatewayConfigs();
  return (
    <>
      <PageHeader title="درگاه‌های پرداخت" description="فعال‌سازی، اولویت و درگاه پیش‌فرض" />
      <AdminPaymentGatewaysPanel initialGateways={gateways} />
    </>
  );
}
