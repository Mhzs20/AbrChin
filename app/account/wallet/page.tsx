import type { Metadata } from "next";

import { WalletPanel } from "@/components/wallet-panel";
import { requireCustomerPage } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: "کیف پول | حساب من | ابرچین",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function WalletPage() {
  await requireCustomerPage();
  return <WalletPanel />;
}
