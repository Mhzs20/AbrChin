import {
  DeliveryMode,
  InfrastructurePlanPublicationStatus,
  type ProviderCatalogItem,
} from "@prisma/client";

import { selectReadyServerImage } from "@/lib/cloud-servers/catalog";
import { prisma } from "@/lib/db";
import { isParchinConfigSellable } from "@/lib/parchin/sellable";
import { assertAdminActorTx } from "@/lib/admin/command-receipt";
import {
  compatibleImageCodes,
  PricingUnavailableError,
  requireVerifiedSellablePricing,
  resolveCatalogItemPricing,
} from "@/lib/pricing/plan-pricing";
import {
  classifyStorefrontCapacityTier,
  DEFAULT_STOREFRONT_CAPACITY_RULES,
} from "@/lib/storefront/capacity-rules";
import { storefrontProviderCode } from "@/lib/storefront/provider-codes";
import { readyServerTitle } from "@/lib/cloud-servers/catalog";
import { regionShortLabelFromDisplayName } from "@/lib/cloud-servers/region-naming";
import { storefrontParchinLevel } from "@/lib/storefront/tiers";

function safePlanCode(item: ProviderCatalogItem) {
  const code = storefrontProviderCode(item.provider);
  const raw = `SF_${code}_${item.regionCode}_${item.sizeCode}_${item.externalPlanId}`
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 64);
  return raw.replace(/^_|_$/g, "") || `SF_${code}_${item.id.slice(0, 12)}`;
}

export async function ensurePublishedPlanForCatalogItem(
  item: ProviderCatalogItem,
) {
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
  const [providerPricing, productPricing, commerce, storefrontSettings] =
    await Promise.all([
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
      prisma.commercePricingConfig.findUnique({ where: { id: "default" } }),
      prisma.storefrontAssortmentSettings.findUnique({
        where: { id: "default" },
      }),
    ]);
  const capacityRules = storefrontSettings ?? DEFAULT_STOREFRONT_CAPACITY_RULES;
  const tier = classifyStorefrontCapacityTier(
    {
      vcpu: item.vcpu ?? 0,
      ramGb: item.ramMb == null ? 0 : Math.ceil(item.ramMb / 1024),
      diskGb: item.diskGb ?? undefined,
    },
    capacityRules,
  );
  const parchinLevel = storefrontParchinLevel(tier);
  const parchin = await prisma.parchinPricingConfig.findFirst({
    where: { level: parchinLevel, active: true },
  });
  if (!isParchinConfigSellable(parchin)) {
    throw new PricingUnavailableError();
  }
  if (!providerPricing || !productPricing) {
    throw new PricingUnavailableError();
  }
  const priced = requireVerifiedSellablePricing(
    resolveCatalogItemPricing(item, providerPricing, {
      productMarkupBasisPoints: productPricing.markupBasisPoints,
      taxBasisPoints: commerce?.taxBps ?? 1000,
      parchinLevel,
      parchinPriceRial: parchin?.priceRial ?? 0n,
      parchinTitle: parchin?.title,
      parchinVersion: parchin?.version,
      termMonths: 1,
    }),
  );
  // One canonical name per plan, derived from region + resources. The old
  // generator numbered by render order and was called with a hardcoded
  // index: 1, so every plan was stored as «ابر ۱ تهران».
  // For a region the static map doesn't know, the persisted display name
  // assigned at discovery keeps the title customer-safe.
  const regionConfig = await prisma.providerRegionConfig.findUnique({
    where: {
      provider_apiVersion_regionCode: {
        provider: item.provider,
        apiVersion: item.apiVersion,
        regionCode: item.regionCode,
      },
    },
    select: { displayName: true },
  });
  const title = readyServerTitle({
    regionCode: item.regionCode,
    vcpu: item.vcpu,
    ramMb: item.ramMb,
    locationLabel: regionConfig
      ? regionShortLabelFromDisplayName(regionConfig.displayName)
      : null,
  });

  if (
    existing?.active &&
    existing.publicationStatus === InfrastructurePlanPublicationStatus.PUBLISHED &&
    existing.catalogMappingStatus === "MAPPED"
  ) {
    // Launch Amendment 1.L: storefront sale is prepaid-term wallet checkout.
    // Older phase plans published as PAYG_WALLET must be repaired or the
    // customer still sees CloudActivationPanel instead of wallet purchase.
    if (
      existing.billingModel !== "PREPAID_TERM" ||
      existing.billingPolicyVersionId != null ||
      existing.minimumParchinLevel !== parchinLevel ||
      existing.title !== title ||
      (priced.finalPriceRial !== existing.salePriceRial)
    ) {
      return prisma.infrastructurePlan.update({
        where: { id: existing.id },
        data: {
          title,
          billingModel: "PREPAID_TERM",
          billingPolicyVersionId: null,
          minimumParchinLevel: parchinLevel,
          salePriceRial: priced.finalPriceRial,
          renewalPriceRial: priced.finalPriceRial,
          estimatedProviderCostRial: priced.providerBasePriceRial,
        },
      });
    }
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
        title,
        regionCode: item.regionCode,
        sizeCode: item.sizeCode,
        imageCode,
        vcpu: item.vcpu,
        ramGb: item.ramMb == null ? null : Math.ceil(item.ramMb / 1024),
        storageGb: item.diskGb,
        salePriceRial: priced.finalPriceRial,
        renewalPriceRial: priced.finalPriceRial,
        estimatedProviderCostRial: priced.providerBasePriceRial,
        billingModel: "PREPAID_TERM",
        billingPolicyVersionId: null,
        parchinIncluded: true,
        minimumParchinLevel: parchinLevel,
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
        title,
        salePriceRial: priced.finalPriceRial,
        renewalPriceRial: priced.finalPriceRial,
        estimatedProviderCostRial: priced.providerBasePriceRial,
        billingModel: "PREPAID_TERM",
        billingPolicyVersionId: null,
        parchinIncluded: true,
        minimumParchinLevel: parchinLevel,
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
      salePriceRial: priced.finalPriceRial,
      renewalPriceRial: priced.finalPriceRial,
      estimatedProviderCostRial: priced.providerBasePriceRial,
      deliveryEstimateMinutes: 0,
      parchinIncluded: true,
      minimumParchinLevel: parchinLevel,
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
 * Admin-only: publish verified-price plans for curated enabled slots.
 * Does not enable pricing configs, open regions, or publish fallback catalog.
 */
export async function ensureStorefrontSaleReady(input: { actorUserId: string }) {
  await prisma.$transaction(async (tx) => {
    await assertAdminActorTx(tx, input.actorUserId);
  });

  const slots = await prisma.storefrontAssortmentSlot.findMany({
    where: { enabled: true },
    include: { catalogItem: true },
  });

  const slotItems = slots
    .map((slot) => slot.catalogItem)
    .filter((item): item is ProviderCatalogItem => item != null);

  let published = 0;
  const seen = new Set<string>();
  for (const item of slotItems) {
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
