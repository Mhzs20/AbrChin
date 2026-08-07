/**
 * Applies the published profit curve as the provider-markup source for normal
 * API-catalog server sales. Product/SKU markup remains a separate additive
 * override — never replace or double-apply the legacy flat provider margin.
 */

import type { InfrastructureProductKind, InfrastructurePlan } from "@prisma/client";

import {
  DEFAULT_MINIMUM_POST_DISCOUNT_GROSS_MARGIN_BPS,
  defaultProfitCurveConfig,
  parseProfitCurveConfig,
  resolveProfitCurve,
  type ProfitCurveConfigInput,
  type ProfitCurveResolution,
} from "@/lib/pricing/profit-curve";

const CURVE_PRODUCT_KINDS = new Set<InfrastructureProductKind>([
  "CLOUD_SERVER",
  "READY_INSTANT_SERVER",
]);

export function isProfitCurveEligiblePlan(plan: Pick<
  InfrastructurePlan,
  "offerSource" | "productKind"
>): boolean {
  if (plan.offerSource !== "API_CATALOG") return false;
  return CURVE_PRODUCT_KINDS.has(plan.productKind);
}

export type ResolvedProviderMarkup = {
  providerMarkupBps: number;
  infrastructureSaleRialOverride: bigint | null;
  curve: ProfitCurveResolution | null;
  source: "profit_curve" | "provider_config" | "manual_zero";
};

export function resolveProviderMarkupForPlan(input: {
  plan: Pick<InfrastructurePlan, "offerSource" | "productKind">;
  providerMonthlyCostRial: bigint;
  providerConfigMarkupBps: number;
  profitCurve: ProfitCurveConfigInput | null | undefined;
  manualAdmin?: boolean;
}): ResolvedProviderMarkup {
  if (input.manualAdmin) {
    return {
      providerMarkupBps: 0,
      infrastructureSaleRialOverride: null,
      curve: null,
      source: "manual_zero",
    };
  }
  const curve = input.profitCurve ?? null;
  if (
    curve?.enabled &&
    isProfitCurveEligiblePlan(input.plan) &&
    input.providerMonthlyCostRial > 0n
  ) {
    const resolved = resolveProfitCurve({
      providerMonthlyCostRial: input.providerMonthlyCostRial,
      bands: curve.bands,
    });
    return {
      providerMarkupBps: resolved.effectiveMarkupBps,
      infrastructureSaleRialOverride: resolved.transition
        ? resolved.infrastructureSaleRial
        : null,
      curve: resolved,
      source: "profit_curve",
    };
  }
  return {
    providerMarkupBps: input.providerConfigMarkupBps,
    infrastructureSaleRialOverride: null,
    curve: null,
    source: "provider_config",
  };
}

export function buildCommercialEconomicsSnapshot(input: {
  financeRevisionId?: string | null;
  profitCurve: ProfitCurveConfigInput | null | undefined;
  curveResolution: ProfitCurveResolution | null;
  providerCostRial: bigint;
  providerMarkupBps: number;
  productMarkupBps: number;
  source: ResolvedProviderMarkup["source"];
}) {
  const curve = input.profitCurve ?? null;
  return {
    financeConfigurationRevisionId: input.financeRevisionId ?? null,
    profitCurveEnabled: Boolean(curve?.enabled),
    profitCurve: curve
      ? {
          enabled: curve.enabled,
          minimumPostDiscountGrossMarginBps:
            curve.minimumPostDiscountGrossMarginBps,
          bands: curve.bands.map((band) => ({
            id: band.id ?? null,
            sortOrder: band.sortOrder,
            minProviderCostRial: band.minProviderCostRial.toString(),
            maxProviderCostRial:
              band.maxProviderCostRial == null
                ? null
                : band.maxProviderCostRial.toString(),
            targetGrossMarginBps: band.targetGrossMarginBps,
          })),
        }
      : null,
    bandId: input.curveResolution?.bandId ?? null,
    targetGrossMarginBps: input.curveResolution?.targetGrossMarginBps ?? null,
    effectiveGrossMarginBps:
      input.curveResolution?.effectiveGrossMarginBps ?? null,
    effectiveProviderMarkupBps: input.providerMarkupBps,
    productSkuOverrideMarkupBps: input.productMarkupBps,
    providerCostRial: input.providerCostRial.toString(),
    markupSource: input.source,
    transition: input.curveResolution?.transition ?? false,
    transitionStartRial:
      input.curveResolution?.transitionStartRial?.toString() ?? null,
    transitionEndRial:
      input.curveResolution?.transitionEndRial?.toString() ?? null,
  };
}

export function coerceProfitCurveConfig(
  value: unknown,
): ProfitCurveConfigInput {
  return parseProfitCurveConfig(value) ?? defaultProfitCurveConfig();
}

export function minimumPostDiscountMarginFromConfigs(commerce: {
  minimumPostDiscountGrossMarginBps?: number | null;
} | null | undefined, profitCurve?: ProfitCurveConfigInput | null): number {
  if (
    profitCurve &&
    Number.isInteger(profitCurve.minimumPostDiscountGrossMarginBps)
  ) {
    return profitCurve.minimumPostDiscountGrossMarginBps;
  }
  if (
    commerce &&
    Number.isInteger(commerce.minimumPostDiscountGrossMarginBps)
  ) {
    return commerce.minimumPostDiscountGrossMarginBps as number;
  }
  return DEFAULT_MINIMUM_POST_DISCOUNT_GROSS_MARGIN_BPS;
}
