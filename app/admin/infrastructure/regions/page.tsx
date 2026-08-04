import type { Metadata } from "next";
import Link from "next/link";

import { ProviderRegionsPanel } from "@/components/admin/provider-regions-panel";
import { PageHeader } from "@/components/product";
import { getAdminPageAccess } from "@/lib/auth/guards";
import { listProviderRegionConfigs } from "@/lib/infrastructure/provider-region-config";

export const metadata: Metadata = {
  title: "مناطق فروش | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminRegionsPage() {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

  const regions = await listProviderRegionConfigs({
    provider: "ARVAN",
    apiVersion: "v1",
    purpose: "ALL",
  });

  return (
    <>
      <PageHeader
        title="مناطق Sync و فروش"
        description="فعال‌بودن Sync و فروش برای هر Region آروان (کد AV). مشتری نام تأمین‌کننده را نمی‌بیند."
        actions={
          <Link
            href="/admin/infrastructure/providers"
            className="product-btn product-btn--quiet"
          >
            بازگشت به منابع
          </Link>
        }
      />

      <ProviderRegionsPanel
        initialRegions={regions.map((region) => ({
          id: region.id,
          regionCode: region.regionCode,
          displayName: region.displayName,
          source: region.source,
          syncEnabled: region.syncEnabled,
          saleEnabled: region.saleEnabled,
          sortOrder: region.sortOrder,
          lastValidatedAt: region.lastValidatedAt?.toISOString() ?? null,
          lastValidationCode: region.lastValidationCode,
        }))}
      />
    </>
  );
}
