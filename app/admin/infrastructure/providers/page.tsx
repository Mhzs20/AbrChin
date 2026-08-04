import type { Metadata } from "next";

import { ProviderPanel } from "@/components/admin/provider-panel";
import { CommercePricingPanel } from "@/components/admin/commerce-pricing-panel";
import { CouponsPanel } from "@/components/admin/coupons-panel";
import { ProviderRegionsPanel } from "@/components/admin/provider-regions-panel";
import {
  getCommercePricingAdminView,
  getProviderCatalogAdminView,
  getProviderSyncRunsAdminView,
  getSystemStatuses,
} from "@/lib/admin/dashboard";
import { getAdminPageAccess } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { listProviderRegionConfigs } from "@/lib/infrastructure/provider-region-config";

export const metadata: Metadata = {
  title: "تأمین‌کننده‌ها | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminProvidersPage() {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

  const [system, catalogItems, pricing, syncRuns, regions, coupons] =
    await Promise.all([
    getSystemStatuses(),
    getProviderCatalogAdminView(),
    getCommercePricingAdminView(),
    getProviderSyncRunsAdminView(),
    listProviderRegionConfigs({ provider: "ARVAN", apiVersion: "v1", purpose: "ALL" }),
    prisma.coupon.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return (
    <>
      <CommercePricingPanel initial={pricing} />
      <CouponsPanel
        initial={coupons.map((coupon) => ({
          id: coupon.id,
          code: coupon.code,
          type: coupon.type,
          scope: coupon.scope,
          discountBps: coupon.discountBps,
          termMonths: coupon.termMonths,
          minDepositRial: coupon.minDepositRial?.toString() ?? null,
          bonusRial: coupon.bonusRial?.toString() ?? null,
          expiresAt: coupon.expiresAt?.toISOString() ?? null,
          maxRedemptions: coupon.maxRedemptions,
          redemptionCount: coupon.redemptionCount,
          active: coupon.active,
        }))}
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
