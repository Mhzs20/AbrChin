import type {
  InfrastructurePlan,
  ProviderCatalogItem,
  ProviderPricingConfig,
} from "@prisma/client";

import {
  calculateFinalPriceRial,
  normalizeProviderPriceContract,
  providerAmountToRial,
} from "@/lib/pricing/provider-pricing";

export type EffectivePlan = InfrastructurePlan & {
  catalogItem: ProviderCatalogItem | null;
};

export type EffectivePlanPricing = {
  catalogItemId: string;
  providerBasePriceRial: bigint;
  markupBasisPoints: number;
  finalPriceRial: bigint;
  currency: "IRR";
  providerPriceCheckedAt: Date;
  vcpu: number | null;
  ramGb: number | null;
  storageGb: number | null;
  available: boolean;
};

export function compatibleImageCodes(item: {
  compatibleImageCodes: unknown;
}): string[] {
  return Array.isArray(item.compatibleImageCodes)
    ? item.compatibleImageCodes.filter(
        (code): code is string => typeof code === "string" && code.length > 0,
      )
    : [];
}

export function resolveCatalogItemPricing(
  item: ProviderCatalogItem,
  config: Pick<ProviderPricingConfig, "markupBasisPoints">,
): EffectivePlanPricing | null {
  const providerBasePriceRial = catalogItemBasePriceRial(item);
  if (!item.active || !item.available || providerBasePriceRial == null) {
    return null;
  }
  return {
    catalogItemId: item.id,
    providerBasePriceRial,
    markupBasisPoints: config.markupBasisPoints,
    finalPriceRial: calculateFinalPriceRial(
      providerBasePriceRial,
      config.markupBasisPoints,
    ),
    currency: "IRR",
    providerPriceCheckedAt: item.lastSyncedAt,
    vcpu: item.vcpu,
    ramGb: item.ramMb == null ? null : Math.ceil(item.ramMb / 1024),
    storageGb: item.diskGb,
    available: true,
  };
}

export function catalogItemBasePriceRial(
  item: ProviderCatalogItem,
): bigint | null {
  const contract = normalizeProviderPriceContract({
    currencyCode: item.currencyCode,
    amountUnit: item.amountUnit,
  });
  if (
    item.priceMonthlyAmount == null ||
    item.priceMonthlyAmount <= 0n ||
    !contract
  ) {
    return null;
  }
  return providerAmountToRial({
    scaledAmount: item.priceMonthlyAmount,
    scale: item.priceScale,
    contract,
  });
}

export function resolvePlanPricing(
  plan: EffectivePlan,
  config: Pick<ProviderPricingConfig, "markupBasisPoints"> | null,
): EffectivePlanPricing | null {
  if (
    !plan.active ||
    plan.catalogMappingStatus !== "MAPPED" ||
    !plan.catalogItem ||
    !config ||
    plan.catalogItem.provider !== plan.provider ||
    plan.catalogItem.regionCode !== plan.regionCode ||
    plan.catalogItem.sizeCode !== plan.sizeCode ||
    !compatibleImageCodes(plan.catalogItem).includes(plan.imageCode)
  ) {
    return null;
  }
  return resolveCatalogItemPricing(plan.catalogItem, config);
}

export function samePriceSnapshot(
  current: EffectivePlanPricing,
  snapshot: {
    catalogItemId: string | null;
    providerBasePriceRialSnapshot: bigint | null;
    markupBasisPointsSnapshot: number | null;
    finalPriceRialSnapshot: bigint | null;
    currencySnapshot: string | null;
  },
): boolean {
  return (
    snapshot.catalogItemId === current.catalogItemId &&
    snapshot.providerBasePriceRialSnapshot === current.providerBasePriceRial &&
    snapshot.markupBasisPointsSnapshot === current.markupBasisPoints &&
    snapshot.finalPriceRialSnapshot === current.finalPriceRial &&
    snapshot.currencySnapshot === current.currency
  );
}
