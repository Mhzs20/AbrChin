import type { ParchinLevel, QuoteLineItemType } from "@prisma/client";

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

export function calculateQuotePricing(input: QuotePricingInput) {
  if (input.providerMonthlyPriceIrr <= 0n) {
    throw new Error("invalid_provider_price");
  }
  if (input.parchinPriceIrr < 0n) throw new Error("invalid_parchin_price");
  assertBps(input.providerMarkupBps);
  assertBps(input.productMarkupBps);
  assertBps(input.taxBps, 10_000);

  const markupBps = input.providerMarkupBps + input.productMarkupBps;
  assertBps(markupBps);
  const markupAmountIrr = multiplyBpsRoundUp(
    input.providerMonthlyPriceIrr,
    markupBps,
  );
  const addonItems = (input.providerAddons ?? []).map((addon) => {
    if (addon.amountIrr < 0n) throw new Error("invalid_provider_addon");
    return {
      type: "PROVIDER_ADDON" as QuoteLineItemType,
      label: addon.label,
      amountIrr: addon.amountIrr,
      metadata: { code: addon.code },
    };
  });
  const preTaxSubtotalIrr =
    input.providerMonthlyPriceIrr +
    markupAmountIrr +
    input.parchinPriceIrr +
    addonItems.reduce((sum, item) => sum + item.amountIrr, 0n);
  const taxAmountIrr = multiplyBpsRoundUp(preTaxSubtotalIrr, input.taxBps);
  const lineItems: QuoteLineItem[] = [
    {
      type: "PROVIDER_INFRASTRUCTURE" as QuoteLineItemType,
      label: "زیرساخت ابری",
      amountIrr: input.providerMonthlyPriceIrr,
    },
    {
      type: "INFRASTRUCTURE_MARKUP" as QuoteLineItemType,
      label: "خدمات زیرساخت ابرچین",
      amountIrr: markupAmountIrr,
      metadata: { basisPoints: markupBps },
    },
    {
      type: "PARCHIN" as QuoteLineItemType,
      label: "پرچین",
      amountIrr: input.parchinPriceIrr,
      metadata: { level: input.parchinLevel },
    },
    ...addonItems,
    {
      type: "TAX" as QuoteLineItemType,
      label: "مالیات",
      amountIrr: taxAmountIrr,
      metadata: { basisPoints: input.taxBps },
    },
  ];

  return {
    markupBps,
    markupAmountIrr,
    preTaxSubtotalIrr,
    taxAmountIrr,
    finalPriceIrr: preTaxSubtotalIrr + taxAmountIrr,
    lineItems,
  };
}

export function serializeQuoteLineItems(items: QuoteLineItem[]) {
  return items.map((item) => ({
    ...item,
    amountIrr: item.amountIrr.toString(),
  }));
}
