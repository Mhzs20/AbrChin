import type { Metadata } from "next";

import { TransactionsPanel } from "@/components/transactions-panel";
import { requireCustomerPage } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: "تراکنش‌ها | حساب من | ابرچین",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  await requireCustomerPage();
  return <TransactionsPanel />;
}
