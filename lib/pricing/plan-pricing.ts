import type {
  InfrastructurePlan,
  ParchinLevel,
  ProviderCatalogItem,
  ProviderPricingConfig,
} from "@prisma/client";

import {
  normalizeProviderPriceContract,
  providerAmountToRial,
} from "@/lib/pricing/provider-pricing";
import {
  calculateQuotePricing,
  type QuoteLineItem,
} from "@/lib/pricing/quote-line-items";

export type EffectivePlan = InfrastructurePlan & {
  catalogItem: ProviderCatalogItem | null;
};

export type EffectivePlanPricing = {
  catalogItemId: string;
  providerBasePriceRial: bigint;
  markupBasisPoints: number;
  providerMarkupBasisPoints: number;
  productMarkupBasisPoints: number;
  markupAmountRial: bigint;
  parchinLevel: ParchinLevel;
  parchinPriceRial: bigint;
  taxBasisPoints: number;
  taxAmountRial: bigint;
  lineItems: QuoteLineItem[];
  finalPriceRial: bigint;
  currency: "IRR";
  providerPriceCheckedAt: Date;
  vcpu: number | null;
  ramGb: number | null;
  storageGb: number | null;
  available: boolean;
};

export type PlanPricingOptions = {
  productMarkupBasisPoints?: number;
  taxBasisPoints?: number;
  parchinLevel?: ParchinLevel;
  parchinPriceRial?: bigint;
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
  options: PlanPricingOptions = {},
): EffectivePlanPricing | null {
  const providerBasePriceRial = catalogItemBasePriceRial(item);
  const itemSource = item.source ?? "API_CATALOG";
  const manualContractValid =
    itemSource === "API_CATALOG" ||
    (item.manualLastVerifiedAt != null &&
      item.manualPriceValidUntil != null &&
      item.manualPriceValidUntil.getTime() > Date.now());
  if (
    !item.active ||
    !item.available ||
    ("status" in item && item.status !== "ACTIVE") ||
    providerBasePriceRial == null ||
    !manualContractValid
  ) {
    return null;
  }
  const quotePricing = calculateQuotePricing({
    providerMonthlyPriceIrr: providerBasePriceRial,
    providerMarkupBps: config.markupBasisPoints,
    productMarkupBps: options.productMarkupBasisPoints ?? 0,
    parchinLevel: options.parchinLevel ?? "PARCHIN_START",
    parchinPriceIrr: options.parchinPriceRial ?? 0n,
    taxBps: options.taxBasisPoints ?? 0,
  });
  return {
    catalogItemId: item.id,
    providerBasePriceRial,
    markupBasisPoints: quotePricing.markupBps,
    providerMarkupBasisPoints: config.markupBasisPoints,
    productMarkupBasisPoints: options.productMarkupBasisPoints ?? 0,
    markupAmountRial: quotePricing.markupAmountIrr,
    parchinLevel: options.parchinLevel ?? "PARCHIN_START",
    parchinPriceRial: options.parchinPriceRial ?? 0n,
    taxBasisPoints: options.taxBasisPoints ?? 0,
    taxAmountRial: quotePricing.taxAmountIrr,
    lineItems: quotePricing.lineItems,
    finalPriceRial: quotePricing.finalPriceIrr,
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
  if (
    "providerMonthlyPriceIrr" in item &&
    item.providerMonthlyPriceIrr != null
  ) {
    return item.providerMonthlyPriceIrr > 0n
      ? item.providerMonthlyPriceIrr
      : null;
  }
  return catalogItemPriceRial(item, item.priceMonthlyAmount);
}

export function catalogItemBaseHourlyPriceRial(
  item: ProviderCatalogItem,
): bigint | null {
  if (
    "providerHourlyPriceIrr" in item &&
    item.providerHourlyPriceIrr != null
  ) {
    return item.providerHourlyPriceIrr > 0n
      ? item.providerHourlyPriceIrr
      : null;
  }
  return catalogItemPriceRial(item, item.priceHourlyAmount);
}

function catalogItemPriceRial(
  item: ProviderCatalogItem,
  amount: bigint | null,
): bigint | null {
  const contract = normalizeProviderPriceContract({
    currencyCode: item.currencyCode,
    amountUnit: item.amountUnit,
  });
  if (
    amount == null ||
    amount <= 0n ||
    !contract
  ) {
    return null;
  }
  return providerAmountToRial({
    scaledAmount: amount,
    scale: item.priceScale,
    contract,
  });
}

export function resolvePlanPricing(
  plan: EffectivePlan,
  config: Pick<ProviderPricingConfig, "markupBasisPoints"> | null,
  options: PlanPricingOptions = {},
): EffectivePlanPricing | null {
  if (
    !plan.active ||
    plan.catalogMappingStatus !== "MAPPED" ||
    !plan.catalogItem ||
    !config ||
    plan.catalogItem.provider !== plan.provider ||
    plan.catalogItem.apiVersion !== plan.providerApiVersion ||
    plan.catalogItem.productKind !== plan.productKind ||
    plan.catalogItem.regionCode !== plan.regionCode ||
    plan.catalogItem.sizeCode !== plan.sizeCode ||
    !compatibleImageCodes(plan.catalogItem).includes(plan.imageCode)
  ) {
    return null;
  }
  const offerSource = plan.offerSource ?? "API_CATALOG";
  if (
    offerSource !== "API_CATALOG" &&
    (!plan.offerLastVerifiedAt ||
      !plan.offerPriceValidUntil ||
      plan.offerPriceValidUntil.getTime() <= Date.now())
  ) {
    return null;
  }
  const minimumParchinLevel =
    plan.minimumParchinLevel ??
    (plan.parchinIncluded ? "PARCHIN_START" : null);
  if (!minimumParchinLevel || plan.deliveryMode !== "MANAGED") return null;
  if (
    options.parchinLevel &&
    parchinRank(options.parchinLevel) < parchinRank(minimumParchinLevel)
  ) {
    return null;
  }
  return resolveCatalogItemPricing(plan.catalogItem, config, {
    ...options,
    parchinLevel: options.parchinLevel ?? minimumParchinLevel,
  });
}

function parchinRank(level: ParchinLevel): number {
  if (level === "PARCHIN_START") return 1;
  if (level === "PARCHIN_ACTIVE") return 2;
  return 3;
}

export function samePriceSnapshot(
  current: EffectivePlanPricing,
  snapshot: {
    catalogItemId: string | null;
    providerBasePriceRialSnapshot: bigint | null;
    markupBasisPointsSnapshot: number | null;
    finalPriceRialSnapshot: bigint | null;
    currencySnapshot: string | null;
    parchinLevel?: ParchinLevel | null;
    parchinPriceIrr?: bigint | null;
    taxBasisPointsSnapshot?: number | null;
    taxAmountIrr?: bigint | null;
  },
): boolean {
  return (
    snapshot.catalogItemId === current.catalogItemId &&
    snapshot.providerBasePriceRialSnapshot === current.providerBasePriceRial &&
    snapshot.markupBasisPointsSnapshot === current.markupBasisPoints &&
    snapshot.finalPriceRialSnapshot === current.finalPriceRial &&
    snapshot.currencySnapshot === current.currency &&
    (snapshot.parchinLevel === undefined ||
      snapshot.parchinLevel === current.parchinLevel) &&
    (snapshot.parchinPriceIrr === undefined ||
      snapshot.parchinPriceIrr === current.parchinPriceRial) &&
    (snapshot.taxBasisPointsSnapshot === undefined ||
      snapshot.taxBasisPointsSnapshot === current.taxBasisPoints) &&
    (snapshot.taxAmountIrr === undefined ||
      snapshot.taxAmountIrr === current.taxAmountRial)
  );
}

export function samePlanConfigurationSnapshot(
  plan: Pick<
    InfrastructurePlan,
    | "provider"
    | "providerApiVersion"
    | "productKind"
    | "offerSource"
    | "regionCode"
    | "sizeCode"
    | "imageCode"
    | "deliveryMode"
    | "parchinIncluded"
  >,
  current: EffectivePlanPricing,
  snapshot: unknown,
): boolean {
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    Array.isArray(snapshot)
  ) {
    return false;
  }
  const value = snapshot as Record<string, unknown>;
  return (
    value.provider === plan.provider &&
    value.offerSource === plan.offerSource &&
    value.catalogItemId === current.catalogItemId &&
    value.regionCode === plan.regionCode &&
    value.sizeCode === plan.sizeCode &&
    value.imageCode === plan.imageCode &&
    value.deliveryMode === plan.deliveryMode &&
    value.vcpu === current.vcpu &&
    value.ramGb === current.ramGb &&
    value.storageGb === current.storageGb &&
    value.parchinIncluded === plan.parchinIncluded &&
    (value.providerApiVersion == null ||
      value.providerApiVersion === plan.providerApiVersion) &&
    (value.productKind == null || value.productKind === plan.productKind) &&
    (value.parchinLevel == null || value.parchinLevel === current.parchinLevel)
  );
}
