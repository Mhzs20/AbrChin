import {
  DeliveryMode,
  InfrastructurePlanPublicationStatus,
  ParchinLevel,
  type ProviderCatalogItem,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  compatibleImageCodes,
  resolveCatalogItemPricing,
} from "@/lib/pricing/plan-pricing";
import { selectReadyServerImage } from "@/lib/cloud-servers/catalog";
import { storefrontProviderCode } from "@/lib/storefront/provider-codes";
import { storefrontServerTitle } from "@/lib/storefront/presentation";

function safePlanCode(item: ProviderCatalogItem) {
  const code = storefrontProviderCode(item.provider);
  const raw = `SF_${code}_${item.regionCode}_${item.sizeCode}_${item.externalPlanId}`
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 64);
  return raw.replace(/^_|_$/g, "") || `SF_${code}_${item.id.slice(0, 12)}`;
}

async function ensurePublishedPlanForCatalogItem(item: ProviderCatalogItem) {
  const existing = await prisma.infrastructurePlan.findFirst({
    where: {
      catalogItemId: item.id,
      offerSource: "API_CATALOG",
    },
    orderBy: { updatedAt: "desc" },
  });

  const imageCodes = compatibleImageCodes(item);
  const imageCode =
    selectReadyServerImage(imageCodes) ?? imageCodes[0] ?? "linux";
  const [providerPricing, productPricing] = await Promise.all([
    prisma.providerPricingConfig.findFirst({
      where: {
        provider: item.provider,
        apiVersion: item.apiVersion,
        enabled: true,
      },
    }),
    prisma.productPricingConfig.findFirst({
      where: {
        provider: item.provider,
        apiVersion: item.apiVersion,
        productKind: item.productKind,
        enabled: true,
      },
    }),
  ]);
  const priced =
    providerPricing && productPricing
      ? resolveCatalogItemPricing(item, providerPricing, {
          productMarkupBasisPoints: productPricing.markupBasisPoints,
        })
      : null;
  const title = storefrontServerTitle({
    regionCode: item.regionCode,
    index: 1,
  });

  if (
    existing?.active &&
    existing.publicationStatus === InfrastructurePlanPublicationStatus.PUBLISHED &&
    existing.catalogMappingStatus === "MAPPED"
  ) {
    return existing;
  }

  if (existing) {
    return prisma.infrastructurePlan.update({
      where: { id: existing.id },
      data: {
        active: true,
        publicationStatus: InfrastructurePlanPublicationStatus.PUBLISHED,
        catalogMappingStatus: "MAPPED",
        catalogMappedAt: existing.catalogMappedAt ?? new Date(),
        regionCode: item.regionCode,
        sizeCode: item.sizeCode,
        imageCode,
        vcpu: item.vcpu,
        ramGb: item.ramMb == null ? null : Math.ceil(item.ramMb / 1024),
        storageGb: item.diskGb,
        salePriceRial: priced?.finalPriceRial ?? existing.salePriceRial,
        renewalPriceRial: priced?.finalPriceRial ?? existing.renewalPriceRial,
        estimatedProviderCostRial:
          priced?.providerBasePriceRial ?? existing.estimatedProviderCostRial,
        // Launch path: prepaid term + Admin fulfillment (mutations stay off).
        billingModel: "PREPAID_TERM",
        billingPolicyVersionId: null,
        parchinIncluded: true,
        minimumParchinLevel: ParchinLevel.PARCHIN_START,
        displayDuringProviderOutage: true,
      },
    });
  }

  const code = safePlanCode(item);
  const collision = await prisma.infrastructurePlan.findUnique({
    where: { code },
  });
  if (collision) {
    return prisma.infrastructurePlan.update({
      where: { id: collision.id },
      data: {
        catalogItemId: item.id,
        catalogMappingStatus: "MAPPED",
        catalogMappedAt: new Date(),
        active: true,
        publicationStatus: InfrastructurePlanPublicationStatus.PUBLISHED,
        provider: item.provider,
        providerApiVersion: item.apiVersion,
        productKind: item.productKind,
        regionCode: item.regionCode,
        sizeCode: item.sizeCode,
        imageCode,
        title: collision.title || title,
        salePriceRial: priced?.finalPriceRial ?? collision.salePriceRial,
        renewalPriceRial: priced?.finalPriceRial ?? collision.renewalPriceRial,
        estimatedProviderCostRial:
          priced?.providerBasePriceRial ?? collision.estimatedProviderCostRial,
        billingModel: "PREPAID_TERM",
        billingPolicyVersionId: null,
        parchinIncluded: true,
        offerSource: "API_CATALOG",
      },
    });
  }

  return prisma.infrastructurePlan.create({
    data: {
      code,
      title,
      description: "چینش فروشگاهی ابرچین",
      provider: item.provider,
      providerApiVersion: item.apiVersion,
      productKind: item.productKind,
      regionCode: item.regionCode,
      sizeCode: item.sizeCode,
      imageCode,
      deliveryMode: DeliveryMode.MANAGED,
      vcpu: item.vcpu,
      ramGb: item.ramMb == null ? null : Math.ceil(item.ramMb / 1024),
      storageGb: item.diskGb,
      salePriceRial: priced?.finalPriceRial ?? 1n,
      renewalPriceRial: priced?.finalPriceRial ?? 1n,
      estimatedProviderCostRial: priced?.providerBasePriceRial ?? 1n,
      deliveryEstimateMinutes: 0,
      parchinIncluded: true,
      minimumParchinLevel: ParchinLevel.PARCHIN_START,
      active: true,
      publicationStatus: InfrastructurePlanPublicationStatus.PUBLISHED,
      instantDelivery: true,
      displayDuringProviderOutage: true,
      offerSource: "API_CATALOG",
      billingModel: "PREPAID_TERM",
      billingPolicyVersionId: null,
      sortOrder: 0,
      catalogItemId: item.id,
      catalogMappingStatus: "MAPPED",
      catalogMappedAt: new Date(),
    },
  });
}

/**
 * Makes every enabled storefront assortment slot purchasable:
 * publish mapped SKUs, open region sale, enable pricing configs.
 * Does not open provider Mutation gates.
 */
export async function ensureStorefrontSaleReady() {
  const [slots, pricingConfigs, productConfigs] = await Promise.all([
    prisma.storefrontAssortmentSlot.findMany({
      where: { enabled: true },
      include: { catalogItem: true },
    }),
    prisma.providerPricingConfig.findMany(),
    prisma.productPricingConfig.findMany(),
  ]);

  for (const config of pricingConfigs) {
    if (!config.enabled) {
      await prisma.providerPricingConfig.update({
        where: { id: config.id },
        data: { enabled: true },
      });
    }
  }
  for (const config of productConfigs) {
    if (!config.enabled) {
      await prisma.productPricingConfig.update({
        where: { id: config.id },
        data: { enabled: true },
      });
    }
  }

  await prisma.providerRegionConfig.updateMany({
    where: {
      provider: { in: ["ARVAN", "PARSPACK"] },
      syncEnabled: true,
      saleEnabled: false,
    },
    data: { saleEnabled: true },
  });

  let published = 0;
  const seen = new Set<string>();
  for (const slot of slots) {
    const item = slot.catalogItem;
    if (!item || seen.has(item.id)) continue;
    if (!item.active || !item.available || item.status !== "ACTIVE") continue;
    seen.add(item.id);
    await ensurePublishedPlanForCatalogItem(item);
    published += 1;
  }

  return {
    published,
    slotCount: slots.length,
    uniqueCatalogItems: seen.size,
  };
}
