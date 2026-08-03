import type { Metadata } from "next";

import { TopUpForm } from "@/components/topup-form";
import { requireCustomerPage } from "@/lib/auth/guards";
import { getPublicDefaultGatewaySummary } from "@/lib/payments";
import { getTopUpSettingsView } from "@/lib/wallet/topup-settings";
import { safeCustomerReturnPath } from "@/lib/customer/navigation";

export const metadata: Metadata = { title: "شارژ کیف پول | ابرچین", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function TopUpPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  await requireCustomerPage();
  const { returnTo } = await searchParams;

  const topUpSettings = await getTopUpSettingsView();

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
      <TopUpForm
        gatewayAvailable={gatewayAvailable}
        gatewayDisplayName={gatewayDisplayName}
        suggestedAmountsToman={topUpSettings.suggestedAmountsToman}
        minTopUpToman={topUpSettings.minTopUpToman}
        maxTopUpToman={topUpSettings.maxTopUpToman}
        returnTo={safeCustomerReturnPath(returnTo)}
      />
    </section>
  );
}
