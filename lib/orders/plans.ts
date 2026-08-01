import type {
  DeliveryMode,
  InfrastructureProductKind,
  InfrastructurePlan,
  InfrastructureProvider,
  ParchinLevel,
  ProviderCatalogItem,
} from "@prisma/client";

import {
  READY_SERVER_PLAN_PREFIX,
  isReadyServerPlanCode,
  readyServerImageLabel,
  readyServerLocation,
} from "@/lib/cloud-servers/catalog";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import {
  getCatalogFreshness,
  requestCatalogSync,
} from "@/lib/infrastructure/multi-provider-catalog-service";
import { listProviderRegionConfigs } from "@/lib/infrastructure/provider-region-config";
import {
  type EffectivePlanPricing,
  catalogItemBaseHourlyPriceRial,
  resolvePlanPricing,
} from "@/lib/pricing/plan-pricing";
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
  regionCode: string;
  locationLabel: string;
  imageLabel: string;
  vcpu: number | null;
  ramGb: number | null;
  storageGb: number | null;
  transferTb: string | null;
  hourlyPriceRial: string | null;
  salePriceRial: string;
  renewalPriceRial: string;
  deliveryEstimateMinutes: number;
  parchinIncluded: boolean;
  checkedAt: string;
  available: true;
  catalogSource: "PROVIDER_API" | "ADMIN_MANAGED";
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

export function toPublicPlanOffer(plan: PricedInfrastructurePlan): PublicPlanOffer {
  const hourlyBasePriceRial = catalogItemBaseHourlyPriceRial(plan.catalogItem);
  const hourlyPriceRial =
    hourlyBasePriceRial == null
      ? null
      : calculateFinalPriceRial(
          hourlyBasePriceRial,
          plan.pricing.markupBasisPoints,
        );
  return {
    id: plan.id,
    title: plan.title,
    description: plan.description,
    deliveryMode: plan.deliveryMode,
    productKind: plan.productKind,
    parchinLevel: plan.pricing.parchinLevel,
    regionCode: plan.regionCode,
    locationLabel: readyServerLocation(plan.regionCode).label,
    imageLabel: readyServerImageLabel(plan.imageCode),
    vcpu: plan.pricing.vcpu,
    ramGb: plan.pricing.ramGb,
    storageGb: plan.pricing.storageGb,
    transferTb: plan.catalogItem.transfer,
    hourlyPriceRial: hourlyPriceRial?.toString() ?? null,
    salePriceRial: plan.pricing.finalPriceRial.toString(),
    renewalPriceRial: plan.pricing.finalPriceRial.toString(),
    deliveryEstimateMinutes: plan.deliveryEstimateMinutes,
    parchinIncluded: plan.parchinIncluded,
    checkedAt: plan.pricing.providerPriceCheckedAt.toISOString(),
    available: true,
    catalogSource: plan.catalogItem.source,
    instantDelivery: plan.instantDelivery,
    purchasable: true,
  };
}

async function pricingConfigs() {
  const [providers, products, commerce, parchin] = await Promise.all([
    prisma.providerPricingConfig.findMany(),
    prisma.productPricingConfig.findMany({ where: { enabled: true } }),
    prisma.commercePricingConfig.findUnique({ where: { id: "default" } }),
    prisma.parchinPricingConfig.findMany({ where: { active: true } }),
  ]);
  return { providers, products, commerce, parchin };
}

type PricingConfigs = Awaited<ReturnType<typeof pricingConfigs>>;

function resolveConfiguredPlanPricing(
  plan: InfrastructurePlan & { catalogItem: ProviderCatalogItem | null },
  configs: PricingConfigs,
  requestedParchinLevel?: ParchinLevel,
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
  if (!provider || !product || !minimumParchinLevel || !parchin) return null;
  return resolvePlanPricing(plan, provider, {
    productMarkupBasisPoints: product.markupBasisPoints,
    taxBasisPoints: configs.commerce?.taxBps ?? 1000,
    parchinLevel: selectedParchinLevel,
    parchinPriceRial: parchin.priceRial,
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

export async function getActivePlanById(id: string) {
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
  const pricing = resolveConfiguredPlanPricing(plan, configs);
  return pricing ? withEffectivePricing(plan, pricing) : null;
}

export async function listActivePlans(
  requestedParchinLevel?: ParchinLevel,
): Promise<PricedInfrastructurePlan[]> {
  const [plans, configs] = await Promise.all([
    prisma.infrastructurePlan.findMany({
      where: {
        active: true,
        publicationStatus: "PUBLISHED",
        catalogMappingStatus: "MAPPED",
        deliveryMode: "MANAGED",
        parchinIncluded: true,
        provider: "ARVAN",
        providerApiVersion: "v1",
        productKind: "CLOUD_SERVER",
      },
      include: { catalogItem: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    pricingConfigs(),
  ]);
  return plans.flatMap((plan) => {
    const pricing = resolveConfiguredPlanPricing(
      plan,
      configs,
      requestedParchinLevel,
    );
    return pricing ? [withEffectivePricing(plan, pricing)] : [];
  });
}

export async function getActiveReadyServerPlanById(id: string) {
  const plan = await getActivePlanById(id);
  return plan &&
    isReadyServerPlanCode(plan.code) &&
    plan.provider === "PARSPACK" &&
    plan.providerApiVersion === "v1" &&
    plan.productKind === "READY_INSTANT_SERVER"
    ? plan
    : null;
}

export async function listReadyServerPlans(): Promise<PricedInfrastructurePlan[]> {
  const [plans, configs] = await Promise.all([
    prisma.infrastructurePlan.findMany({
      where: {
        code: { startsWith: READY_SERVER_PLAN_PREFIX },
        provider: "PARSPACK",
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
  const [saleRegions, configs] = await Promise.all([
    listProviderRegionConfigs({
      provider: "ARVAN",
      apiVersion: "v1",
      purpose: "SALE",
    }),
    pricingConfigs(),
  ]);
  const plans = await prisma.infrastructurePlan.findMany({
    where: {
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "CLOUD_SERVER",
      regionCode: { in: saleRegions.map((region) => region.regionCode) },
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
    const plans = await listReadyServerPlans();
    return plans.map(toPublicPlanOffer);
  } catch {
    // Public catalog pages fail closed and render an unavailable state. The
    // readiness endpoint remains the authoritative database outage signal.
    return [];
  }
}

export async function listLiveReadyServerOffers() {
  try {
    const freshness = await getCatalogFreshness("PARSPACK");
    if (!freshness.fresh) {
      await requestCatalogSync("PARSPACK");
    }
    const offers = (await listReadyServerPlans())
      .filter((plan) => freshness.fresh || plan.displayDuringProviderOutage)
      .map((plan) => ({
        ...toPublicPlanOffer(plan),
        purchasable: freshness.fresh,
      }));
    return {
      live: freshness.fresh,
      degraded: !freshness.fresh,
      offers,
      checkedAt: offers[0]?.checkedAt ?? freshness.lastSync?.toISOString() ?? null,
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

export async function listLiveCloudServerOffers() {
  try {
    const freshness = await getCatalogFreshness("ARVAN");
    if (!freshness.fresh) {
      await requestCatalogSync("ARVAN");
    }
    const [plans, saleRegions] = await Promise.all([
      listCloudServerPlans(),
      listProviderRegionConfigs({
        provider: "ARVAN",
        apiVersion: "v1",
        purpose: "SALE",
      }),
    ]);
    const displayNames = new Map(
      saleRegions.map((region) => [region.regionCode, region.displayName]),
    );
    const offers = plans
      .filter(
        (plan) => freshness.fresh || plan.displayDuringProviderOutage,
      )
      .map((plan) => ({
        ...toPublicPlanOffer(plan),
        locationLabel:
          displayNames.get(plan.regionCode) ?? plan.regionCode,
        purchasable:
          freshness.fresh || plan.catalogItem.source === "ADMIN_MANAGED",
      }));
    return {
      live: freshness.fresh,
      degraded: !freshness.fresh,
      offers,
      checkedAt:
        offers[0]?.checkedAt ?? freshness.lastSync?.toISOString() ?? null,
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
