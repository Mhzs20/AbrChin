import type { Metadata } from "next";

import { AdminPlansPanel } from "@/components/admin/plans-panel";
import { DataTable, MoneyDisplay, PageHeader, StatusBadge, TechnicalValue } from "@/components/product";
import { getAdminPageAccess } from "@/lib/auth/guards";
import { listAllPlans } from "@/lib/orders/plans";
import { deliveryModeLabel } from "@/lib/labels/infrastructure";
import { formatTomanFa } from "@/lib/money";
import { prisma } from "@/lib/db";
import {
  catalogItemBasePriceRial,
  compatibleImageCodes,
} from "@/lib/pricing/plan-pricing";
import { calculateFinalPriceRial } from "@/lib/pricing/provider-pricing";
import { listProviderRegionConfigs } from "@/lib/infrastructure/provider-region-config";
import { countAvailableInventoryByPlan } from "@/lib/infrastructure/preprovisioned-inventory";

export const metadata: Metadata = {
  title: "پلن‌های زیرساخت | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminPlansPage() {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;
  const [plans, catalogItems, pricingConfigs, productPricingConfigs, regions, imageAssets] = await Promise.all([
    listAllPlans(),
    prisma.providerCatalogItem.findMany({
      where: {
        apiVersion: "v1",
        productKind: { in: ["CLOUD_SERVER", "READY_INSTANT_SERVER"] },
        source: "API_CATALOG",
        active: true,
      },
      orderBy: [{ regionCode: "asc" }, { sizeCode: "asc" }],
    }),
    prisma.providerPricingConfig.findMany(),
    prisma.productPricingConfig.findMany({ where: { enabled: true } }),
    listProviderRegionConfigs({
      provider: "ARVAN",
      apiVersion: "v1",
      purpose: "ALL",
    }),
    prisma.providerCatalogAsset.findMany({
      where: {
        provider: "ARVAN",
        apiVersion: "v1",
        kind: "IMAGE",
        status: "ACTIVE",
        available: true,
      },
      orderBy: [{ regionCode: "asc" }, { name: "asc" }],
    }),
  ]);
  const inventoryCounts = await countAvailableInventoryByPlan(
    plans.map((plan) => plan.id),
  );
  const panelPlans = plans.map((plan) => ({
    id: plan.id,
    code: plan.code,
    title: plan.title,
    description: plan.description,
    deliveryMode: plan.deliveryMode,
    catalogItemId: plan.catalogItemId,
    catalogMappingStatus: plan.catalogMappingStatus,
    imageCode: plan.imageCode,
    deliveryEstimateMinutes: plan.deliveryEstimateMinutes,
    parchinIncluded: plan.parchinIncluded,
    active: plan.active,
    publicationStatus: plan.publicationStatus,
    instantDelivery: plan.instantDelivery,
    displayDuringProviderOutage: plan.displayDuringProviderOutage,
    provider: plan.provider,
    productKind: plan.productKind,
    catalogSource: plan.offerSource,
    offerPriceValidUntil:
      plan.offerPriceValidUntil?.toISOString() ?? null,
    availableInventory: inventoryCounts.get(plan.id) ?? 0,
    regionCode: plan.regionCode,
    externalPlanId: plan.catalogItem?.externalPlanId ?? null,
    manualAvailableUnits: plan.catalogItem?.manualAvailableUnits ?? null,
    manualPriceValidUntil:
      plan.catalogItem?.manualPriceValidUntil?.toISOString() ?? null,
    manualBasePriceRial:
      plan.catalogItem?.providerMonthlyPriceIrr?.toString() ?? null,
    vcpu: plan.catalogItem?.vcpu ?? plan.vcpu,
    ramGb:
      plan.catalogItem?.ramMb == null
        ? plan.ramGb
        : Math.ceil(plan.catalogItem.ramMb / 1024),
    storageGb: plan.catalogItem?.diskGb ?? plan.storageGb,
    skuMarkupBasisPoints: plan.skuMarkupBasisPoints,
    basePriceRial: plan.pricing?.providerBasePriceRial.toString() ?? null,
    finalPriceRial: plan.pricing?.finalPriceRial.toString() ?? null,
    imageAssetId:
      imageAssets.find(
        (image) =>
          image.regionCode === plan.regionCode &&
          image.externalId === plan.imageCode,
      )?.id ?? null,
    sortOrder: plan.sortOrder,
  }));
  const panelCatalogItems = catalogItems.map((item) => {
    const pricingConfig = pricingConfigs.find(
      (config) => config.provider === item.provider && config.apiVersion === item.apiVersion,
    );
    const productPricingConfig = productPricingConfigs.find(
      (config) =>
        config.provider === item.provider &&
        config.apiVersion === item.apiVersion &&
        config.productKind === item.productKind,
    );
    const basePriceRial = catalogItemBasePriceRial(item);
    const finalPriceRial =
      basePriceRial != null && pricingConfig
        ? calculateFinalPriceRial(
            basePriceRial,
            pricingConfig.markupBasisPoints +
              (productPricingConfig?.markupBasisPoints ?? 0),
          )
        : null;
    return {
      id: item.id,
      provider: item.provider,
      source: item.source,
      productKind: item.productKind,
      regionCode: item.regionCode,
      sizeCode: item.sizeCode,
      compatibleImageCodes: compatibleImageCodes(item),
      vcpu: item.vcpu,
      ramMb: item.ramMb,
      diskGb: item.diskGb,
      available: item.available,
      providerMarkupBasisPoints: pricingConfig?.markupBasisPoints ?? null,
      productMarkupBasisPoints: productPricingConfig?.markupBasisPoints ?? 0,
      basePriceRial: basePriceRial?.toString() ?? null,
      finalPriceRial: finalPriceRial?.toString() ?? null,
    };
  });

  const columns = [
    { key: "code", header: "کد" },
    { key: "title", header: "عنوان" },
    { key: "region", header: "Region" },
    { key: "size", header: "Size" },
    { key: "mode", header: "نوع" },
    { key: "price", header: "قیمت فروش" },
    { key: "active", header: "وضعیت" },
  ];

  const rows = plans.map((plan) => ({
    id: plan.id,
    cells: {
      code: <TechnicalValue>{plan.code}</TechnicalValue>,
      title: plan.title,
      region: <TechnicalValue>{plan.regionCode}</TechnicalValue>,
      size: <TechnicalValue>{plan.sizeCode}</TechnicalValue>,
      mode: deliveryModeLabel[plan.deliveryMode],
      price: plan.pricing ? (
        <MoneyDisplay amount={formatTomanFa(plan.pricing.finalPriceRial)} />
      ) : (
        "قیمت نامعتبر"
      ),
      active: (
        <StatusBadge
          label={
            plan.catalogMappingStatus !== "MAPPED"
              ? "بدون Mapping"
              : plan.active
                ? "فعال"
                : "غیرفعال"
          }
          tone={plan.active && plan.pricing ? "success" : "neutral"}
        />
      ),
    },
  }));

  return (
    <>
      <PageHeader title="پلن‌های زیرساخت" description="مشخصات محصول روی Catalog Item واقعی؛ منابع و قیمت فقط خواندنی‌اند" />
      <AdminPlansPanel
        initialPlans={panelPlans}
        catalogItems={panelCatalogItems}
        manualOptions={{
          regions: regions.map((region) => ({
            code: region.regionCode,
            label: region.displayName,
            saleEnabled: region.saleEnabled,
          })),
          images: imageAssets.map((image) => ({
            id: image.id,
            regionCode: image.regionCode,
            externalId: image.externalId,
            label: image.name,
          })),
        }}
      />
      <DataTable columns={columns} rows={rows} emptyMessage="پلنی تعریف نشده است." />
    </>
  );
}
