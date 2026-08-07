/**
 * Thin adapter over the unified commercial engine. Kept so existing quote,
 * checkout and renewal call sites (and their persisted snapshots) keep the
 * exact same shape. The formula itself lives ONLY in commercial-engine.ts.
 */

import {
  computeCommercialPriceBreakdown,
  type CommercialPricingInput,
} from "@/lib/pricing/commercial-engine";

export {
  multiplyBpsRoundUp,
  resolveTermDiscountBps,
  serializeQuoteLineItems,
  type QuoteLineItem,
} from "@/lib/pricing/commercial-engine";

export type QuotePricingInput = CommercialPricingInput;

export function calculateQuotePricing(input: QuotePricingInput) {
  const breakdown = computeCommercialPriceBreakdown(input);
  return {
    markupBps: breakdown.markupBps,
    markupAmountIrr: breakdown.totalMarkupRial,
    termMonths: breakdown.termMonths,
    termDiscountBps: breakdown.termDiscountBps,
    discountSource: breakdown.discountSource,
    discountIrr: breakdown.discountRial,
    monthlyPretaxIrr: breakdown.monthlyPretaxRial,
    preTaxSubtotalIrr: breakdown.taxableRial,
    taxAmountIrr: breakdown.taxRial,
    finalPriceIrr: breakdown.finalPriceRial,
    renewalAmountIrr: breakdown.renewalPriceRial,
    lineItems: breakdown.lineItems,
    requestedDiscountIrr: breakdown.requestedDiscountRial,
    maximumAllowedDiscountIrr: breakdown.maximumAllowedDiscountRial,
    discountCapped: breakdown.discountCapped,
    minimumPostDiscountGrossMarginBps:
      breakdown.minimumPostDiscountGrossMarginBps,
    providerMarkupRial: breakdown.providerMarkupRial,
    productMarkupRial: breakdown.productMarkupRial,
  };
}
