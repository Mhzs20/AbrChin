import type {
  DeliveryMode,
  InfrastructureProductKind,
  InfrastructurePlan,
  InfrastructureProvider,
  ParchinLevel,
  ProviderCatalogItem,
} from "@prisma/client";

import {
  readyServerDescription,
  readyServerImageLabel,
  readyServerLocation,
  readyServerTitle,
  selectReadyServerImage,
} from "@/lib/cloud-servers/catalog";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { listParchinLevelLabels } from "@/lib/parchin/labels";
import {
  getCatalogFreshness,
} from "@/lib/infrastructure/multi-provider-catalog-service";
import { resolveCatalogOfferAccess } from "@/lib/infrastructure/catalog-visibility";
import { listProviderRegionConfigs } from "@/lib/infrastructure/provider-region-config";
import { countAvailableInventoryByPlan } from "@/lib/infrastructure/preprovisioned-inventory";
import { isPublicSaleEnabled } from "@/lib/infrastructure/public-sale-policy";
import {
  type EffectivePlanPricing,
  catalogItemBaseHourlyPriceRial,
  catalogItemBasePriceRial,
  compatibleImageCodes,
  resolveCatalogItemPricing,
  resolvePlanPricing,
} from "@/lib/pricing/plan-pricing";
import {
  DEFAULT_LAUNCH_MARKUP_BASIS_POINTS,
  deriveUsageEquivalentPrices,
} from "@/lib/pricing/commercial-engine";
import {
  buildCommercialEconomicsSnapshot,
  coerceProfitCurveConfig,
  minimumPostDiscountMarginFromConfigs,
  resolveProviderMarkupForPlan,
} from "@/lib/pricing/profit-curve-apply";
import {
  calculateFinalPriceRial,
  decimalToScaledInteger,
} from "@/lib/pricing/provider-pricing";
import { serializeQuoteLineItems } from "@/lib/pricing/quote-line-items";

export type PricedInfrastructurePlan = InfrastructurePlan & {
  catalogItem: ProviderCatalogItem;
  pricing: EffectivePlanPricing;
};

export type AdminInfrastructurePlan = InfrastructurePlan & {
  catalogItem: ProviderCatalogItem | null;
  pricing: EffectivePlanPricing | null;
};

export type PlanSnapshot = {
  code: string;
  title: string;
  description: string | null;
  provider: InfrastructureProvider;
  providerApiVersion: string;
  productKind: InfrastructureProductKind;
  offerSource:
    | "API_CATALOG"
    | "MANUAL_API_BACKED"
    | "PREPROVISIONED_INVENTORY"
    | "MANUAL_ADMIN";
  catalogItemId: string;
  regionCode: string;
  sizeCode: string;
  imageCode: string;
  deliveryMode: DeliveryMode;
  vcpu: number | null;
  ramGb: number | null;
  storageGb: number | null;
  providerBasePriceRialSnapshot: string;
  markupBasisPointsSnapshot: number;
  markupAmountRialSnapshot: string;
  parchinLevel: ParchinLevel;
  parchinPriceRialSnapshot: string;
  taxBasisPointsSnapshot: number;
  taxAmountRialSnapshot: string;
  lineItemsSnapshot: ReturnType<typeof serializeQuoteLineItems>;
  commercialEconomicsSnapshot?: Record<string, unknown> | null;
  catalogVersion: string | null;
  providerPayloadHash: string | null;
  finalPriceRialSnapshot: string;
  currency: "IRR";
  createdAt: string;
  expiresAt: string;
  providerPriceCheckedAt: string;
  salePriceRial: string;
  renewalPriceRial: string;
  estimatedProviderCostRial: string;
  deliveryEstimateMinutes: number;
  parchinIncluded: boolean;
  available: true;
};

export type PublicPlanOffer = {
  id: string;
  title: string;
  description: string | null;
  deliveryMode: DeliveryMode;
  productKind: InfrastructureProductKind;
  parchinLevel: ParchinLevel;
  /** Customer-facing title from Admin pricing (falls back to catalog label). */
  parchinTitle?: string;
  parchinSubtitle?: string;
  parchinSummary?: string;
  parchinIncludedServices?: string[];
  parchinExcludedServices?: string[];
  /** Monthly Parchin fee in Rial; "0" means included in the shown price. */
  parchinMonthlyPriceRial?: string;
  regionCode: string;
  locationLabel: string;
  imageLabel: string;
  operatingSystemLabels: string[];
  vcpu: number | null;
  ramGb: number | null;
  storageGb: number | null;
  transferTb: string | null;
  /** Only present when the catalog payload recorded a real disk type. */
  diskTypeLabel?: string | null;
  ipv4Available?: boolean | null;
  ipv6Available?: boolean | null;
  providerBaseHourlyPriceRial: string | null;
  providerBaseMonthlyPriceRial: string;
  hourlyPriceRial: string | null;
  /** Display-only: hourly × 24. Not a billing interval. */
  dailyPriceRial?: string | null;
  salePriceRial: string;
  renewalPriceRial: string;
  sourceCurrencyCode: string | null;
  sourceAmountUnit: string | null;
  normalizedCurrencyCode: "IRR";
  normalizedAmountUnit: "RIAL";
  billingIntervals: Array<"HOURLY" | "MONTHLY">;
  markupBasisPoints: number;
  taxBasisPoints: number;
  catalogStatus:
    | "ACTIVE"
    | "STALE"
    | "UNAVAILABLE"
    | "INVALID_RESOURCE"
    | "INVALID_PRICE"
    | "DISABLED";
  purchaseState:
    | "PURCHASABLE"
    | "SALE_DISABLED"
    | "REGION_SALE_DISABLED"
    | "CATALOG_STALE"
    | "SKU_UNPUBLISHED"
    | "UNAVAILABLE";
  deliveryEstimateMinutes: number;
  parchinIncluded: boolean;
  checkedAt: string;
  available: boolean;
  instantDelivery: boolean;
  purchasable: boolean;
};

function withEffectivePricing(
  plan: InfrastructurePlan & { catalogItem: ProviderCatalogItem | null },
  pricing: EffectivePlanPricing,
): PricedInfrastructurePlan {
  if (!plan.catalogItem) throw new Error("catalog_item_missing");
  return {
    ...plan,
    catalogItem: plan.catalogItem,
    pricing,
    vcpu: pricing.vcpu,
    ramGb: pricing.ramGb,
    storageGb: pricing.storageGb,
    salePriceRial: pricing.finalPriceRial,
    renewalPriceRial: pricing.finalPriceRial,
    estimatedProviderCostRial: pricing.providerBasePriceRial,
  };
}

export function toPlanSnapshot(
  plan: PricedInfrastructurePlan,
  params?: { createdAt?: Date; expiresAt?: Date },
): PlanSnapshot {
  const createdAt = params?.createdAt ?? new Date();
  const expiresAt =
    params?.expiresAt ?? new Date(createdAt.getTime() + 10 * 60 * 1000);
  return {
    code: plan.code,
    title: plan.title,
    description: plan.description,
    provider: plan.provider,
    providerApiVersion: plan.providerApiVersion ?? "v1",
    productKind:
      plan.productKind ?? "READY_INSTANT_SERVER",
    offerSource: plan.offerSource,
    catalogItemId: plan.pricing.catalogItemId,
    regionCode: plan.regionCode,
    sizeCode: plan.sizeCode,
    imageCode: plan.imageCode,
    deliveryMode: plan.deliveryMode,
    vcpu: plan.pricing.vcpu,
    ramGb: plan.pricing.ramGb,
    storageGb: plan.pricing.storageGb,
    providerBasePriceRialSnapshot: plan.pricing.providerBasePriceRial.toString(),
    markupBasisPointsSnapshot: plan.pricing.markupBasisPoints,
    markupAmountRialSnapshot: (
      plan.pricing.markupAmountRial ??
      plan.pricing.finalPriceRial - plan.pricing.providerBasePriceRial
    ).toString(),
    parchinLevel: plan.pricing.parchinLevel ?? "PARCHIN_START",
    parchinPriceRialSnapshot: (
      plan.pricing.parchinPriceRial ?? 0n
    ).toString(),
    taxBasisPointsSnapshot: plan.pricing.taxBasisPoints ?? 0,
    taxAmountRialSnapshot: (plan.pricing.taxAmountRial ?? 0n).toString(),
    lineItemsSnapshot: serializeQuoteLineItems(plan.pricing.lineItems ?? []),
    commercialEconomicsSnapshot:
      plan.pricing.commercialEconomicsSnapshot ?? null,
    catalogVersion: plan.catalogItem?.catalogVersion ?? null,
    providerPayloadHash: plan.catalogItem?.payloadHash ?? null,
    finalPriceRialSnapshot: plan.pricing.finalPriceRial.toString(),
    currency: plan.pricing.currency,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    providerPriceCheckedAt: plan.pricing.providerPriceCheckedAt.toISOString(),
    salePriceRial: plan.pricing.finalPriceRial.toString(),
    renewalPriceRial: plan.pricing.finalPriceRial.toString(),
    estimatedProviderCostRial: plan.pricing.providerBasePriceRial.toString(),
    deliveryEstimateMinutes: plan.deliveryEstimateMinutes,
    parchinIncluded: plan.parchinIncluded,
    available: true,
  };
}

export function toPublicPlanOffer(
  plan: PricedInfrastructurePlan,
  options?: { parchinTitle?: string },
): PublicPlanOffer {
  // Usage equivalents are display-only derivations of the billed monthly
  // amount ("معادل مصرف") — never a second pricing formula.
  const usage = deriveUsageEquivalentPrices(plan.pricing.finalPriceRial);
  return {
    id: plan.id,
    title: plan.title,
    description: plan.description,
    deliveryMode: plan.deliveryMode,
    productKind: plan.productKind,
    parchinLevel: plan.pricing.parchinLevel,
    parchinTitle: options?.parchinTitle,
    regionCode: plan.regionCode,
    locationLabel: readyServerLocation(plan.regionCode).label,
    imageLabel: readyServerImageLabel(plan.imageCode),
    operatingSystemLabels: [
      ...new Set(
        (Array.isArray(plan.catalogItem.compatibleImageCodes)
          ? plan.catalogItem.compatibleImageCodes
          : []
        ).filter(
          (code): code is string => typeof code === "string" && code.length > 0,
        ).map(readyServerImageLabel),
      ),
    ],
    vcpu: plan.pricing.vcpu,
    ramGb: plan.pricing.ramGb,
    storageGb: plan.pricing.storageGb,
    transferTb: plan.catalogItem.transfer,
    // Never expose supplier economics on customer payloads.
    providerBaseHourlyPriceRial: null,
    providerBaseMonthlyPriceRial: "0",
    hourlyPriceRial: usage.hourlyRial > 0n ? usage.hourlyRial.toString() : null,
    dailyPriceRial: usage.dailyRial > 0n ? usage.dailyRial.toString() : null,
    salePriceRial: plan.pricing.finalPriceRial.toString(),
    renewalPriceRial: plan.pricing.renewalPriceRial.toString(),
    sourceCurrencyCode: plan.catalogItem.currencyCode,
    sourceAmountUnit: plan.catalogItem.amountUnit,
    normalizedCurrencyCode: "IRR",
    normalizedAmountUnit: "RIAL",
    billingIntervals:
      plan.pricing.finalPriceRial > 0n ? (["MONTHLY"] as const) : [],
    // Public customers must not see markup/tax basis points.
    markupBasisPoints: 0,
    taxBasisPoints: 0,
    catalogStatus: plan.catalogItem.status,
    purchaseState: "PURCHASABLE",
    deliveryEstimateMinutes: plan.deliveryEstimateMinutes,
    parchinIncluded: plan.parchinIncluded,
    checkedAt: plan.pricing.providerPriceCheckedAt.toISOString(),
    available: true,
    instantDelivery: plan.instantDelivery,
    purchasable: true,
  };
}

async function pricingConfigs() {
  const [providers, products, commerce, parchin, profitCurveRow] =
    await Promise.all([
      prisma.providerPricingConfig.findMany(),
      prisma.productPricingConfig.findMany({ where: { enabled: true } }),
      prisma.commercePricingConfig.findUnique({ where: { id: "default" } }),
      prisma.parchinPricingConfig.findMany({ where: { active: true } }),
      prisma.profitCurveConfiguration.findUnique({
        where: { id: "default" },
        include: { bands: { orderBy: { sortOrder: "asc" } } },
      }),
    ]);
  const profitCurve = profitCurveRow
    ? {
        enabled: profitCurveRow.enabled,
        minimumPostDiscountGrossMarginBps:
          profitCurveRow.minimumPostDiscountGrossMarginBps,
        bands: profitCurveRow.bands.map((band) => ({
          id: band.id,
          sortOrder: band.sortOrder,
          minProviderCostRial: band.minProviderCostRial,
          maxProviderCostRial: band.maxProviderCostRial,
          targetGrossMarginBps: band.targetGrossMarginBps,
        })),
      }
    : { ...coerceProfitCurveConfig(null), enabled: false };
  return { providers, products, commerce, parchin, profitCurve };
}

export type PricingConfigs = Awaited<ReturnType<typeof pricingConfigs>>;

type PlanTermPricingOptions = {
  termMonths?: 1 | 3 | 6 | 12;
  couponDiscountBps?: number | null;
  couponCode?: string | null;
};

export function resolveConfiguredPlanPricing(
  plan: InfrastructurePlan & { catalogItem: ProviderCatalogItem | null },
  configs: PricingConfigs,
  requestedParchinLevel?: ParchinLevel,
  termOptions: PlanTermPricingOptions = {},
) {
  const provider = configs.providers.find(
    (config) =>
      config.provider === plan.provider &&
      config.apiVersion === plan.providerApiVersion &&
      config.enabled,
  );
  const product = configs.products.find(
    (config) =>
      config.provider === plan.provider &&
      config.apiVersion === plan.providerApiVersion &&
      config.productKind === plan.productKind,
  );
  const minimumParchinLevel =
    plan.minimumParchinLevel ??
    (plan.parchinIncluded ? ("PARCHIN_START" as const) : null);
  const selectedParchinLevel =
    requestedParchinLevel ?? minimumParchinLevel;
  if (!selectedParchinLevel) return null;
  const parchin = configs.parchin.find(
    (config) => config.level === selectedParchinLevel,
  );
  const manualAdmin = plan.offerSource === "MANUAL_ADMIN";
  if (
    (!manualAdmin && (!provider || !product)) ||
    !minimumParchinLevel ||
    !parchin
  )
    return null;

  const providerCostRial = plan.catalogItem
    ? catalogItemBasePriceRial(plan.catalogItem)
    : null;
  if (!manualAdmin && (providerCostRial == null || providerCostRial <= 0n)) {
    return null;
  }

  const productMarkupBasisPoints = manualAdmin
    ? 0
    : plan.skuMarkupBasisPoints ?? product!.markupBasisPoints;

  const markup = resolveProviderMarkupForPlan({
    plan,
    providerMonthlyCostRial: providerCostRial ?? 0n,
    providerConfigMarkupBps: manualAdmin
      ? 0
      : provider!.markupBasisPoints,
    profitCurve: configs.profitCurve,
    manualAdmin,
  });

  const minPostMargin = minimumPostDiscountMarginFromConfigs(
    configs.commerce,
    configs.profitCurve,
  );

  const economics = buildCommercialEconomicsSnapshot({
    profitCurve: configs.profitCurve,
    curveResolution: markup.curve,
    providerCostRial: providerCostRial ?? 0n,
    providerMarkupBps: markup.providerMarkupBps,
    productMarkupBps: productMarkupBasisPoints,
    source: markup.source,
  });

  return resolvePlanPricing(plan, manualAdmin ? null : {
    ...provider!,
    markupBasisPoints: markup.providerMarkupBps,
  }, {
    productMarkupBasisPoints,
    taxBasisPoints: configs.commerce?.taxBps ?? 1000,
    parchinLevel: selectedParchinLevel,
    parchinPriceRial: parchin.priceRial,
    parchinTitle: parchin.title,
    parchinVersion: "version" in parchin ? (parchin.version as number) : 1,
    termMonths: termOptions.termMonths ?? 1,
    couponDiscountBps: termOptions.couponDiscountBps,
    couponCode: termOptions.couponCode,
    minimumPostDiscountGrossMarginBps: minPostMargin,
    infrastructureSaleRialOverride: markup.infrastructureSaleRialOverride,
    commercialEconomicsSnapshot: economics,
  });
}

export async function getActivePlanByCode(code: string) {
  const [plan, configs] = await Promise.all([
    prisma.infrastructurePlan.findFirst({
      where: {
        code,
        active: true,
        publicationStatus: "PUBLISHED",
        deliveryMode: "MANAGED",
        parchinIncluded: true,
      },
      include: { catalogItem: true },
    }),
    pricingConfigs(),
  ]);
  if (!plan) return null;
  const pricing = resolveConfiguredPlanPricing(plan, configs);
  return pricing ? withEffectivePricing(plan, pricing) : null;
}

export async function getActivePlanById(
  id: string,
  termOptions: PlanTermPricingOptions = {},
) {
  const [plan, configs] = await Promise.all([
    prisma.infrastructurePlan.findFirst({
      where: {
        id,
        active: true,
        publicationStatus: "PUBLISHED",
        deliveryMode: "MANAGED",
        parchinIncluded: true,
      },
      include: { catalogItem: true },
    }),
    pricingConfigs(),
  ]);
  if (!plan) return null;
  const pricing = resolveConfiguredPlanPricing(
    plan,
    configs,
    undefined,
    termOptions,
  );
  return pricing ? withEffectivePricing(plan, pricing) : null;
}

export async function listActivePlans(
  requestedParchinLevel?: ParchinLevel,
): Promise<PricedInfrastructurePlan[]> {
  const [arvanRegions, parspackRegions, configs] = await Promise.all([
    listProviderRegionConfigs({
      provider: "ARVAN",
      apiVersion: "v1",
      purpose: "SALE",
    }),
    listProviderRegionConfigs({
      provider: "PARSPACK",
      apiVersion: "v1",
      purpose: "SALE",
    }),
    pricingConfigs(),
  ]);
  const arvanRegionCodes = arvanRegions.map((region) => region.regionCode);
  const parspackRegionCodes = parspackRegions.map((region) => region.regionCode);
  const plans = await prisma.infrastructurePlan.findMany({
    where: {
      active: true,
      publicationStatus: "PUBLISHED",
      catalogMappingStatus: "MAPPED",
      deliveryMode: "MANAGED",
      parchinIncluded: true,
      providerApiVersion: "v1",
      offerSource: "API_CATALOG",
      OR: [
        {
          provider: "ARVAN",
          productKind: "CLOUD_SERVER",
          regionCode: { in: arvanRegionCodes },
        },
        {
          provider: "PARSPACK",
          productKind: "READY_INSTANT_SERVER",
          regionCode: { in: parspackRegionCodes },
        },
      ],
    },
    include: { catalogItem: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return plans.flatMap((plan) => {
    if (
      !isPublicSaleEnabled({
        provider: plan.provider,
        productKind: plan.productKind,
        offerSource: plan.offerSource,
      })
    ) {
      return [];
    }
    const pricing = resolveConfiguredPlanPricing(
      plan,
      configs,
      requestedParchinLevel,
    );
    return pricing ? [withEffectivePricing(plan, pricing)] : [];
  });
}

export async function getActiveReadyServerPlanById(
  id: string,
  termOptions: PlanTermPricingOptions = {},
) {
  const plan = await getActivePlanById(id, termOptions);
  return plan &&
    plan.providerApiVersion === "v1" &&
    plan.productKind === "READY_INSTANT_SERVER"
    ? plan
    : null;
}

export async function listReadyServerPlans(): Promise<PricedInfrastructurePlan[]> {
  const [plans, configs] = await Promise.all([
    prisma.infrastructurePlan.findMany({
      where: {
        providerApiVersion: "v1",
        productKind: "READY_INSTANT_SERVER",
        active: true,
        publicationStatus: "PUBLISHED",
        catalogMappingStatus: "MAPPED",
        deliveryMode: "MANAGED",
        parchinIncluded: true,
      },
      include: { catalogItem: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    pricingConfigs(),
  ]);
  return plans.flatMap((plan) => {
    const pricing = resolveConfiguredPlanPricing(plan, configs);
    return pricing ? [withEffectivePricing(plan, pricing)] : [];
  });
}

export async function listCloudServerPlans(): Promise<PricedInfrastructurePlan[]> {
  const [configuredRegions, configs] = await Promise.all([
    listProviderRegionConfigs({
      provider: "ARVAN",
      apiVersion: "v1",
      purpose: "ALL",
    }),
    pricingConfigs(),
  ]);
  const plans = await prisma.infrastructurePlan.findMany({
    where: {
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "CLOUD_SERVER",
      offerSource: "API_CATALOG",
      regionCode: {
        in: configuredRegions.map((region) => region.regionCode),
      },
      active: true,
      publicationStatus: "PUBLISHED",
      catalogMappingStatus: "MAPPED",
      deliveryMode: "MANAGED",
      parchinIncluded: true,
      catalogItem: {
        status: "ACTIVE",
        available: true,
        providerMonthlyPriceIrr: { gt: 0n },
      },
    },
    include: { catalogItem: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return plans.flatMap((plan) => {
    const pricing = resolveConfiguredPlanPricing(plan, configs);
    return pricing ? [withEffectivePricing(plan, pricing)] : [];
  });
}

export async function listPublicPlanOffers() {
  try {
    return (await listLiveReadyServerOffers()).offers;
  } catch {
    // Public catalog pages fail closed and render an unavailable state. The
    // readiness endpoint remains the authoritative database outage signal.
    return [];
  }
}

export async function listLiveReadyServerOffers() {
  try {
    const [plans, parsPackResult, arvanResult, arvanRegions, parchinLabels] =
      await Promise.all([
        listReadyServerPlans(),
        getCatalogFreshness("PARSPACK").catch(() => null),
        getCatalogFreshness("ARVAN").catch(() => null),
        listProviderRegionConfigs({
          provider: "ARVAN",
          apiVersion: "v1",
          purpose: "ALL",
        }).catch(() => []),
        listParchinLevelLabels(),
      ]);
    const arvanRegionSale = new Map(
      arvanRegions.map((region) => [
        region.regionCode,
        region.saleEnabled,
      ]),
    );
    const inventoryCounts = await countAvailableInventoryByPlan(
      plans.filter((plan) => plan.offerSource === "PREPROVISIONED_INVENTORY")
        .map((plan) => plan.id),
    );
    const offers = plans.flatMap((plan) => {
      const manual = plan.offerSource === "MANUAL_ADMIN";
      const preprovisioned = plan.offerSource === "PREPROVISIONED_INVENTORY";
      const freshness = plan.provider === "PARSPACK" ? parsPackResult : arvanResult;
      const inventoryCount = inventoryCounts.get(plan.id) ?? 0;
      const manualUnits = plan.catalogItem.manualAvailableUnits ?? 0;
      const apiCatalog = !manual && !preprovisioned;
      const catalogFresh = apiCatalog
        ? freshness?.fresh === true
        : true;
      const access = resolveCatalogOfferAccess({
        catalogFresh,
        displayDuringProviderOutage: plan.displayDuringProviderOutage,
        publicSaleEnabled: isPublicSaleEnabled({
          provider: plan.provider,
          productKind: plan.productKind,
          offerSource: plan.offerSource,
        }),
        regionSaleEnabled:
          plan.provider !== "ARVAN" ||
          arvanRegionSale.get(plan.regionCode) === true,
      });
      if (!access.visible) return [];
      const capacityAvailable = manual
        ? manualUnits > 0
        : preprovisioned
          ? inventoryCount > 0
          : true;
      const purchasable = access.purchasable && capacityAvailable;
      const parchinLevel = plan.pricing.parchinLevel;
      return [{
        ...toPublicPlanOffer(plan, {
          parchinTitle: parchinLabels[parchinLevel],
        }),
        available: catalogFresh && capacityAvailable,
        catalogStatus:
          apiCatalog && !catalogFresh
            ? ("STALE" as const)
            : !capacityAvailable
              ? ("UNAVAILABLE" as const)
              : plan.catalogItem.status,
        purchasable,
        purchaseState:
          !purchasable && access.purchasable
            ? ("UNAVAILABLE" as const)
            : access.purchaseState,
      }];
    });
    const freshStates = [parsPackResult, arvanResult].filter(Boolean);
    const allFresh = freshStates.length > 0 && freshStates.every((state) => state!.fresh);
    return {
      live: allFresh,
      degraded: !allFresh,
      offers,
      checkedAt: offers[0]?.checkedAt ?? null,
    };
  } catch {
    return {
      live: false as const,
      degraded: false as const,
      offers: [] as PublicPlanOffer[],
      checkedAt: null,
    };
  }
}

function catalogItemPublicOffer(input: {
  item: ProviderCatalogItem;
  locationLabel: string;
  catalogFresh: boolean;
  /** Full engine pricing (1 month) when configs allow it. */
  priced: EffectivePlanPricing | null;
  fallbackTaxBasisPoints: number;
  purchaseState: PublicPlanOffer["purchaseState"];
  purchasable: boolean;
  planId?: string;
}): PublicPlanOffer {
  // Same engine-derived monthly amount as cards/quotes. Unpriced rows are
  // never purchasable and fall back to a default-markup display estimate so
  // raw supplier cost is never exposed.
  const monthlyPriceRial =
    input.priced?.finalPriceRial ??
    catalogItemFallbackDisplayMonthly(input.item);
  const usage =
    monthlyPriceRial > 0n
      ? deriveUsageEquivalentPrices(monthlyPriceRial)
      : null;
  const imageCodes = compatibleImageCodes(input.item);
  const imageCode =
    selectReadyServerImage(imageCodes) ?? imageCodes[0] ?? "linux";
  const catalogStatus: PublicPlanOffer["catalogStatus"] = !input.catalogFresh
    ? "STALE"
    : input.item.status;
  return {
    id: input.planId ?? input.item.id,
    title: readyServerTitle({
      regionCode: input.item.regionCode,
      vcpu: input.item.vcpu,
      ramMb: input.item.ramMb,
    }),
    description: readyServerDescription({
      regionCode: input.item.regionCode,
      imageCode,
    }),
    deliveryMode: "MANAGED",
    productKind: "CLOUD_SERVER",
    parchinLevel: "PARCHIN_START",
    regionCode: input.item.regionCode,
    locationLabel: input.locationLabel,
    imageLabel: readyServerImageLabel(imageCode),
    operatingSystemLabels: [
      ...new Set(imageCodes.map(readyServerImageLabel)),
    ],
    vcpu: input.item.vcpu,
    ramGb:
      input.item.ramMb == null ? null : Math.ceil(input.item.ramMb / 1024),
    storageGb: input.item.diskGb,
    transferTb: input.item.transfer,
    // Never expose supplier economics on public payloads.
    providerBaseHourlyPriceRial: null,
    providerBaseMonthlyPriceRial: "0",
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
    // Public customers must not see markup/tax basis points.
    markupBasisPoints: 0,
    taxBasisPoints: 0,
    catalogStatus,
    purchaseState: input.purchaseState,
    deliveryEstimateMinutes: 15,
    parchinIncluded: true,
    checkedAt: input.item.lastSyncedAt.toISOString(),
    available: input.catalogFresh && input.item.available,
    instantDelivery: false,
    purchasable: input.purchasable && input.priced != null,
  };
}

/** Display-only estimate for unpriced (never purchasable) catalog rows. */
function catalogItemFallbackDisplayMonthly(item: ProviderCatalogItem): bigint {
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

export async function listLiveCloudServerOffers() {
  try {
    const [
      arvanFreshness,
      parsPackFreshness,
      arvanRegions,
      parsPackRegions,
      catalogItems,
      publishedPlanRows,
      configs,
    ] = await Promise.all([
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
      prisma.providerCatalogItem.findMany({
        where: {
          provider: { in: ["ARVAN", "PARSPACK"] },
          productKind: "CLOUD_SERVER",
          source: "API_CATALOG",
          active: true,
          OR: [
            { providerHourlyPriceIrr: { gt: 0n } },
            { providerMonthlyPriceIrr: { gt: 0n } },
          ],
        },
        orderBy: [
          { provider: "asc" },
          { regionCode: "asc" },
          { vcpu: "asc" },
          { ramMb: "asc" },
        ],
      }),
      prisma.infrastructurePlan.findMany({
        where: {
          provider: { in: ["ARVAN", "PARSPACK"] },
          providerApiVersion: "v1",
          productKind: "CLOUD_SERVER",
          offerSource: "API_CATALOG",
          active: true,
          publicationStatus: "PUBLISHED",
          catalogMappingStatus: "MAPPED",
          deliveryMode: "MANAGED",
          catalogItemId: { not: null },
        },
        include: { catalogItem: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      pricingConfigs(),
    ]);

    const pricedPublishedPlans = publishedPlanRows.flatMap((plan) => {
      if (!plan.catalogItem) return [];
      const pricing = resolveConfiguredPlanPricing(plan, configs);
      return pricing ? [withEffectivePricing(plan, pricing)] : [];
    });

    const regionDisplay = new Map<string, string>();
    const regionSale = new Map<string, boolean>();
    for (const region of [...arvanRegions, ...parsPackRegions]) {
      regionDisplay.set(
        `${region.provider}:${region.regionCode}`,
        region.displayName,
      );
      regionSale.set(
        `${region.provider}:${region.regionCode}`,
        region.saleEnabled,
      );
    }

    const publishedByCatalogItemId = new Map(
      pricedPublishedPlans.map((plan) => [plan.catalogItem.id, plan]),
    );
    const freshnessByProvider = {
      ARVAN: arvanFreshness,
      PARSPACK: parsPackFreshness,
    } as const;

    const offers = catalogItems.flatMap((item) => {
      const freshness = freshnessByProvider[item.provider];
      if (!freshness) return [];
      const catalogFresh = freshness.fresh === true;
      const published = publishedByCatalogItemId.get(item.id);
      const locationLabel =
        regionDisplay.get(`${item.provider}:${item.regionCode}`) ??
        readyServerLocation(item.regionCode).label;
      const regionSaleEnabled =
        item.provider !== "ARVAN" ||
        regionSale.get(`${item.provider}:${item.regionCode}`) === true;

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
        if (!access.visible) return [];
        return [
          {
            ...toPublicPlanOffer(published),
            locationLabel,
            catalogStatus: catalogFresh
              ? published.catalogItem.status
              : ("STALE" as const),
            available: catalogFresh && published.catalogItem.available,
            purchasable: access.purchasable,
            purchaseState: access.purchaseState,
          },
        ];
      }

      // Synced catalog may be browsed before Admin publishes a SKU.
      // Purchase stays closed until a published SKU and sale gates exist.
      const access = resolveCatalogOfferAccess({
        catalogFresh,
        displayDuringProviderOutage: true,
        publicSaleEnabled: false,
        regionSaleEnabled,
      });
      if (!access.visible) return [];
      const providerPricing = configs.providers.find(
        (config) =>
          config.provider === item.provider &&
          config.apiVersion === item.apiVersion &&
          config.enabled,
      );
      const productPricing = configs.products.find(
        (config) =>
          config.provider === item.provider &&
          config.apiVersion === item.apiVersion &&
          config.productKind === item.productKind,
      );
      const startParchin = configs.parchin.find(
        (config) => config.level === "PARCHIN_START",
      );
      const priced =
        providerPricing && productPricing
          ? resolveCatalogItemPricing(item, providerPricing, {
              productMarkupBasisPoints: productPricing.markupBasisPoints,
              taxBasisPoints: configs.commerce?.taxBps ?? 1000,
              parchinLevel: "PARCHIN_START",
              parchinPriceRial: startParchin?.priceRial ?? 0n,
              termMonths: 1,
            })
          : null;
      const purchaseState: PublicPlanOffer["purchaseState"] =
        item.available && item.status === "ACTIVE"
          ? "SKU_UNPUBLISHED"
          : "UNAVAILABLE";
      return [
        catalogItemPublicOffer({
          item,
          locationLabel,
          catalogFresh,
          priced,
          fallbackTaxBasisPoints: configs.commerce?.taxBps ?? 1000,
          purchaseState,
          purchasable: false,
        }),
      ];
    });

    const freshStates = [arvanFreshness, parsPackFreshness].filter(Boolean);
    const allFresh =
      freshStates.length > 0 &&
      freshStates.every((state) => state!.fresh);
    const checkedAt =
      offers[0]?.checkedAt ??
      arvanFreshness?.lastSync?.toISOString() ??
      parsPackFreshness?.lastSync?.toISOString() ??
      null;
    return {
      live: allFresh,
      degraded: !allFresh,
      offers,
      checkedAt,
    };
  } catch {
    return {
      live: false as const,
      degraded: false as const,
      offers: [] as PublicPlanOffer[],
      checkedAt: null,
    };
  }
}

export async function listAllPlans(): Promise<AdminInfrastructurePlan[]> {
  const [plans, configs] = await Promise.all([
    prisma.infrastructurePlan.findMany({
      include: { catalogItem: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    pricingConfigs(),
  ]);
  return plans.map((plan) => {
    const pricing = resolveConfiguredPlanPricing(plan, configs);
    return pricing
      ? withEffectivePricing(plan, pricing)
      : {
          ...plan,
          pricing: null,
        };
  });
}

/** Development/test seed only — never called in production bootstrap. */
export async function seedDevelopmentPlans() {
  if (getEnv().isProduction) return;

  const syncedAt = new Date();
  const catalogItem = await prisma.providerCatalogItem.upsert({
    where: {
      provider_apiVersion_regionCode_externalPlanId: {
        provider: "PARSPACK",
        apiVersion: "v1",
        regionCode: "tehran11",
        externalPlanId: "irLinuxVPS4",
      },
    },
    update: {},
    create: {
      provider: "PARSPACK",
      apiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      regionCode: "tehran11",
      sizeCode: "irLinuxVPS4",
      externalPlanId: "irLinuxVPS4",
      externalKey: "parspack:v1:tehran11:irLinuxVPS4",
      sizeName: "Development Linux VPS",
      compatibleImageCodes: ["ubuntu24-cloudinit-qcow2"],
      vcpu: 2,
      ramMb: 4096,
      diskGb: 50,
      available: true,
      status: "ACTIVE",
      priceMonthlyAmount: decimalToScaledInteger("120000"),
      priceScale: 6,
      currencyCode: "IRR",
      amountUnit: "TOMAN",
      providerMonthlyPriceIrr: 1_200_000n,
      lastSyncedAt: syncedAt,
      lastSeenAt: syncedAt,
      rawPayload: {},
      payloadHash: "development-seed",
      catalogVersion: syncedAt.toISOString(),
    },
  });
  await prisma.providerPricingConfig.upsert({
    where: { provider: "PARSPACK" },
    update: {},
    create: {
      id: "parspack",
      provider: "PARSPACK",
      markupBasisPoints: 2500,
    },
  });

  const plans = [
    {
      code: "DEV_STARTER",
      title: "شروع توسعه",
      description: "پلن آزمایشی فقط برای Development",
      deliveryMode: "MANAGED" as const,
      sortOrder: 1,
    },
    {
      code: "DEV_GROWTH",
      title: "رشد توسعه",
      description: "پلن آزمایشی فقط برای Development",
      deliveryMode: "MANAGED" as const,
      sortOrder: 2,
    },
  ];

  for (const plan of plans) {
    await prisma.infrastructurePlan.upsert({
      where: { code: plan.code },
      update: {},
      create: {
        ...plan,
        provider: "PARSPACK",
        regionCode: catalogItem.regionCode,
        sizeCode: catalogItem.sizeCode,
        imageCode: "ubuntu24-cloudinit-qcow2",
        vcpu: catalogItem.vcpu,
        ramGb: 4,
        storageGb: catalogItem.diskGb,
        salePriceRial: 1_500_000n,
        renewalPriceRial: 1_500_000n,
        estimatedProviderCostRial: 1_200_000n,
        catalogItemId: catalogItem.id,
        catalogMappingStatus: "MAPPED",
        catalogMappedAt: syncedAt,
        parchinIncluded: true,
        publicationStatus: "PUBLISHED",
        active: true,
      },
    });
  }
}

/** @deprecated Use getActivePlanByCode from database */
export function getServicePlan(code: string) {
  void code;
  return null;
}
