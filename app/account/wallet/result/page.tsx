import type { Metadata } from "next";

import { TopUpResultPanel } from "@/components/topup-result";
import { requireCustomerPage } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "نتیجه شارژ | ابرچین", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function TopUpResultPage() {
  await requireCustomerPage();
  return (
    <section className="auth-page page-view">
      <TopUpResultPanel />
    </section>
  );
}
