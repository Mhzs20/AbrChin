import type { Metadata } from "next";
import Link from "next/link";

import { ProviderRegionsPanel } from "@/components/admin/provider-regions-panel";
import { PageHeader } from "@/components/product";
import { getAdminPageAccess } from "@/lib/auth/guards";
import {
  listProviderRegionConfigs,
  syncArvanRegionsFromProvider,
} from "@/lib/infrastructure/provider-region-config";

export const metadata: Metadata = {
  title: "مناطق فروش | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminRegionsPage() {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

  let discovery: Awaited<
    ReturnType<typeof syncArvanRegionsFromProvider>
  > | null = null;
  let discoveryError: string | null = null;
  try {
    discovery = await syncArvanRegionsFromProvider({
      actorUserId: access.user.id,
    });
  } catch (error) {
    discoveryError =
      error instanceof Error ? error.message : "provider_region_discovery_failed";
    console.error("[admin/regions/page-discover]", discoveryError);
  }

  const regions = await listProviderRegionConfigs({
    provider: "ARVAN",
    apiVersion: "v1",
    purpose: "ALL",
  });

  return (
    <>
      <PageHeader
        title="مناطق Sync و فروش"
        description="مناطق از Arvan به‌صورت خودکار پر می‌شوند و پیش‌فرض فعال‌اند مگر خودتان غیرفعال کنید. مشتری نام تأمین‌کننده را نمی‌بیند."
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
        initialDiscovery={
          discovery
            ? {
                discoveredCount: discovery.discoveredCount,
                created: discovery.created,
                refreshed: discovery.refreshed,
                unchanged: discovery.unchanged,
              }
            : null
        }
        initialDiscoveryError={
          discoveryError && regions.length === 0
            ? discoveryError === "provider_auth_failed"
              ? "احراز هویت Provider معتبر نیست؛ جدول Region خالی ماند."
              : "دریافت خودکار Region از سرویس‌دهنده ممکن نشد؛ دکمه دریافت را دوباره بزنید."
            : null
        }
      />
    </>
  );
}
