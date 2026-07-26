import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { TransactionsPanel } from "@/components/transactions-panel";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "تراکنش‌ها | حساب من | ابرچین",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account/transactions");
  return <TransactionsPanel />;
}
