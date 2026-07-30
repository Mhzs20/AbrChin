import type { Metadata } from "next";

import { ProviderPanel } from "@/components/admin/provider-panel";
import { CommercePricingPanel } from "@/components/admin/commerce-pricing-panel";
import {
  getCommercePricingAdminView,
  getProviderCatalogAdminView,
  getProviderSyncRunsAdminView,
  getSystemStatuses,
} from "@/lib/admin/dashboard";

export const metadata: Metadata = {
  title: "تأمین‌کننده‌ها | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminProvidersPage() {
  const [system, catalogItems, pricing, syncRuns] = await Promise.all([
    getSystemStatuses(),
    getProviderCatalogAdminView(),
    getCommercePricingAdminView(),
    getProviderSyncRunsAdminView(),
  ]);
  return (
    <>
      <CommercePricingPanel initial={pricing} />
      <ProviderPanel
        provider="ARVAN"
        title="آروان‌کلاد — سرور ابری"
        initial={{
          ...system.arvan,
          status: system.arvan.status,
          configured: system.arvan.status !== "unconfigured",
        }}
        catalogItems={catalogItems}
        syncRuns={syncRuns}
      />
      <ProviderPanel
        provider="PARSPACK"
        title="پارس‌پک — سرور آماده"
        initial={{
          ...system.parspack,
          status: system.parspack.status,
          configured: system.parspack.status !== "unconfigured",
        }}
        catalogItems={catalogItems}
        syncRuns={syncRuns}
      />
    </>
  );
}
