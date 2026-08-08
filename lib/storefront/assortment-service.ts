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
  type EffectivePlanPricing,
} from "@/lib/pricing/plan-pricing";
import {
  DEFAULT_LAUNCH_MARKUP_BASIS_POINTS,
  deriveUsageEquivalentPrices,
} from "@/lib/pricing/commercial-engine";
import { calculateFinalPriceRial } from "@/lib/pricing/provider-pricing";
import {
  classifyStorefrontCapacityTier,
  DEFAULT_STOREFRONT_CAPACITY_RULES,
  type StorefrontCapacityRules,
} from "@/lib/storefront/capacity-rules";
import {
  ensureStorefrontSaleReady,
} from "@/lib/storefront/ensure-sale-plans";
import {
  offerMatchesTierPriceBand,
  priceBandsFromSettings,
} from "@/lib/storefront/price-bands";
import {
  extractCatalogCommercialTraits,
  filterDominatedPlans,
  locationKeyForRegion,
  type DominanceCandidate,
  type DominanceRemoval,
} from "@/lib/storefront/dominance";
import {
  isStorefrontDisplayFresh,
  storefrontLocationLabel,
  storefrontServerTitle,
} from "@/lib/storefront/presentation";
import {
  STOREFRONT_DISPLAY_LIMIT,
  STOREFRONT_PRIMARY_LIMIT,
  STOREFRONT_RESERVE_LIMIT,
  STOREFRONT_TIERS,
  storefrontParchinLevel,
  storefrontParchinTitle,
  storefrontTierDescription,
  storefrontTierLabel,
} from "@/lib/storefront/tiers";
import {
  oneLineParchinSummary,
  toParchinServiceContract,
} from "@/lib/parchin/service-contract";

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
  dominance: StorefrontDominanceDiagnostics;
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

export type StorefrontDominanceDiagnostics = {
  rawCount: number;
  incompleteCount: number;
  notPurchasableCount: number;
  duplicateCount: number;
  dominatedCount: number;
  finalCount: number;
  removals: DominanceRemoval[];
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
  /** Full engine pricing for one prepaid month — the billed card amount. */
  priced: EffectivePlanPricing | null;
  fallbackTaxBasisPoints: number;
  purchaseState: PublicPlanOffer["purchaseState"];
  purchasable: boolean;
  planId?: string;
  parchinTitle?: string;
  parchinSubtitle?: string;
  parchinSummary?: string;
  parchinIncludedServices?: string[];
  parchinExcludedServices?: string[];
  parchinMonthlyPriceRial?: string;
  diskTypeLabel?: string | null;
  ipv4Available?: boolean | null;
  ipv6Available?: boolean | null;
}): PublicPlanOffer {
  // Card price = the exact one-month final amount from the unified engine —
  // identical to the quote/checkout amount for the same plan. Display-only
  // fallback (never purchasable) uses the launch default markup so provider
  // cost is never leaked raw.
  const monthlyPriceRial = input.priced?.finalPriceRial ?? fallbackDisplayMonthly(input.item);
  const usage =
    monthlyPriceRial > 0n
      ? deriveUsageEquivalentPrices(monthlyPriceRial)
      : null;
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
    // Always the billed level when priced; never advertise a higher package.
    parchinLevel: input.priced?.parchinLevel ?? "PARCHIN_START",
    parchinTitle: input.parchinTitle,
    regionCode: input.item.regionCode,
    locationLabel: storefrontLocationLabel(input.item.regionCode),
    imageLabel: readyServerImageLabel(imageCode),
    operatingSystemLabels: [...new Set(imageCodes.map(readyServerImageLabel))],
    vcpu: input.item.vcpu,
    ramGb:
      input.item.ramMb == null ? null : Math.ceil(input.item.ramMb / 1024),
    storageGb: input.item.diskGb,
    transferTb: input.item.transfer,
    diskTypeLabel: input.diskTypeLabel ?? null,
    ipv4Available: input.ipv4Available ?? null,
    ipv6Available: input.ipv6Available ?? null,
    parchinSubtitle: input.parchinSubtitle,
    parchinSummary: input.parchinSummary,
    parchinIncludedServices: input.parchinIncludedServices,
    parchinExcludedServices: input.parchinExcludedServices,
    parchinMonthlyPriceRial: input.parchinMonthlyPriceRial,
    // Never expose supplier economics on the customer storefront payload.
    providerBaseHourlyPriceRial: null,
    providerBaseMonthlyPriceRial: "0",
    // Usage equivalents are display-only derivations of the billed monthly
    // amount ("معادل مصرف"), never a separate payment model.
    hourlyPriceRial: usage?.hourlyRial.toString() ?? null,
    dailyPriceRial: usage?.dailyRial.toString() ?? null,
    salePriceRial: monthlyPriceRial.toString(),
    renewalPriceRial: (
      input.priced?.renewalPriceRial ?? monthlyPriceRial
    ).toString(),
    sourceCurrencyCode: input.item.currencyCode,
    sourceAmountUnit: input.item.amountUnit,
    normalizedCurrencyCode: "IRR",
    normalizedAmountUnit: "RIAL",
    billingIntervals: monthlyPriceRial > 0n ? (["MONTHLY"] as const) : [],
    // Supplier economics stay server-side; public payloads must not leak bps.
    markupBasisPoints: 0,
    taxBasisPoints: 0,
    catalogStatus: !input.catalogFresh ? "STALE" : input.item.status,
    purchaseState: input.purchaseState,
    deliveryEstimateMinutes: 0,
    parchinIncluded: true,
    checkedAt: input.item.lastSyncedAt.toISOString(),
    available: input.catalogFresh && input.item.available,
    instantDelivery: true,
    // A card without engine pricing can never be sold: no valid quote exists.
    purchasable: input.purchasable && input.priced != null,
  };
}

/** Display-only estimate for unpriced (never purchasable) catalog rows. */
function fallbackDisplayMonthly(item: ProviderCatalogItem): bigint {
  const monthlyBase = catalogItemBasePriceRial(item);
  if (monthlyBase != null && monthlyBase > 0n) {
    return calculateFinalPriceRial(
      monthlyBase,
      DEFAULT_LAUNCH_MARKUP_BASIS_POINTS,
    );
  }
  const hourlyBase = catalogItemBaseHourlyPriceRial(item);
  if (hourlyBase != null && hourlyBase > 0n) {
    return (
      calculateFinalPriceRial(hourlyBase, DEFAULT_LAUNCH_MARKUP_BASIS_POINTS) *
      720n
    );
  }
  return 0n;
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
  const parchinContractByLevel = new Map(
    parchinRows.map((row) => [row.level, toParchinServiceContract(row)]),
  );
  return {
    providers,
    products,
    commerce,
    parchinByLevel,
    parchinTitleByLevel,
    parchinContractByLevel,
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
  // Capacity tier and billed service tier are one storefront contract.
  const pricingParchinLevel = storefrontParchinLevel(tier);
  const customerParchinTitle = storefrontParchinTitle(tier);
  const priced =
    providerPricing && productPricing
      ? resolveCatalogItemPricing(item, providerPricing, {
          productMarkupBasisPoints: productPricing.markupBasisPoints,
          taxBasisPoints: context.commerce?.taxBps ?? 1000,
          parchinLevel: pricingParchinLevel,
          parchinPriceRial:
            context.parchinByLevel.get(pricingParchinLevel) ?? 0n,
          parchinTitle: customerParchinTitle,
          parchinVersion:
            context.parchinContractByLevel.get(pricingParchinLevel)?.version,
          termMonths: 1,
        })
      : null;
  const fallbackTaxBasisPoints = context.commerce?.taxBps ?? 1000;

  const billedContract =
    context.parchinContractByLevel.get(pricingParchinLevel) ?? null;
  const traits = extractCatalogCommercialTraits({
    transfer: item.transfer,
    rawPayload: item.rawPayload,
  });
  const parchinTitle = billedContract ? customerParchinTitle : undefined;
  const parchinSubtitle = billedContract?.subtitle || undefined;
  const parchinSummary = billedContract
    ? oneLineParchinSummary(billedContract)
    : undefined;
  const parchinIncludedServices = billedContract?.includedServices;
  const parchinExcludedServices = billedContract?.excludedServices;
  const parchinMonthlyPriceRial = billedContract?.monthlyPriceRial;
  const diskTypeLabel = traits.diskTypeKey;
  const ipv4Available =
    traits.ipv4Key == null ? null : traits.ipv4Key === "yes";
  const ipv6Available =
    traits.ipv6Key == null ? null : traits.ipv6Key === "yes";

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
      priced,
      fallbackTaxBasisPoints,
      purchaseState: access.purchaseState,
      purchasable: access.purchasable,
      planId: published.id,
      parchinTitle,
      parchinSubtitle,
      parchinSummary,
      parchinIncludedServices,
      parchinExcludedServices,
      parchinMonthlyPriceRial,
      diskTypeLabel,
      ipv4Available,
      ipv6Available,
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
    priced,
    fallbackTaxBasisPoints,
    purchaseState:
      item.available && item.status === "ACTIVE"
        ? "SKU_UNPUBLISHED"
        : "UNAVAILABLE",
    purchasable: false,
    parchinTitle,
    parchinSubtitle,
    parchinSummary,
    parchinIncludedServices,
    parchinExcludedServices,
    parchinMonthlyPriceRial,
    diskTypeLabel,
    ipv4Available,
    ipv6Available,
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
  if (vcpu <= 0 || ramGb <= 0) return false;
  if (classifyStorefrontCapacityTier({ vcpu, ramGb }, rules) !== tier) {
    return false;
  }
  const monthly = BigInt(offer.salePriceRial || "0");
  return offerMatchesTierPriceBand(monthly, priceBands[tier]);
}

type OfferDominanceRow = DominanceCandidate & {
  offer: PublicPlanOffer;
  item: ProviderCatalogItem;
};

function toDominanceRow(
  offer: PublicPlanOffer,
  item: ProviderCatalogItem,
): OfferDominanceRow {
  const traits = extractCatalogCommercialTraits({
    transfer: item.transfer,
    rawPayload: item.rawPayload,
  });
  return {
    id: offer.id,
    locationKey: locationKeyForRegion(offer.regionCode),
    productKind: offer.productKind,
    deliveryMode: offer.deliveryMode,
    purchasable: offer.purchasable && offer.available,
    vcpu: offer.vcpu,
    ramGb: offer.ramGb,
    diskGb: offer.storageGb,
    finalMonthlyPriceRial: BigInt(offer.salePriceRial || "0"),
    checkedAtMs: Date.parse(offer.checkedAt) || 0,
    traits,
    offer,
    item,
  };
}

function applyDominanceToOffers(
  rows: OfferDominanceRow[],
): {
  offers: PublicPlanOffer[];
  diagnostics: StorefrontDominanceDiagnostics;
} {
  const filtered = filterDominatedPlans(rows);
  return {
    offers: filtered.kept.map((row) => row.offer),
    diagnostics: {
      ...filtered.stats,
      removals: filtered.removed,
    },
  };
}

/**
 * Public chinish listing: all non-dominated purchasable plans in the tier,
 * sorted by final commercial price → RAM → CPU → Disk.
 * Curated slots are preferred seed order only; they do not hide rational peers.
 */
export async function resolveStorefrontTierOffers(
  tier: StorefrontChinishTier,
): Promise<{
  availableCount: number;
  offers: PublicPlanOffer[];
  diagnostics: StorefrontDominanceDiagnostics;
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

  const slotItems = [...slots]
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === "PRIMARY" ? -1 : 1;
      return a.sortOrder - b.sortOrder;
    })
    .map((slot) => slot.catalogItem)
    .filter((item): item is ProviderCatalogItem => item != null);

  // Full catalog pool for the tier — public listing is not capped to a curated 3/24.
  const [arvanPool, parsPackPool] = await Promise.all([
    prisma.providerCatalogItem.findMany({
      where: {
        provider: "ARVAN",
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
      take: 5000,
    }),
    prisma.providerCatalogItem.findMany({
      where: {
        provider: "PARSPACK",
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
      take: 5000,
    }),
  ]);
  const fillPool = [...arvanPool, ...parsPackPool];

  const byId = new Map<string, ProviderCatalogItem>();
  for (const item of [...slotItems, ...fillPool]) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  const publishCandidates = [...byId.values()].filter((item) => {
    const vcpu = item.vcpu ?? 0;
    const ramGb = item.ramMb == null ? 0 : Math.ceil(item.ramMb / 1024);
    if (vcpu <= 0 || ramGb <= 0) return false;
    return (
      classifyStorefrontCapacityTier({ vcpu, ramGb }, capacityRules) === tier
    );
  });
  // Public resolve is read-only — do not publish/repair plans on GET.
  // Admin slot replace / ensureStorefrontSaleReady handles publication.

  let context = await loadPricingContext();
  const rawRows: OfferDominanceRow[] = [];
  const seenOfferIds = new Set<string>();

  function consider(item: ProviderCatalogItem) {
    const offer = buildOfferForItem(item, tier, context);
    if (!offer) return;
    if (!offerMatchesStorefrontTier(offer, tier, capacityRules, priceBands)) {
      return;
    }
    if (seenOfferIds.has(offer.id)) return;
    seenOfferIds.add(offer.id);
    rawRows.push(toDominanceRow(offer, item));
  }

  for (const item of slotItems) consider(item);
  for (const item of publishCandidates) consider(item);

  // Rebuild after publish so SKU_UNPUBLISHED becomes PURCHASABLE where possible.
  context = await loadPricingContext();
  const refreshedRows: OfferDominanceRow[] = [];
  for (const row of rawRows) {
    const rebuilt = buildOfferForItem(row.item, tier, context);
    if (!rebuilt) continue;
    if (
      !offerMatchesStorefrontTier(rebuilt, tier, capacityRules, priceBands)
    ) {
      continue;
    }
    refreshedRows.push(toDominanceRow(rebuilt, row.item));
  }

  const { offers: rationalized, diagnostics } =
    applyDominanceToOffers(refreshedRows);
  const capped =
    rationalized.length > STOREFRONT_DISPLAY_LIMIT
      ? rationalized.slice(0, STOREFRONT_DISPLAY_LIMIT)
      : rationalized;

  return {
    availableCount: capped.length,
    offers: withStorefrontDisplayTitles(capped),
    diagnostics,
  };
}

export async function getStorefrontDominanceDiagnostics(): Promise<
  Record<StorefrontChinishTier, StorefrontDominanceDiagnostics>
> {
  const entries = await Promise.all(
    STOREFRONT_TIERS.map(async (tier) => {
      const result = await resolveStorefrontTierOffers(tier);
      return [tier, result.diagnostics] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<
    StorefrontChinishTier,
    StorefrontDominanceDiagnostics
  >;
}

export async function listPublicStorefrontTiers(): Promise<{
  live: boolean;
  degraded: boolean;
  checkedAt: string | null;
  priceDisplay: StorefrontPriceDisplay;
  tiers: StorefrontPublicTier[];
}> {
  // Customer GET must be read-only. Sale readiness / PAYG repair / publish
  // happens via admin ops or additive migrations — never page render.
  const settingsRow = await prisma.storefrontAssortmentSettings.findUnique({
    where: { id: "default" },
  });
  const settings = settingsRow ?? {
    id: "default",
    autoSuggestEnabled: false,
    showHourlyPrice: true,
    showDailyPrice: true,
    showMonthlyPrice: true,
    ...DEFAULT_STOREFRONT_CAPACITY_RULES,
  };
  const [arvanFreshness, parsPackFreshness, resolved] = await Promise.all([
    getCatalogFreshness("ARVAN").catch(() => null),
    getCatalogFreshness("PARSPACK").catch(() => null),
    Promise.all(
      STOREFRONT_TIERS.map(async (tier) => {
        const result = await resolveStorefrontTierOffers(tier);
        // Public catalog contract: every rendered card must enter checkout.
        // Non-purchasable candidates remain visible only in Admin diagnostics.
        const offers = result.offers.filter((offer) => offer.purchasable);
        return {
          tier,
          label: storefrontTierLabel(tier),
          description: storefrontTierDescription(tier),
          availableCount: offers.length,
          offers,
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
  // Admin write path may repair sale readiness; never from customer GET.
  await ensureStorefrontSaleReady().catch((error) => {
    console.error(
      "[storefront:ensure-sale]",
      error instanceof Error ? error.message : "unknown",
    );
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
        dominance: resolved.diagnostics,
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
