import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { TopUpForm } from "@/components/topup-form";
import { getPublicDefaultGatewaySummary } from "@/lib/payments";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "شارژ کیف پول | ابرچین", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function TopUpPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account/wallet/topup");

  let gatewayAvailable = false;
  let gatewayDisplayName: string | null = null;
  try {
    const summary = await getPublicDefaultGatewaySummary();
    gatewayAvailable = summary.available;
    gatewayDisplayName = summary.displayName;
  } catch {
    gatewayAvailable = false;
  }

  return (
    <section className="auth-page page-view">
      <TopUpForm gatewayAvailable={gatewayAvailable} gatewayDisplayName={gatewayDisplayName} />
    </section>
  );
}
