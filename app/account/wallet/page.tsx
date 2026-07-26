import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WalletPanel } from "@/components/wallet-panel";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "کیف پول | حساب من | ابرچین",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function WalletPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account/wallet");
  return <WalletPanel />;
}
