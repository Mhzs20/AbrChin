import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireCustomerPage } from "@/lib/auth/guards";
import { CUSTOMER_CLOUD_CONFIGURATOR_PATH } from "@/lib/customer/navigation";

export const metadata: Metadata = {
  title: "انتخاب راهکار | حساب من | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AccountOrderPage() {
  await requireCustomerPage();
  redirect(CUSTOMER_CLOUD_CONFIGURATOR_PATH);
}
