import type {
  ProviderCatalogItem,
  StorefrontChinishTier,
  StorefrontSlotRole,
} from "@prisma/client";

import {
  readyServerDescription,
  readyServerImageLabel,
  readyServerTitle,
  selectReadyServerImage,
} from "@/lib/cloud-servers/catalog";
import { prisma } from "@/lib/db";
import { getCatalogFreshness } from "@/lib/infrastructure/multi-provider-catalog-service";
import { listProviderRegionConfigs } from "@/lib/infrastructure/provider-region-config";
import { isPublicSaleEnabled } from "@/lib/infrastructure/public-sale-policy";
import { resolveCatalogOfferAccess } from "@/lib/infrastructure/catalog-visibility";
import type { PublicPlanOffer } from "@/lib/orders/plans";
import {
  catalogItemBaseHourlyPriceRial,
  catalogItemBasePriceRial,
  compatibleImageCodes,
  resolveCatalogItemPricing,
} from "@/lib/pricing/plan-pricing";
import { calculateFinalPriceRial } from "@/lib/pricing/provider-pricing";
import {
  classifyStorefrontCapacityTier,
  DEFAULT_STOREFRONT_CAPACITY_RULES,
  type StorefrontCapacityRules,
} from "@/lib/storefront/capacity-rules";
import {
  ensurePublishedPlanForCatalogItem,
  ensureStorefrontSaleReady,
} from "@/lib/storefront/ensure-sale-plans";
import {
  compareOffersByAssortmentStyle,
  offerMatchesTierPriceBand,
  priceBandsFromSettings,
} from "@/lib/storefront/price-bands";
import {
  isStorefrontDisplayFresh,
  storefrontLocationLabel,
  storefrontLocationZone,
  storefrontParchinForTier,
  storefrontServerTitle,
  type StorefrontLocationZone,
} from "@/lib/storefront/presentation";
import { storefrontProviderCode } from "@/lib/storefront/provider-codes";
import {
  STOREFRONT_DISPLAY_LIMIT,
  STOREFRONT_PRIMARY_LIMIT,
  STOREFRONT_RESERVE_LIMIT,
  STOREFRONT_TIERS,
  STOREFRONT_ZONE_TARGET,
  storefrontTierDescription,
  storefrontTierLabel,
} from "@/lib/storefront/tiers";

export type StorefrontSlotInput = {
  catalogItemId: string;
  role: StorefrontSlotRole;
  sortOrder: number;
  enabled?: boolean;
};

export type StorefrontTierAdminView = {
  tier: StorefrontChinishTier;
  label: string;
  description: string;
  primaryLimit: number;
  reserveLimit: number;
  displayLimit: number;
  availableCount: number;
  primary: Array<StorefrontSlotAdminRow>;
  reserve: Array<StorefrontSlotAdminRow>;
  preview: PublicPlanOffer[];
};

export type StorefrontSlotAdminRow = {
  id: string;
  catalogItemId: string;
  role: StorefrontSlotRole;
  sortOrder: number;
  enabled: boolean;
  available: boolean;
  provider: string;
  regionCode: string;
  sizeCode: string;
  sizeName: string;
  vcpu: number | null;
  ramGb: number | null;
  storageGb: number | null;
  providerHourlyPriceIrr: string | null;
  providerMonthlyPriceIrr: string | null;
  catalogStatus: string;
};

export type StorefrontPriceDisplay = {
  showHourlyPrice: boolean;
  showDailyPrice: boolean;
  showMonthlyPrice: boolean;
};

export type StorefrontPublicTier = {
  tier: StorefrontChinishTier;
  label: string;
  description: string;
  availableCount: number;
  offers: PublicPlanOffer[];
};

function isCatalogItemDisplayable(
  item: ProviderCatalogItem,
  catalogFresh: boolean,
): boolean {
  if (!item.active || !item.available) return false;
  if (catalogFresh && item.status !== "ACTIVE") return false;
  if (!catalogFresh && item.status !== "ACTIVE" && item.status !== "STALE") {
    return false;
  }
  const hourly = catalogItemBaseHourlyPriceRial(item);
  const monthly = catalogItemBasePriceRial(item);
  return (hourly != null && hourly > 0n) || (monthly != null && monthly > 0n);
}

function toPublicOffer(input: {
  item: ProviderCatalogItem;
  tier: StorefrontChinishTier;
  catalogFresh: boolean;
  markupBasisPoints: number;
  taxBasisPoints: number;
  purchaseState: PublicPlanOffer["purchaseState"];
  purchasable: boolean;
  planId?: string;
  parchinTitle?: string;
}): PublicPlanOffer {
  const hourlyBasePriceRial = catalogItemBaseHourlyPriceRial(input.item);
  const monthlyBasePriceRial = catalogItemBasePriceRial(input.item) ?? 0n;
  const hourlyPriceRial =
    hourlyBasePriceRial == null
      ? null
      : calculateFinalPriceRial(hourlyBasePriceRial, input.markupBasisPoints);
  const monthlyFromProvider =
    monthlyBasePriceRial > 0n
      ? calculateFinalPriceRial(monthlyBasePriceRial, input.markupBasisPoints)
      : null;
  // Display + prepaid term: if only hourly exists, estimate 720h month.
  const monthlyPriceRial =
    monthlyFromProvider ??
    (hourlyPriceRial != null ? hourlyPriceRial * 720n : 0n);
  const imageCodes = compatibleImageCodes(input.item);
  const imageCode =
    selectReadyServerImage(imageCodes) ?? imageCodes[0] ?? "linux";
  return {
    id: input.planId ?? input.item.id,
    title: storefrontServerTitle({
      regionCode: input.item.regionCode,
      index: 1,
    }),
    description: readyServerDescription({
      regionCode: input.item.regionCode,
      imageCode,
    }),
    deliveryMode: "MANAGED",
    productKind: input.item.productKind,
    parchinLevel: storefrontParchinForTier(input.tier),
    parchinTitle: input.parchinTitle,
    providerCode: storefrontProviderCode(input.item.provider),
    regionCode: input.item.regionCode,
    locationLabel: storefrontLocationLabel(input.item.regionCode),
    imageLabel: readyServerImageLabel(imageCode),
    operatingSystemLabels: [...new Set(imageCodes.map(readyServerImageLabel))],
    vcpu: input.item.vcpu,
    ramGb:
      input.item.ramMb == null ? null : Math.ceil(input.item.ramMb / 1024),
    storageGb: input.item.diskGb,
    transferTb: input.item.transfer,
    // Never expose supplier economics on the customer storefront payload.
    providerBaseHourlyPriceRial: null,
    providerBaseMonthlyPriceRial: "0",
    hourlyPriceRial: hourlyPriceRial?.toString() ?? null,
    dailyPriceRial:
      hourlyPriceRial != null ? (hourlyPriceRial * 24n).toString() : null,
    salePriceRial: monthlyPriceRial.toString(),
    renewalPriceRial: monthlyPriceRial.toString(),
    sourceCurrencyCode: input.item.currencyCode,
    sourceAmountUnit: input.item.amountUnit,
    normalizedCurrencyCode: "IRR",
    normalizedAmountUnit: "RIAL",
    billingIntervals: [
      ...(hourlyBasePriceRial == null ? [] : (["HOURLY"] as const)),
      ...(monthlyPriceRial > 0n ? (["MONTHLY"] as const) : []),
    ],
    markupBasisPoints: input.markupBasisPoints,
    taxBasisPoints: input.taxBasisPoints,
    catalogStatus: !input.catalogFresh ? "STALE" : input.item.status,
    purchaseState: input.purchaseState,
    deliveryEstimateMinutes: 0,
    parchinIncluded: true,
    checkedAt: input.item.lastSyncedAt.toISOString(),
    available: input.catalogFresh && input.item.available,
    instantDelivery: true,
    purchasable: input.purchasable,
  };
}

async function loadPricingContext() {
  const [
    providers,
    products,
    commerce,
    parchinRows,
    arvanFreshness,
    parsPackFreshness,
    arvanRegions,
    parsPackRegions,
    publishedPlans,
  ] = await Promise.all([
      prisma.providerPricingConfig.findMany(),
      prisma.productPricingConfig.findMany({ where: { enabled: true } }),
      prisma.commercePricingConfig.findUnique({ where: { id: "default" } }),
      prisma.parchinPricingConfig.findMany({ where: { active: true } }),
      getCatalogFreshness("ARVAN").catch(() => null),
      getCatalogFreshness("PARSPACK").catch(() => null),
      listProviderRegionConfigs({
        provider: "ARVAN",
        apiVersion: "v1",
        purpose: "ALL",
      }).catch(() => []),
      listProviderRegionConfigs({
        provider: "PARSPACK",
        apiVersion: "v1",
        purpose: "ALL",
      }).catch(() => []),
      prisma.infrastructurePlan.findMany({
        where: {
          productKind: { in: ["CLOUD_SERVER", "READY_INSTANT_SERVER"] },
          offerSource: "API_CATALOG",
          active: true,
          publicationStatus: "PUBLISHED",
          catalogMappingStatus: "MAPPED",
          catalogItemId: { not: null },
        },
        select: {
          id: true,
          catalogItemId: true,
          provider: true,
          productKind: true,
          offerSource: true,
          displayDuringProviderOutage: true,
          regionCode: true,
        },
      }),
    ]);
  const freshnessByProvider = {
    ARVAN: arvanFreshness,
    PARSPACK: parsPackFreshness,
  } as const;
  const regionSale = new Map<string, boolean>();
  for (const region of [...arvanRegions, ...parsPackRegions]) {
    regionSale.set(
      `${region.provider}:${region.regionCode}`,
      region.saleEnabled,
    );
  }
  const publishedByCatalogItemId = new Map(
    publishedPlans
      .filter((plan) => plan.catalogItemId)
      .map((plan) => [plan.catalogItemId!, plan]),
  );
  const parchinByLevel = new Map(
    parchinRows.map((row) => [row.level, row.priceRial]),
  );
  const parchinTitleByLevel = new Map(
    parchinRows.map((row) => [row.level, row.title.trim()]),
  );
  return {
    providers,
    products,
    commerce,
    parchinByLevel,
    parchinTitleByLevel,
    freshnessByProvider,
    regionSale,
    publishedByCatalogItemId,
  };
}

function buildOfferForItem(
  item: ProviderCatalogItem,
  tier: StorefrontChinishTier,
  context: Awaited<ReturnType<typeof loadPricingContext>>,
): PublicPlanOffer | null {
  const freshness = context.freshnessByProvider[item.provider];
  if (!freshness) return null;
  // Display path uses 24h freshness; purchase/quote still use provider SLA.
  const catalogFresh = isStorefrontDisplayFresh(freshness.lastSync);
  if (!isCatalogItemDisplayable(item, catalogFresh)) return null;

  const published = context.publishedByCatalogItemId.get(item.id);
  const regionSaleEnabled =
    item.provider !== "ARVAN" ||
    context.regionSale.get(`${item.provider}:${item.regionCode}`) === true;

  const providerPricing = context.providers.find(
    (config) =>
      config.provider === item.provider &&
      config.apiVersion === item.apiVersion &&
      config.enabled,
  );
  const productPricing = context.products.find(
    (config) =>
      config.provider === item.provider &&
      config.apiVersion === item.apiVersion &&
      config.productKind === item.productKind,
  );
  const parchinLevel = storefrontParchinForTier(tier);
  const priced =
    providerPricing && productPricing
      ? resolveCatalogItemPricing(item, providerPricing, {
          productMarkupBasisPoints: productPricing.markupBasisPoints,
          taxBasisPoints: context.commerce?.taxBps ?? 1000,
          parchinLevel,
          parchinPriceRial: context.parchinByLevel.get(parchinLevel) ?? 0n,
        })
      : null;
  const markupBasisPoints = priced?.markupBasisPoints ?? 0;
  const taxBasisPoints = priced?.taxBasisPoints ?? context.commerce?.taxBps ?? 1000;

  const parchinTitle =
    context.parchinTitleByLevel.get(parchinLevel) || undefined;

  if (published) {
    const access = resolveCatalogOfferAccess({
      catalogFresh,
      displayDuringProviderOutage: published.displayDuringProviderOutage,
      publicSaleEnabled: isPublicSaleEnabled({
        provider: published.provider,
        productKind: published.productKind,
        offerSource: published.offerSource,
      }),
      regionSaleEnabled,
    });
    if (!access.visible) return null;
    return toPublicOffer({
      item,
      tier,
      catalogFresh,
      markupBasisPoints,
      taxBasisPoints,
      purchaseState: access.purchaseState,
      purchasable: access.purchasable,
      planId: published.id,
      parchinTitle,
    });
  }

  const access = resolveCatalogOfferAccess({
    catalogFresh,
    displayDuringProviderOutage: true,
    publicSaleEnabled: false,
    regionSaleEnabled,
  });
  if (!access.visible) return null;
  return toPublicOffer({
    item,
    tier,
    catalogFresh,
    markupBasisPoints,
    taxBasisPoints,
    purchaseState:
      item.available && item.status === "ACTIVE"
        ? "SKU_UNPUBLISHED"
        : "UNAVAILABLE",
    purchasable: false,
    parchinTitle,
  });
}

function withStorefrontDisplayTitles(offers: PublicPlanOffer[]): PublicPlanOffer[] {
  const cityCounters = new Map<string, number>();
  return offers.map((offer) => {
    const cityKey = storefrontLocationLabel(offer.regionCode);
    const index = (cityCounters.get(cityKey) ?? 0) + 1;
    cityCounters.set(cityKey, index);
    return {
      ...offer,
      title: storefrontServerTitle({
        regionCode: offer.regionCode,
        index,
      }),
      locationLabel: storefrontLocationLabel(offer.regionCode),
    };
  });
}

function offerMatchesStorefrontTier(
  offer: PublicPlanOffer,
  tier: StorefrontChinishTier,
  rules: StorefrontCapacityRules,
  priceBands: ReturnType<typeof priceBandsFromSettings>,
) {
  const vcpu = offer.vcpu ?? 0;
  const ramGb = offer.ramGb ?? 0;
  const diskGb = offer.storageGb ?? 0;
  if (vcpu <= 0 || ramGb <= 0) return false;
  if (
    classifyStorefrontCapacityTier({ vcpu, ramGb, diskGb }, rules) !== tier
  ) {
    return false;
  }
  const monthly = BigInt(offer.salePriceRial || "0");
  return offerMatchesTierPriceBand(monthly, priceBands[tier]);
}

function zoneCount(
  offers: PublicPlanOffer[],
  zone: StorefrontLocationZone,
) {
  return offers.filter(
    (offer) => storefrontLocationZone(offer.regionCode) === zone,
  ).length;
}

async function publishCatalogItems(items: ProviderCatalogItem[]) {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    await ensurePublishedPlanForCatalogItem(item);
  }
}

export async function resolveStorefrontTierOffers(
  tier: StorefrontChinishTier,
): Promise<{
  availableCount: number;
  offers: PublicPlanOffer[];
}> {
  const [slots, settings] = await Promise.all([
    prisma.storefrontAssortmentSlot.findMany({
      where: { tier, enabled: true },
      include: { catalogItem: true },
      orderBy: [{ role: "asc" }, { sortOrder: "asc" }],
    }),
    prisma.storefrontAssortmentSettings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        autoSuggestEnabled: false,
        ...DEFAULT_STOREFRONT_CAPACITY_RULES,
      },
      update: {},
    }),
  ]);
  const capacityRules: StorefrontCapacityRules = {
    ostovarMinVcpu: settings.ostovarMinVcpu,
    ostovarMinRamGb: settings.ostovarMinRamGb,
    ostovarMinDiskGb: settings.ostovarMinDiskGb,
    kahkeshanMinVcpu: settings.kahkeshanMinVcpu,
    kahkeshanMinRamGb: settings.kahkeshanMinRamGb,
    kahkeshanMinDiskGb: settings.kahkeshanMinDiskGb,
  };
  const priceBands = priceBandsFromSettings(settings);
  const assortmentStyle = settings.assortmentStyle;

  const slotItems = [...slots]
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === "PRIMARY" ? -1 : 1;
      return a.sortOrder - b.sortOrder;
    })
    .map((slot) => slot.catalogItem)
    .filter((item): item is ProviderCatalogItem => item != null);

  // Extra catalog pool for Iran/abroad fill when curated slots are thin.
  const fillPool = await prisma.providerCatalogItem.findMany({
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
    orderBy: [{ vcpu: "asc" }, { ramMb: "asc" }, { diskGb: "asc" }],
    take: 240,
  });

  const publishCandidates = [...slotItems, ...fillPool].filter((item) => {
    const vcpu = item.vcpu ?? 0;
    const ramGb = item.ramMb == null ? 0 : Math.ceil(item.ramMb / 1024);
    const diskGb = item.diskGb ?? 0;
    if (vcpu <= 0 || ramGb <= 0) return false;
    return (
      classifyStorefrontCapacityTier(
        { vcpu, ramGb, diskGb },
        capacityRules,
      ) === tier
    );
  });
  await publishCatalogItems(publishCandidates);

  let context = await loadPricingContext();
  const selectedItems: ProviderCatalogItem[] = [];
  const selected: PublicPlanOffer[] = [];
  const usedIds = new Set<string>();
  const seenResources = new Set<string>();

  function tryPush(item: ProviderCatalogItem) {
    if (usedIds.has(item.id) || selected.length >= STOREFRONT_DISPLAY_LIMIT) {
      return false;
    }
    const offer = buildOfferForItem(item, tier, context);
    if (!offer || !offer.available) return false;
    if (!offerMatchesStorefrontTier(offer, tier, capacityRules, priceBands)) {
      return false;
    }
    const fingerprint = `${offer.vcpu ?? 0}:${offer.ramGb ?? 0}:${offer.storageGb ?? 0}`;
    if (seenResources.has(fingerprint)) return false;
    usedIds.add(item.id);
    seenResources.add(fingerprint);
    selectedItems.push(item);
    selected.push(offer);
    return true;
  }

  for (const item of slotItems) {
    tryPush(item);
  }

  function fillZone(zone: StorefrontLocationZone) {
    let guard = 0;
    while (
      zoneCount(selected, zone) < STOREFRONT_ZONE_TARGET &&
      selected.length < STOREFRONT_DISPLAY_LIMIT &&
      guard < fillPool.length
    ) {
      guard += 1;
      const next = fillPool.find((item) => {
        if (usedIds.has(item.id)) return false;
        if (storefrontLocationZone(item.regionCode) !== zone) return false;
        const vcpu = item.vcpu ?? 0;
        const ramGb = item.ramMb == null ? 0 : Math.ceil(item.ramMb / 1024);
        const diskGb = item.diskGb ?? 0;
        if (vcpu <= 0 || ramGb <= 0) return false;
        return (
          classifyStorefrontCapacityTier(
            { vcpu, ramGb, diskGb },
            capacityRules,
          ) === tier
        );
      });
      if (!next) break;
      if (!tryPush(next)) {
        usedIds.add(next.id);
      }
    }
  }

  fillZone("IRAN");
  fillZone("ABROAD");

  // Rebuild after publish so SKU_UNPUBLISHED becomes PURCHASABLE.
  context = await loadPricingContext();
  const refreshed = selectedItems
    .flatMap((item) => {
      const rebuilt = buildOfferForItem(item, tier, context);
      if (!rebuilt) return [];
      if (
        !offerMatchesStorefrontTier(
          rebuilt,
          tier,
          capacityRules,
          priceBands,
        )
      ) {
        return [];
      }
      return [rebuilt];
    })
    .sort((a, b) =>
      compareOffersByAssortmentStyle(a, b, assortmentStyle),
    );

  return {
    availableCount: refreshed.length,
    offers: withStorefrontDisplayTitles(refreshed),
  };
}

export async function listPublicStorefrontTiers(): Promise<{
  live: boolean;
  degraded: boolean;
  checkedAt: string | null;
  priceDisplay: StorefrontPriceDisplay;
  tiers: StorefrontPublicTier[];
}> {
  // Founder Launch: anything shown in چینش must be purchasable (mutations still off).
  await ensureStorefrontSaleReady().catch((error) => {
    console.error(
      "[storefront:ensure-sale]",
      error instanceof Error ? error.message : "unknown",
    );
  });
  const settings = await prisma.storefrontAssortmentSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      autoSuggestEnabled: false,
      ...DEFAULT_STOREFRONT_CAPACITY_RULES,
    },
    update: {},
  });
  const [arvanFreshness, parsPackFreshness, resolved] = await Promise.all([
    getCatalogFreshness("ARVAN").catch(() => null),
    getCatalogFreshness("PARSPACK").catch(() => null),
    Promise.all(
      STOREFRONT_TIERS.map(async (tier) => {
        const result = await resolveStorefrontTierOffers(tier);
        return {
          tier,
          label: storefrontTierLabel(tier),
          description: storefrontTierDescription(tier),
          availableCount: result.availableCount,
          offers: result.offers,
        };
      }),
    ),
  ]);
  const freshStates = [arvanFreshness, parsPackFreshness].filter(Boolean);
  const allFresh =
    freshStates.length > 0 &&
    freshStates.every((state) => isStorefrontDisplayFresh(state!.lastSync));
  const checkedAt =
    resolved.flatMap((tier) => tier.offers)[0]?.checkedAt ??
    arvanFreshness?.lastSync?.toISOString() ??
    parsPackFreshness?.lastSync?.toISOString() ??
    null;
  return {
    live: allFresh,
    degraded: !allFresh,
    checkedAt,
    priceDisplay: {
      showHourlyPrice: settings.showHourlyPrice,
      showDailyPrice: settings.showDailyPrice,
      showMonthlyPrice: settings.showMonthlyPrice,
    },
    tiers: resolved,
  };
}

function validateSlotBatch(slots: StorefrontSlotInput[]) {
  const primary = slots.filter((slot) => slot.role === "PRIMARY");
  const reserve = slots.filter((slot) => slot.role === "RESERVE");
  if (primary.length > STOREFRONT_PRIMARY_LIMIT) {
    throw new Error("storefront_primary_limit");
  }
  if (reserve.length > STOREFRONT_RESERVE_LIMIT) {
    throw new Error("storefront_reserve_limit");
  }
  const ids = new Set<string>();
  for (const slot of slots) {
    if (!slot.catalogItemId || ids.has(slot.catalogItemId)) {
      throw new Error("storefront_duplicate_catalog_item");
    }
    ids.add(slot.catalogItemId);
    if (!Number.isInteger(slot.sortOrder) || slot.sortOrder < 0) {
      throw new Error("storefront_invalid_sort_order");
    }
  }
}

export async function replaceStorefrontTierSlots(input: {
  tier: StorefrontChinishTier;
  slots: StorefrontSlotInput[];
  actorUserId: string;
}) {
  validateSlotBatch(input.slots);
  const catalogIds = input.slots.map((slot) => slot.catalogItemId);
  const items = await prisma.providerCatalogItem.findMany({
    where: {
      id: { in: catalogIds },
      provider: { in: ["ARVAN", "PARSPACK"] },
      productKind: { in: ["CLOUD_SERVER", "READY_INSTANT_SERVER"] },
      source: "API_CATALOG",
      active: true,
    },
    select: { id: true },
  });
  if (items.length !== catalogIds.length) {
    throw new Error("storefront_invalid_catalog_item");
  }

  await prisma.$transaction(async (tx) => {
    await tx.storefrontAssortmentSlot.deleteMany({
      where: { tier: input.tier },
    });
    if (input.slots.length > 0) {
      await tx.storefrontAssortmentSlot.createMany({
        data: input.slots.map((slot) => ({
          tier: input.tier,
          role: slot.role,
          sortOrder: slot.sortOrder,
          catalogItemId: slot.catalogItemId,
          enabled: slot.enabled !== false,
          updatedById: input.actorUserId,
        })),
      });
    }
    // Manual edits pause auto-suggest so the next sync does not overwrite them.
    await tx.storefrontAssortmentSettings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        autoSuggestEnabled: false,
        updatedById: input.actorUserId,
      },
      update: {
        autoSuggestEnabled: false,
        updatedById: input.actorUserId,
      },
    });
  });
}

export async function getStorefrontAssortmentAdminView(): Promise<
  StorefrontTierAdminView[]
> {
  const [slots, context] = await Promise.all([
    prisma.storefrontAssortmentSlot.findMany({
      include: { catalogItem: true },
      orderBy: [{ tier: "asc" }, { role: "asc" }, { sortOrder: "asc" }],
    }),
    loadPricingContext(),
  ]);

  return Promise.all(
    STOREFRONT_TIERS.map(async (tier) => {
      const tierSlots = slots.filter((slot) => slot.tier === tier);
      const resolved = await resolveStorefrontTierOffers(tier);
      const rows = tierSlots.map((slot) => {
        const freshness =
          context.freshnessByProvider[slot.catalogItem.provider];
        const catalogFresh = freshness?.fresh === true;
        const available = isCatalogItemDisplayable(
          slot.catalogItem,
          catalogFresh,
        );
        return {
          id: slot.id,
          catalogItemId: slot.catalogItemId,
          role: slot.role,
          sortOrder: slot.sortOrder,
          enabled: slot.enabled,
          available,
          provider: slot.catalogItem.provider,
          regionCode: slot.catalogItem.regionCode,
          sizeCode: slot.catalogItem.sizeCode,
          sizeName: slot.catalogItem.sizeName,
          vcpu: slot.catalogItem.vcpu,
          ramGb:
            slot.catalogItem.ramMb == null
              ? null
              : Math.ceil(slot.catalogItem.ramMb / 1024),
          storageGb: slot.catalogItem.diskGb,
          providerHourlyPriceIrr:
            slot.catalogItem.providerHourlyPriceIrr?.toString() ?? null,
          providerMonthlyPriceIrr:
            slot.catalogItem.providerMonthlyPriceIrr?.toString() ?? null,
          catalogStatus: slot.catalogItem.status,
        };
      });
      return {
        tier,
        label: storefrontTierLabel(tier),
        description: storefrontTierDescription(tier),
        primaryLimit: STOREFRONT_PRIMARY_LIMIT,
        reserveLimit: STOREFRONT_RESERVE_LIMIT,
        displayLimit: STOREFRONT_DISPLAY_LIMIT,
        availableCount: resolved.availableCount,
        primary: rows.filter((row) => row.role === "PRIMARY"),
        reserve: rows.filter((row) => row.role === "RESERVE"),
        preview: resolved.offers,
      };
    }),
  );
}

export async function listStorefrontCatalogCandidates() {
  const productKinds: Array<"CLOUD_SERVER" | "READY_INSTANT_SERVER"> = [
    "CLOUD_SERVER",
    "READY_INSTANT_SERVER",
  ];
  const candidateWhere = {
    productKind: { in: productKinds },
    source: "API_CATALOG" as const,
    active: true,
    OR: [
      { providerHourlyPriceIrr: { gt: 0n } },
      { providerMonthlyPriceIrr: { gt: 0n } },
    ],
  };
  // Load each provider separately so a large Arvan catalog cannot starve
  // ParsPack (or the reverse) under a shared take limit.
  const [arvanItems, parsPackItems] = await Promise.all([
    prisma.providerCatalogItem.findMany({
      where: { ...candidateWhere, provider: "ARVAN" },
      orderBy: [{ regionCode: "asc" }, { vcpu: "asc" }, { ramMb: "asc" }],
      take: 5000,
    }),
    prisma.providerCatalogItem.findMany({
      where: { ...candidateWhere, provider: "PARSPACK" },
      orderBy: [{ regionCode: "asc" }, { vcpu: "asc" }, { ramMb: "asc" }],
      take: 5000,
    }),
  ]);
  return [...arvanItems, ...parsPackItems].map((item) => ({
    id: item.id,
    provider: item.provider,
    regionCode: item.regionCode,
    sizeCode: item.sizeCode,
    sizeName: item.sizeName,
    vcpu: item.vcpu,
    ramGb: item.ramMb == null ? null : Math.ceil(item.ramMb / 1024),
    storageGb: item.diskGb,
    available: item.available,
    status: item.status,
    providerHourlyPriceIrr: item.providerHourlyPriceIrr?.toString() ?? null,
    providerMonthlyPriceIrr: item.providerMonthlyPriceIrr?.toString() ?? null,
    title: readyServerTitle({
      regionCode: item.regionCode,
      vcpu: item.vcpu,
      ramMb: item.ramMb,
    }),
  }));
}
