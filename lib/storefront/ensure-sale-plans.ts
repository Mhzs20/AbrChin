import {
  DeliveryMode,
  InfrastructurePlanPublicationStatus,
  InfrastructureProvider,
  ParchinLevel,
  ProviderRegionConfigSource,
  type ProviderCatalogItem,
} from "@prisma/client";

import { readyServerLocation } from "@/lib/cloud-servers/catalog";
import { selectReadyServerImage } from "@/lib/cloud-servers/catalog";
import { prisma } from "@/lib/db";
import {
  compatibleImageCodes,
  resolveCatalogItemPricing,
} from "@/lib/pricing/plan-pricing";
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

async function ensureRegionsForCatalogItems(items: ProviderCatalogItem[]) {
  const seen = new Set<string>();
  for (const item of items) {
    if (
      item.provider !== InfrastructureProvider.ARVAN &&
      item.provider !== InfrastructureProvider.PARSPACK
    ) {
      continue;
    }
    const key = `${item.provider}:${item.apiVersion}:${item.regionCode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const location = readyServerLocation(item.regionCode);
    await prisma.providerRegionConfig.upsert({
      where: {
        provider_apiVersion_regionCode: {
          provider: item.provider,
          apiVersion: item.apiVersion,
          regionCode: item.regionCode,
        },
      },
      create: {
        provider: item.provider,
        apiVersion: item.apiVersion,
        regionCode: item.regionCode,
        displayName: location.label,
        source: ProviderRegionConfigSource.ADMIN,
        syncEnabled: true,
        saleEnabled: true,
        sortOrder: location.sortOrder,
      },
      update: {
        saleEnabled: true,
        syncEnabled: true,
        displayName: location.label,
      },
    });
  }
}

/**
 * Makes curated storefront slots (and a Compass fallback catalog slice)
 * purchasable: publish mapped SKUs, open region sale, enable pricing configs.
 * Does not open provider Mutation gates.
 */
export async function ensureStorefrontSaleReady() {
  const [slots, pricingConfigs, productConfigs, fallbackCatalog] =
    await Promise.all([
      prisma.storefrontAssortmentSlot.findMany({
        where: { enabled: true },
        include: { catalogItem: true },
      }),
      prisma.providerPricingConfig.findMany(),
      prisma.productPricingConfig.findMany(),
      prisma.providerCatalogItem.findMany({
        where: {
          provider: { in: ["ARVAN", "PARSPACK"] },
          source: "API_CATALOG",
          active: true,
          available: true,
          status: "ACTIVE",
          OR: [
            { providerHourlyPriceIrr: { gt: 0n } },
            { providerMonthlyPriceIrr: { gt: 0n } },
          ],
        },
        orderBy: [{ provider: "asc" }, { vcpu: "asc" }, { ramMb: "asc" }],
        take: 48,
      }),
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

  // Open every known region for sale — Founder wants listed inventory sellable.
  await prisma.providerRegionConfig.updateMany({
    where: {
      provider: { in: ["ARVAN", "PARSPACK"] },
      saleEnabled: false,
    },
    data: { saleEnabled: true },
  });

  const slotItems = slots
    .map((slot) => slot.catalogItem)
    .filter((item): item is ProviderCatalogItem => item != null);
  // Publish curated slots and a Compass/storefront fallback slice so an empty
  // or partial assortment cannot leave the site with nothing purchasable.
  const publishPool = [...slotItems, ...fallbackCatalog];

  await ensureRegionsForCatalogItems(publishPool);

  let published = 0;
  const seen = new Set<string>();
  for (const item of publishPool) {
    if (seen.has(item.id)) continue;
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
