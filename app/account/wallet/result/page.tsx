import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { TopUpResultPanel } from "@/components/topup-result";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "نتیجه شارژ | ابرچین", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function TopUpResultPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account/wallet/result");
  return (
    <section className="auth-page page-view">
      <TopUpResultPanel />
    </section>
  );
}
