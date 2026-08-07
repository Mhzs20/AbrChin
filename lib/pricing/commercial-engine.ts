/**
 * Unified commercial pricing engine — the ONLY place the AbrChin sale
 * formula lives:
 *
 *   provider cost
 *   + provider markup
 *   + product markup
 *   + Parchin
 *   + add-ons
 *   − term/coupon discount
 *   + tax
 *   = customer final price
 *
 * Storefront cards, quotes, checkout, renewal, the Admin simulator and the
 * pricing tests must all call into this module. UI code may only format the
 * returned amounts — it must never rebuild the formula.
 *
 * This module is intentionally pure (no prisma / no server-only imports) so
 * client components may import the margin↔markup converters and constants.
 */

import type { ParchinLevel, QuoteLineItemType } from "@prisma/client";

export const BPS_DENOMINATOR = 10_000n;

/** Fixed term discounts when no server-purchase coupon overrides them. */
export const TERM_DISCOUNT_BPS: Record<1 | 3 | 6 | 12, number> = {
  1: 0,
  3: 500,
  6: 1_000,
  12: 2_000,
};

export function isBillingTermMonths(value: unknown): value is 1 | 3 | 6 | 12 {
  return value === 1 || value === 3 || value === 6 || value === 12;
}

/**
 * Legacy launch markup that shipped with the first catalog sync. It priced
 * sales at ~3.33× provider cost (~70% gross margin) which Founder replaced
 * with a 30% target gross margin. Kept only so the repair migration and the
 * tests can identify rows that were still on the untouched automatic value.
 */
export const LEGACY_LAUNCH_MARKUP_BASIS_POINTS = 23_333;

/** Launch default: target gross margin 30% of the sale price. */
export const DEFAULT_TARGET_GROSS_MARGIN_BPS = 3_000;

/**
 * Markup equivalent of the 30% target gross margin:
 * markup = margin / (1 − margin) = 3000 / 7000 ≈ 42.86% → 4286 bps.
 */
export const DEFAULT_LAUNCH_MARKUP_BASIS_POINTS = 4_286;

function assertIntegerBps(value: number, max = 100_000): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error("invalid_basis_points");
  }
}

/** ceil(amount × bps / 10000) — the single money rounding policy. */
export function multiplyBpsRoundUp(
  amount: bigint,
  basisPoints: number,
): bigint {
  if (amount < 0n) throw new Error("invalid_money");
  assertIntegerBps(basisPoints);
  if (amount === 0n || basisPoints === 0) return 0n;
  return (amount * BigInt(basisPoints) + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
}

export function divideRoundUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) {
    throw new Error("invalid_rounding_input");
  }
  return (numerator + denominator - 1n) / denominator;
}

/**
 * Gross margin (profit / SALE price) → markup (profit / COST).
 * margin must be an integer in [0, 10000); 10000 (100%) is impossible.
 */
export function grossMarginBpsToMarkupBps(marginBps: number): number {
  if (!Number.isInteger(marginBps) || marginBps < 0 || marginBps >= 10_000) {
    throw new Error("invalid_gross_margin");
  }
  if (marginBps === 0) return 0;
  return Math.round((marginBps * 10_000) / (10_000 - marginBps));
}

/** Markup (profit / COST) → gross margin (profit / SALE price). */
export function markupBpsToGrossMarginBps(markupBps: number): number {
  assertIntegerBps(markupBps, 1_000_000);
  if (markupBps === 0) return 0;
  return Math.round((markupBps * 10_000) / (10_000 + markupBps));
}

export type MarginGuardrailLevel = "ok" | "warn" | "confirm";

export const MARGIN_WARN_THRESHOLD_BPS = 5_000;
export const MARGIN_CONFIRM_THRESHOLD_BPS = 7_000;

/** Typed confirmation phrase required for margins ≥ 70%. */
export const HIGH_MARGIN_CONFIRMATION_PHRASE = "تایید حاشیه بالا";

/**
 * Financial guardrail for a target gross margin:
 * - < 0% or ≥ 100% → throws (rejected)
 * - ≥ 70% → requires typed confirmation
 * - ≥ 50% → warning
 */
export function evaluateMarginGuardrail(marginBps: number): {
  level: MarginGuardrailLevel;
  marginBps: number;
} {
  if (!Number.isInteger(marginBps) || marginBps < 0 || marginBps >= 10_000) {
    throw new Error("invalid_gross_margin");
  }
  if (marginBps >= MARGIN_CONFIRM_THRESHOLD_BPS) {
    return { level: "confirm", marginBps };
  }
  if (marginBps >= MARGIN_WARN_THRESHOLD_BPS) {
    return { level: "warn", marginBps };
  }
  return { level: "ok", marginBps };
}

export type QuoteLineItem = {
  type: QuoteLineItemType;
  label: string;
  amountIrr: bigint;
  metadata?: Record<string, string | number | boolean | null>;
};

export type CommercialPricingInput = {
  providerMonthlyPriceIrr: bigint;
  providerMarkupBps: number;
  productMarkupBps: number;
  parchinLevel: ParchinLevel;
  parchinPriceIrr: bigint;
  /** Customer-facing Parchin title for the line item (versioned contract). */
  parchinTitle?: string | null;
  /** Service-contract version snapshotted onto the line item. */
  parchinVersion?: number | null;
  providerAddons?: Array<{ code: string; label: string; amountIrr: bigint }>;
  taxBps: number;
  /** Prepaid term length. Default 1 month. */
  termMonths?: 1 | 3 | 6 | 12;
  /**
   * When set, replaces the fixed 5/10/20 term discount for the locked coupon
   * term. Amount base is still termMonths × monthly pretax.
   */
  couponDiscountBps?: number | null;
  couponCode?: string | null;
  /**
   * Minimum post-discount gross margin on infrastructure economics.
   * When set, the requested discount is capped so the protected floor holds.
   * Default null preserves historic engine behaviour (no floor).
   */
  minimumPostDiscountGrossMarginBps?: number | null;
  /**
   * When set (profit-curve transition floor), infrastructure sale is exactly
   * this monthly Rial amount and markup BPS is used only for audit/split.
   * Keeps sale continuous across tier boundaries without ceil jitter.
   */
  infrastructureSaleRialOverride?: bigint | null;
};

export type CommercialPriceBreakdown = {
  providerCostRial: bigint;
  providerMarkupRial: bigint;
  productMarkupRial: bigint;
  totalMarkupRial: bigint;
  parchinRial: bigint;
  addonsRial: bigint;
  subtotalBeforeDiscountRial: bigint;
  discountRial: bigint;
  taxableRial: bigint;
  taxRial: bigint;
  finalPriceRial: bigint;
  renewalPriceRial: bigint;
  /** Actual combined markup on cost, derived from amounts. */
  effectiveMarkupBps: number;
  /** Gross margin = markup profit / (provider cost + markup profit). */
  grossMarginBps: number;
  termMonths: 1 | 3 | 6 | 12;
  lineItems: QuoteLineItem[];
  /** Legacy adapter fields (kept so historic snapshots stay byte-identical). */
  markupBps: number;
  termDiscountBps: number;
  discountSource: "none" | "term" | "coupon";
  monthlyPretaxRial: bigint;
  /** Requested discount before the post-discount margin floor cap. */
  requestedDiscountRial: bigint;
  /** Maximum commercially allowed discount under the margin floor. */
  maximumAllowedDiscountRial: bigint;
  /** True when the floor reduced the applied discount below the request. */
  discountCapped: boolean;
  minimumPostDiscountGrossMarginBps: number | null;
};

export function resolveTermDiscountBps(input: {
  termMonths: 1 | 3 | 6 | 12;
  couponDiscountBps?: number | null;
}): { discountBps: number; source: "none" | "term" | "coupon" } {
  if (
    input.couponDiscountBps != null &&
    Number.isInteger(input.couponDiscountBps) &&
    input.couponDiscountBps >= 0
  ) {
    assertIntegerBps(input.couponDiscountBps, 10_000);
    return { discountBps: input.couponDiscountBps, source: "coupon" };
  }
  const fixed = TERM_DISCOUNT_BPS[input.termMonths];
  if (fixed > 0) return { discountBps: fixed, source: "term" };
  return { discountBps: 0, source: "none" };
}

/**
 * The single commercial price computation. Every sale surface (card, quote,
 * checkout, renewal, admin preview) derives its money from this function.
 */
export function computeCommercialPriceBreakdown(
  input: CommercialPricingInput,
): CommercialPriceBreakdown {
  if (input.providerMonthlyPriceIrr <= 0n) {
    throw new Error("invalid_provider_price");
  }
  if (input.parchinPriceIrr < 0n) throw new Error("invalid_parchin_price");
  assertIntegerBps(input.providerMarkupBps);
  assertIntegerBps(input.productMarkupBps);
  assertIntegerBps(input.taxBps, 10_000);

  const termMonths = input.termMonths ?? 1;
  if (!isBillingTermMonths(termMonths)) {
    throw new Error("invalid_term_months");
  }

  const markupBps = input.providerMarkupBps + input.productMarkupBps;
  assertIntegerBps(markupBps);

  let monthlyMarkupIrr: bigint;
  let monthlyProviderMarkupIrr: bigint;
  let monthlyProductMarkupIrr: bigint;

  if (input.infrastructureSaleRialOverride != null) {
    if (input.infrastructureSaleRialOverride <= input.providerMonthlyPriceIrr) {
      throw new Error("invalid_infrastructure_sale_override");
    }
    monthlyMarkupIrr =
      input.infrastructureSaleRialOverride - input.providerMonthlyPriceIrr;
    // Prefer the configured provider markup share; remainder is product.
    const providerShare = multiplyBpsRoundUp(
      input.providerMonthlyPriceIrr,
      input.providerMarkupBps,
    );
    monthlyProviderMarkupIrr =
      providerShare <= monthlyMarkupIrr ? providerShare : monthlyMarkupIrr;
    monthlyProductMarkupIrr = monthlyMarkupIrr - monthlyProviderMarkupIrr;
  } else {
    // Combined ceil first (legacy-stable totals); the provider/product split is
    // derived from it so the two parts always sum exactly to the total.
    monthlyMarkupIrr = multiplyBpsRoundUp(
      input.providerMonthlyPriceIrr,
      markupBps,
    );
    monthlyProviderMarkupIrr = multiplyBpsRoundUp(
      input.providerMonthlyPriceIrr,
      input.providerMarkupBps,
    );
    monthlyProductMarkupIrr = monthlyMarkupIrr - monthlyProviderMarkupIrr;
  }
  const monthlyAddonIrr = (input.providerAddons ?? []).reduce((sum, addon) => {
    if (addon.amountIrr < 0n) throw new Error("invalid_provider_addon");
    return sum + addon.amountIrr;
  }, 0n);
  const monthlyPretaxIrr =
    input.providerMonthlyPriceIrr +
    monthlyMarkupIrr +
    input.parchinPriceIrr +
    monthlyAddonIrr;

  const termMultiplier = BigInt(termMonths);
  const providerTermIrr = input.providerMonthlyPriceIrr * termMultiplier;
  const markupTermIrr = monthlyMarkupIrr * termMultiplier;
  const parchinTermIrr = input.parchinPriceIrr * termMultiplier;
  const addonsTermIrr = monthlyAddonIrr * termMultiplier;
  const addonItems = (input.providerAddons ?? []).map((addon) => ({
    type: "PROVIDER_ADDON" as QuoteLineItemType,
    label: addon.label,
    amountIrr: addon.amountIrr * termMultiplier,
    metadata: { code: addon.code, termMonths },
  }));
  const termPretaxIrr = monthlyPretaxIrr * termMultiplier;

  const { discountBps, source } = resolveTermDiscountBps({
    termMonths,
    couponDiscountBps: input.couponDiscountBps,
  });
  const requestedDiscountIrr = multiplyBpsRoundUp(termPretaxIrr, discountBps);

  const minPostMargin = input.minimumPostDiscountGrossMarginBps ?? null;
  if (
    minPostMargin != null &&
    (!Number.isInteger(minPostMargin) ||
      minPostMargin < 0 ||
      minPostMargin >= 10_000)
  ) {
    throw new Error("invalid_minimum_post_discount_margin");
  }

  /**
   * Protected floor: providerCost / (1 − minMargin) for the term, plus
   * Parchin and direct provider add-on costs (not discounted below recovery).
   */
  let maximumAllowedDiscountIrr = termPretaxIrr;
  if (minPostMargin != null && minPostMargin > 0) {
    const keep = BigInt(10_000 - minPostMargin);
    const monthlyInfraFloor =
      (input.providerMonthlyPriceIrr * BPS_DENOMINATOR + keep - 1n) / keep;
    const protectedFloor =
      monthlyInfraFloor * termMultiplier + parchinTermIrr + addonsTermIrr;
    maximumAllowedDiscountIrr =
      termPretaxIrr > protectedFloor ? termPretaxIrr - protectedFloor : 0n;
  }

  const discountIrr =
    requestedDiscountIrr <= maximumAllowedDiscountIrr
      ? requestedDiscountIrr
      : maximumAllowedDiscountIrr;
  const discountCapped = discountIrr < requestedDiscountIrr;
  const appliedDiscountBps =
    termPretaxIrr > 0n && discountIrr > 0n
      ? Number((discountIrr * 10_000n) / termPretaxIrr)
      : 0;
  const taxableIrr = termPretaxIrr - discountIrr;
  const taxAmountIrr = multiplyBpsRoundUp(taxableIrr, input.taxBps);

  const lineItems: QuoteLineItem[] = [
    {
      type: "PROVIDER_INFRASTRUCTURE" as QuoteLineItemType,
      label: "زیرساخت ابری",
      amountIrr: providerTermIrr,
      metadata: {
        termMonths,
        monthlyAmountIrr: input.providerMonthlyPriceIrr.toString(),
      },
    },
    {
      type: "INFRASTRUCTURE_MARKUP" as QuoteLineItemType,
      label: "خدمات زیرساخت ابرچین",
      amountIrr: markupTermIrr,
      metadata: { basisPoints: markupBps, termMonths },
    },
    {
      type: "PARCHIN" as QuoteLineItemType,
      label:
        input.parchinTitle && input.parchinTitle.trim()
          ? input.parchinVersion != null
            ? `${input.parchinTitle.trim()} · نسخه ${input.parchinVersion}`
            : input.parchinTitle.trim()
          : "پرچین",
      amountIrr: parchinTermIrr,
      metadata: {
        level: input.parchinLevel,
        termMonths,
        version: input.parchinVersion ?? null,
        title: input.parchinTitle?.trim() || null,
      },
    },
    ...addonItems,
  ];

  if (discountIrr > 0n) {
    lineItems.push({
      type: (source === "coupon"
        ? "COUPON_DISCOUNT"
        : "TERM_DISCOUNT") as QuoteLineItemType,
      label: discountCapped
        ? source === "coupon"
          ? `تخفیف حداکثر قابل اعمال${input.couponCode ? ` (${input.couponCode})` : ""}`
          : `تخفیف حداکثر قابل اعمال دوره ${termMonths} ماهه`
        : source === "coupon"
          ? `تخفیف کد${input.couponCode ? ` ${input.couponCode}` : ""}`
          : `تخفیف دوره ${termMonths} ماهه`,
      amountIrr: -discountIrr,
      metadata: {
        basisPoints: discountBps,
        appliedBasisPoints: appliedDiscountBps,
        termMonths,
        source,
        couponCode: input.couponCode ?? null,
        requestedDiscountRial: requestedDiscountIrr.toString(),
        maximumAllowedDiscountRial: maximumAllowedDiscountIrr.toString(),
        appliedDiscountRial: discountIrr.toString(),
        discountCapped,
        minimumPostDiscountGrossMarginBps: minPostMargin,
      },
    });
  }

  lineItems.push({
    type: "TAX" as QuoteLineItemType,
    label: "مالیات",
    amountIrr: taxAmountIrr,
    metadata: { basisPoints: input.taxBps },
  });

  const infrastructureSaleIrr = providerTermIrr + markupTermIrr;
  const effectiveMarkupBps =
    providerTermIrr > 0n
      ? Number((markupTermIrr * 10_000n + providerTermIrr / 2n) / providerTermIrr)
      : 0;
  const grossMarginBps =
    infrastructureSaleIrr > 0n
      ? Number(
          (markupTermIrr * 10_000n + infrastructureSaleIrr / 2n) /
            infrastructureSaleIrr,
        )
      : 0;

  return {
    providerCostRial: providerTermIrr,
    providerMarkupRial: monthlyProviderMarkupIrr * termMultiplier,
    productMarkupRial: monthlyProductMarkupIrr * termMultiplier,
    totalMarkupRial: markupTermIrr,
    parchinRial: parchinTermIrr,
    addonsRial: addonsTermIrr,
    subtotalBeforeDiscountRial: termPretaxIrr,
    discountRial: discountIrr,
    taxableRial: taxableIrr,
    taxRial: taxAmountIrr,
    finalPriceRial: taxableIrr + taxAmountIrr,
    renewalPriceRial:
      monthlyPretaxIrr + multiplyBpsRoundUp(monthlyPretaxIrr, input.taxBps),
    effectiveMarkupBps,
    grossMarginBps,
    termMonths,
    lineItems,
    markupBps,
    termDiscountBps: discountBps,
    discountSource: source,
    monthlyPretaxRial: monthlyPretaxIrr,
    requestedDiscountRial: requestedDiscountIrr,
    maximumAllowedDiscountRial: maximumAllowedDiscountIrr,
    discountCapped,
    minimumPostDiscountGrossMarginBps: minPostMargin,
  };
}

/**
 * Display-only usage equivalents derived from the billed monthly amount so
 * the card can show "معادل ساعتی/روزانه" without a second pricing formula.
 * These are NOT payment models — checkout stays prepaid monthly.
 */
export function deriveUsageEquivalentPrices(finalMonthlyRial: bigint): {
  hourlyRial: bigint;
  dailyRial: bigint;
} {
  if (finalMonthlyRial <= 0n) return { hourlyRial: 0n, dailyRial: 0n };
  return {
    hourlyRial: divideRoundUp(finalMonthlyRial, 720n),
    dailyRial: divideRoundUp(finalMonthlyRial, 30n),
  };
}

export function serializeQuoteLineItems(items: QuoteLineItem[]) {
  return items.map((item) => ({
    ...item,
    amountIrr: item.amountIrr.toString(),
  }));
}
