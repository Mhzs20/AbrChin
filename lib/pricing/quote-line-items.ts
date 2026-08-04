import type { ParchinLevel, QuoteLineItemType } from "@prisma/client";

import {
  TERM_DISCOUNT_BPS,
  isBillingTermMonths,
} from "@/lib/billing/lifecycle-policy";

const BPS_DENOMINATOR = 10_000n;

export type QuoteLineItem = {
  type: QuoteLineItemType;
  label: string;
  amountIrr: bigint;
  metadata?: Record<string, string | number | boolean | null>;
};

export type QuotePricingInput = {
  providerMonthlyPriceIrr: bigint;
  providerMarkupBps: number;
  productMarkupBps: number;
  parchinLevel: ParchinLevel;
  parchinPriceIrr: bigint;
  providerAddons?: Array<{ code: string; label: string; amountIrr: bigint }>;
  taxBps: number;
  /** Prepaid term length. Default 1 month. */
  termMonths?: 1 | 3 | 6 | 12;
  /**
   * When set, replaces fixed 5/10/20 term discount for the locked coupon term.
   * Amount is still termMonths * monthly pretax before this discount.
   */
  couponDiscountBps?: number | null;
  couponCode?: string | null;
};

function assertBps(value: number, max = 100_000): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error("invalid_basis_points");
  }
}

export function multiplyBpsRoundUp(amount: bigint, basisPoints: number): bigint {
  if (amount < 0n) throw new Error("invalid_money");
  assertBps(basisPoints);
  if (amount === 0n || basisPoints === 0) return 0n;
  return (
    amount * BigInt(basisPoints) +
    BPS_DENOMINATOR -
    1n
  ) / BPS_DENOMINATOR;
}

export function resolveTermDiscountBps(input: {
  termMonths: 1 | 3 | 6 | 12;
  couponDiscountBps?: number | null;
}): { discountBps: number; source: "none" | "term" | "coupon" } {
  if (
    input.couponDiscountBps != null &&
    Number.isInteger(input.couponDiscountBps) &&
    input.couponDiscountBps >= 0
  ) {
    assertBps(input.couponDiscountBps, 10_000);
    return { discountBps: input.couponDiscountBps, source: "coupon" };
  }
  const fixed = TERM_DISCOUNT_BPS[input.termMonths];
  if (fixed > 0) return { discountBps: fixed, source: "term" };
  return { discountBps: 0, source: "none" };
}

export function calculateQuotePricing(input: QuotePricingInput) {
  if (input.providerMonthlyPriceIrr <= 0n) {
    throw new Error("invalid_provider_price");
  }
  if (input.parchinPriceIrr < 0n) throw new Error("invalid_parchin_price");
  assertBps(input.providerMarkupBps);
  assertBps(input.productMarkupBps);
  assertBps(input.taxBps, 10_000);

  const termMonths = input.termMonths ?? 1;
  if (!isBillingTermMonths(termMonths)) {
    throw new Error("invalid_term_months");
  }

  const markupBps = input.providerMarkupBps + input.productMarkupBps;
  assertBps(markupBps);
  const monthlyMarkupIrr = multiplyBpsRoundUp(
    input.providerMonthlyPriceIrr,
    markupBps,
  );
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
  const discountIrr = multiplyBpsRoundUp(termPretaxIrr, discountBps);
  const taxableIrr = termPretaxIrr - discountIrr;
  const taxAmountIrr = multiplyBpsRoundUp(taxableIrr, input.taxBps);

  const lineItems: QuoteLineItem[] = [
    {
      type: "PROVIDER_INFRASTRUCTURE" as QuoteLineItemType,
      label: "زیرساخت ابری",
      amountIrr: providerTermIrr,
      metadata: { termMonths, monthlyAmountIrr: input.providerMonthlyPriceIrr.toString() },
    },
    {
      type: "INFRASTRUCTURE_MARKUP" as QuoteLineItemType,
      label: "خدمات زیرساخت ابرچین",
      amountIrr: markupTermIrr,
      metadata: { basisPoints: markupBps, termMonths },
    },
    {
      type: "PARCHIN" as QuoteLineItemType,
      label: "پرچین",
      amountIrr: parchinTermIrr,
      metadata: { level: input.parchinLevel, termMonths },
    },
    ...addonItems,
  ];

  if (discountIrr > 0n) {
    lineItems.push({
      type: (source === "coupon"
        ? "COUPON_DISCOUNT"
        : "TERM_DISCOUNT") as QuoteLineItemType,
      label:
        source === "coupon"
          ? `تخفیف کد${input.couponCode ? ` ${input.couponCode}` : ""}`
          : `تخفیف دوره ${termMonths} ماهه`,
      amountIrr: -discountIrr,
      metadata: {
        basisPoints: discountBps,
        termMonths,
        source,
        couponCode: input.couponCode ?? null,
      },
    });
  }

  lineItems.push({
    type: "TAX" as QuoteLineItemType,
    label: "مالیات",
    amountIrr: taxAmountIrr,
    metadata: { basisPoints: input.taxBps },
  });

  return {
    markupBps,
    markupAmountIrr: markupTermIrr,
    termMonths,
    termDiscountBps: discountBps,
    discountSource: source,
    discountIrr,
    monthlyPretaxIrr,
    preTaxSubtotalIrr: taxableIrr,
    taxAmountIrr,
    finalPriceIrr: taxableIrr + taxAmountIrr,
    renewalAmountIrr: monthlyPretaxIrr + multiplyBpsRoundUp(monthlyPretaxIrr, input.taxBps),
    lineItems,
  };
}

export function serializeQuoteLineItems(items: QuoteLineItem[]) {
  return items.map((item) => ({
    ...item,
    amountIrr: item.amountIrr.toString(),
  }));
}
