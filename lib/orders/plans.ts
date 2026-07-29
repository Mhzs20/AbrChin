import type {
  DeliveryMode,
  InfrastructurePlan,
  InfrastructureProvider,
  ProviderCatalogItem,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import {
  type EffectivePlanPricing,
  resolvePlanPricing,
} from "@/lib/pricing/plan-pricing";
import { decimalToScaledInteger } from "@/lib/pricing/provider-pricing";

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
  code: string;
  title: string;
  description: string | null;
  deliveryMode: DeliveryMode;
  vcpu: number | null;
  ramGb: number | null;
  storageGb: number | null;
  salePriceRial: string;
  renewalPriceRial: string;
  deliveryEstimateMinutes: number;
  parchinIncluded: boolean;
  available: true;
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
  return {
    id: plan.id,
    code: plan.code,
    title: plan.title,
    description: plan.description,
    deliveryMode: plan.deliveryMode,
    vcpu: plan.pricing.vcpu,
    ramGb: plan.pricing.ramGb,
    storageGb: plan.pricing.storageGb,
    salePriceRial: plan.pricing.finalPriceRial.toString(),
    renewalPriceRial: plan.pricing.finalPriceRial.toString(),
    deliveryEstimateMinutes: plan.deliveryEstimateMinutes,
    parchinIncluded: plan.parchinIncluded,
    available: true,
  };
}

async function pricingConfig() {
  return prisma.providerPricingConfig.findUnique({
    where: { provider: "PARSPACK" },
  });
}

export async function getActivePlanByCode(code: string) {
  const [plan, config] = await Promise.all([
    prisma.infrastructurePlan.findFirst({
      where: { code, active: true },
      include: { catalogItem: true },
    }),
    pricingConfig(),
  ]);
  if (!plan) return null;
  const pricing = resolvePlanPricing(plan, config);
  return pricing ? withEffectivePricing(plan, pricing) : null;
}

export async function getActivePlanById(id: string) {
  const [plan, config] = await Promise.all([
    prisma.infrastructurePlan.findFirst({
      where: { id, active: true },
      include: { catalogItem: true },
    }),
    pricingConfig(),
  ]);
  if (!plan) return null;
  const pricing = resolvePlanPricing(plan, config);
  return pricing ? withEffectivePricing(plan, pricing) : null;
}

export async function listActivePlans(): Promise<PricedInfrastructurePlan[]> {
  const [plans, config] = await Promise.all([
    prisma.infrastructurePlan.findMany({
      where: { active: true, catalogMappingStatus: "MAPPED" },
      include: { catalogItem: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    pricingConfig(),
  ]);
  return plans.flatMap((plan) => {
    const pricing = resolvePlanPricing(plan, config);
    return pricing ? [withEffectivePricing(plan, pricing)] : [];
  });
}

export async function listPublicPlanOffers() {
  try {
    const plans = await listActivePlans();
    return plans.map(toPublicPlanOffer);
  } catch {
    // Public catalog pages fail closed and render an unavailable state. The
    // readiness endpoint remains the authoritative database outage signal.
    return [];
  }
}

export async function listAllPlans(): Promise<AdminInfrastructurePlan[]> {
  const [plans, config] = await Promise.all([
    prisma.infrastructurePlan.findMany({
      include: { catalogItem: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    pricingConfig(),
  ]);
  return plans.map((plan) => {
    const pricing = resolvePlanPricing(plan, config);
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
      provider_regionCode_sizeCode: {
        provider: "PARSPACK",
        regionCode: "tehran11",
        sizeCode: "irLinuxVPS4",
      },
    },
    update: {},
    create: {
      provider: "PARSPACK",
      regionCode: "tehran11",
      sizeCode: "irLinuxVPS4",
      sizeName: "Development Linux VPS",
      compatibleImageCodes: ["ubuntu24-cloudinit-qcow2"],
      vcpu: 2,
      ramMb: 4096,
      diskGb: 50,
      available: true,
      priceMonthlyAmount: decimalToScaledInteger("120000"),
      priceScale: 6,
      currencyCode: "IRR",
      amountUnit: "TOMAN",
      lastSyncedAt: syncedAt,
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
      deliveryMode: "RAW" as const,
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
