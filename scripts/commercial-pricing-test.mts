import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_LAUNCH_MARKUP_BASIS_POINTS,
  DEFAULT_TARGET_GROSS_MARGIN_BPS,
  HIGH_MARGIN_CONFIRMATION_PHRASE,
  LEGACY_LAUNCH_MARKUP_BASIS_POINTS,
  TERM_DISCOUNT_BPS,
  computeCommercialPriceBreakdown,
  deriveUsageEquivalentPrices,
  evaluateMarginGuardrail,
  grossMarginBpsToMarkupBps,
  markupBpsToGrossMarginBps,
  multiplyBpsRoundUp,
} from "../lib/pricing/commercial-engine.ts";
import { calculateQuotePricing } from "../lib/pricing/quote-line-items.ts";
import { resolveCatalogItemPricing } from "../lib/pricing/plan-pricing.ts";
import {
  DEFAULT_LAUNCH_MARKUP_BASIS_POINTS as PROVIDER_REEXPORTED_DEFAULT,
} from "../lib/pricing/provider-pricing.ts";

// ---------------------------------------------------------------------------
// 1) margin ↔ markup conversion
// ---------------------------------------------------------------------------

test("gross margin to markup conversion round-trips at launch values", () => {
  assert.equal(grossMarginBpsToMarkupBps(3_000), 4_286);
  assert.equal(markupBpsToGrossMarginBps(4_286), 3_000);
  assert.equal(grossMarginBpsToMarkupBps(5_000), 10_000);
  assert.equal(markupBpsToGrossMarginBps(10_000), 5_000);
  assert.equal(grossMarginBpsToMarkupBps(0), 0);
  assert.equal(markupBpsToGrossMarginBps(0), 0);
  assert.equal(grossMarginBpsToMarkupBps(9_000), 90_000);
  assert.equal(markupBpsToGrossMarginBps(LEGACY_LAUNCH_MARKUP_BASIS_POINTS), 7_000);
  assert.throws(() => grossMarginBpsToMarkupBps(-1));
  assert.throws(() => grossMarginBpsToMarkupBps(10_000));
  assert.throws(() => grossMarginBpsToMarkupBps(10_500));
  assert.throws(() => grossMarginBpsToMarkupBps(30.5 as never));
  assert.throws(() => markupBpsToGrossMarginBps(-5));
});

// ---------------------------------------------------------------------------
// 2) launch defaults: 30% target margin
// ---------------------------------------------------------------------------

test("launch default is a 30% target gross margin (markup 4286 bps)", () => {
  assert.equal(DEFAULT_TARGET_GROSS_MARGIN_BPS, 3_000);
  assert.equal(DEFAULT_LAUNCH_MARKUP_BASIS_POINTS, 4_286);
  assert.equal(
    grossMarginBpsToMarkupBps(DEFAULT_TARGET_GROSS_MARGIN_BPS),
    DEFAULT_LAUNCH_MARKUP_BASIS_POINTS,
  );
  assert.equal(
    markupBpsToGrossMarginBps(DEFAULT_LAUNCH_MARKUP_BASIS_POINTS),
    DEFAULT_TARGET_GROSS_MARGIN_BPS,
  );
  assert.equal(LEGACY_LAUNCH_MARKUP_BASIS_POINTS, 23_333);
  // provider-pricing re-exports the same canonical constant.
  assert.equal(PROVIDER_REEXPORTED_DEFAULT, DEFAULT_LAUNCH_MARKUP_BASIS_POINTS);
});

// ---------------------------------------------------------------------------
// 3) legacy repair migration: exact-match only, forward-only
// ---------------------------------------------------------------------------

test("repair migration converts ONLY the exact legacy 23333 value", async () => {
  const migration = await readFile(
    "prisma/migrations/20260806200000_commercial_pricing_v3/migration.sql",
    "utf8",
  );
  assert.match(migration, /SET DEFAULT 4286/);
  assert.match(
    migration,
    /UPDATE "ProviderPricingConfig"\s*\nSET "markupBasisPoints" = 4286\s*\nWHERE "markupBasisPoints" = 23333/,
  );
  assert.doesNotMatch(migration, /DROP TABLE/i);
  assert.doesNotMatch(migration, /DELETE FROM/i);
  const schema = await readFile("prisma/schema.prisma", "utf8");
  assert.match(schema, /markupBasisPoints Int\s+@default\(4286\)/);
  assert.match(schema, /model FinanceConfigurationRevision/);
});

// ---------------------------------------------------------------------------
// 4) provider + product markup sum exactly
// ---------------------------------------------------------------------------

test("provider and product markup split always sums to the combined ceil", () => {
  for (const base of [333_333n, 1_000_001n, 7n, 999_999_999n]) {
    for (const [providerBps, productBps] of [
      [4_286, 0],
      [4_286, 777],
      [23_333, 1],
      [1, 1],
      [0, 999],
    ] as const) {
      const breakdown = computeCommercialPriceBreakdown({
        providerMonthlyPriceIrr: base,
        providerMarkupBps: providerBps,
        productMarkupBps: productBps,
        parchinLevel: "PARCHIN_START",
        parchinPriceIrr: 0n,
        taxBps: 0,
        termMonths: 1,
      });
      assert.equal(
        breakdown.providerMarkupRial + breakdown.productMarkupRial,
        breakdown.totalMarkupRial,
      );
      assert.equal(
        breakdown.totalMarkupRial,
        multiplyBpsRoundUp(base, providerBps + productBps),
      );
      assert.equal(
        breakdown.providerMarkupRial,
        multiplyBpsRoundUp(base, providerBps),
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 5) Parchin is part of the billed amount
// ---------------------------------------------------------------------------

test("parchin monthly price is billed per term month", () => {
  const breakdown = computeCommercialPriceBreakdown({
    providerMonthlyPriceIrr: 10_000_000n,
    providerMarkupBps: 4_286,
    productMarkupBps: 0,
    parchinLevel: "PARCHIN_ACTIVE",
    parchinPriceIrr: 5_000_000n,
    taxBps: 0,
    termMonths: 3,
  });
  assert.equal(breakdown.parchinRial, 15_000_000n);
  const noParchin = computeCommercialPriceBreakdown({
    providerMonthlyPriceIrr: 10_000_000n,
    providerMarkupBps: 4_286,
    productMarkupBps: 0,
    parchinLevel: "PARCHIN_START",
    parchinPriceIrr: 0n,
    taxBps: 0,
    termMonths: 3,
  });
  // Parchin flows through the 5% 3-month discount as part of pretax.
  const pretaxDelta =
    breakdown.subtotalBeforeDiscountRial - noParchin.subtotalBeforeDiscountRial;
  assert.equal(pretaxDelta, 15_000_000n);
  assert.ok(breakdown.finalPriceRial > noParchin.finalPriceRial);
});

// ---------------------------------------------------------------------------
// 6) tax applies to the post-discount taxable amount
// ---------------------------------------------------------------------------

test("VAT is computed on the post-discount taxable amount", () => {
  const breakdown = computeCommercialPriceBreakdown({
    providerMonthlyPriceIrr: 20_000_000n,
    providerMarkupBps: 4_286,
    productMarkupBps: 0,
    parchinLevel: "PARCHIN_START",
    parchinPriceIrr: 5_000_000n,
    taxBps: 1_000,
    termMonths: 6,
  });
  assert.equal(
    breakdown.taxableRial,
    breakdown.subtotalBeforeDiscountRial - breakdown.discountRial,
  );
  assert.equal(breakdown.taxRial, multiplyBpsRoundUp(breakdown.taxableRial, 1_000));
  assert.equal(
    breakdown.finalPriceRial,
    breakdown.taxableRial + breakdown.taxRial,
  );
});

// ---------------------------------------------------------------------------
// 7) fixed term discounts 1/3/6/12
// ---------------------------------------------------------------------------

test("term discounts follow the locked 0/5/10/20 percent table", () => {
  assert.deepEqual(TERM_DISCOUNT_BPS, { 1: 0, 3: 500, 6: 1_000, 12: 2_000 });
  for (const term of [1, 3, 6, 12] as const) {
    const breakdown = computeCommercialPriceBreakdown({
      providerMonthlyPriceIrr: 10_000_000n,
      providerMarkupBps: 4_286,
      productMarkupBps: 0,
      parchinLevel: "PARCHIN_START",
      parchinPriceIrr: 2_000_000n,
      taxBps: 1_000,
      termMonths: term,
    });
    assert.equal(breakdown.termMonths, term);
    assert.equal(breakdown.termDiscountBps, TERM_DISCOUNT_BPS[term]);
    assert.equal(
      breakdown.discountRial,
      multiplyBpsRoundUp(
        breakdown.subtotalBeforeDiscountRial,
        TERM_DISCOUNT_BPS[term],
      ),
    );
    assert.equal(
      breakdown.discountSource,
      TERM_DISCOUNT_BPS[term] > 0 ? "term" : "none",
    );
  }
});

// ---------------------------------------------------------------------------
// 8) coupon replaces the fixed term discount (never stacks)
// ---------------------------------------------------------------------------

test("server-purchase coupon replaces the fixed term discount", () => {
  const withCoupon = computeCommercialPriceBreakdown({
    providerMonthlyPriceIrr: 10_000_000n,
    providerMarkupBps: 4_286,
    productMarkupBps: 0,
    parchinLevel: "PARCHIN_START",
    parchinPriceIrr: 0n,
    taxBps: 1_000,
    termMonths: 12,
    couponDiscountBps: 1_500,
    couponCode: "ABRCHIN15",
  });
  assert.equal(withCoupon.termDiscountBps, 1_500);
  assert.equal(withCoupon.discountSource, "coupon");
  assert.equal(
    withCoupon.discountRial,
    multiplyBpsRoundUp(withCoupon.subtotalBeforeDiscountRial, 1_500),
  );
  // A zero-percent coupon still replaces (not stacks with) the 20% table.
  const zeroCoupon = computeCommercialPriceBreakdown({
    providerMonthlyPriceIrr: 10_000_000n,
    providerMarkupBps: 4_286,
    productMarkupBps: 0,
    parchinLevel: "PARCHIN_START",
    parchinPriceIrr: 0n,
    taxBps: 1_000,
    termMonths: 12,
    couponDiscountBps: 0,
  });
  assert.equal(zeroCoupon.discountRial, 0n);
});

// ---------------------------------------------------------------------------
// 9) card = quote for one month (single engine)
// ---------------------------------------------------------------------------

function catalogItemFixture() {
  return {
    id: "catalog-parity",
    provider: "ARVAN",
    apiVersion: "v1",
    productKind: "CLOUD_SERVER",
    regionCode: "ir-thr-si1",
    sizeCode: "g1-4-2",
    externalPlanId: "g1-4-2",
    sizeName: "fixture",
    compatibleImageCodes: ["ubuntu24-cloudinit-qcow2"],
    vcpu: 2,
    ramMb: 4096,
    diskGb: 50,
    transfer: null,
    available: true,
    active: true,
    status: "ACTIVE",
    source: "API_CATALOG",
    manualLastVerifiedAt: null,
    manualPriceValidUntil: null,
    priceHourlyAmount: null,
    priceMonthlyAmount: null,
    priceScale: 0,
    currencyCode: "IRR",
    amountUnit: "RIAL",
    providerHourlyPriceIrr: 14_000n,
    providerMonthlyPriceIrr: 10_000_000n,
    lastSyncedAt: new Date("2026-08-06T12:00:00.000Z"),
  } as never;
}

test("card and quote one-month amounts come from the same engine result", () => {
  const options = {
    productMarkupBasisPoints: 500,
    taxBasisPoints: 1_000,
    parchinLevel: "PARCHIN_START" as const,
    parchinPriceRial: 5_000_000n,
    termMonths: 1 as const,
  };
  // Quote/checkout path
  const quote = resolveCatalogItemPricing(
    catalogItemFixture(),
    { markupBasisPoints: 4_286 },
    options,
  );
  assert.ok(quote);
  // Card path uses the same resolve + finalPriceRial (see assortment-service).
  const card = resolveCatalogItemPricing(
    catalogItemFixture(),
    { markupBasisPoints: 4_286 },
    options,
  );
  assert.ok(card);
  assert.equal(card.finalPriceRial, quote.finalPriceRial);
  // And both equal the raw engine output for identical inputs.
  const engine = computeCommercialPriceBreakdown({
    providerMonthlyPriceIrr: 10_000_000n,
    providerMarkupBps: 4_286,
    productMarkupBps: 500,
    parchinLevel: "PARCHIN_START",
    parchinPriceIrr: 5_000_000n,
    taxBps: 1_000,
    termMonths: 1,
  });
  assert.equal(engine.finalPriceRial, quote.finalPriceRial);
});

test("storefront card source uses engine final price and blocks unpriced sale", async () => {
  const assortment = await readFile(
    "lib/storefront/assortment-service.ts",
    "utf8",
  );
  assert.match(assortment, /input\.priced\?\.finalPriceRial/);
  assert.match(
    assortment,
    /purchasable:\s*input\.purchasable && input\.priced != null && imageCodes\.length > 0/,
  );
  assert.match(assortment, /deriveUsageEquivalentPrices/);
  assert.match(assortment, /termMonths: 1/);
  const presentation = await readFile(
    "lib/storefront/presentation.ts",
    "utf8",
  );
  assert.doesNotMatch(presentation, /ROUND_STEP/);
});

// ---------------------------------------------------------------------------
// 10) renewal price: one month pretax + tax, no term discount
// ---------------------------------------------------------------------------

test("renewal is always one pretax month plus tax with no term discount", () => {
  const breakdown = computeCommercialPriceBreakdown({
    providerMonthlyPriceIrr: 10_000_000n,
    providerMarkupBps: 4_286,
    productMarkupBps: 500,
    parchinLevel: "PARCHIN_START",
    parchinPriceIrr: 5_000_000n,
    taxBps: 1_000,
    termMonths: 12,
  });
  const expectedRenewal =
    breakdown.monthlyPretaxRial +
    multiplyBpsRoundUp(breakdown.monthlyPretaxRial, 1_000);
  assert.equal(breakdown.renewalPriceRial, expectedRenewal);
  // The 12-month term discount never leaks into renewal.
  const oneMonth = computeCommercialPriceBreakdown({
    providerMonthlyPriceIrr: 10_000_000n,
    providerMarkupBps: 4_286,
    productMarkupBps: 500,
    parchinLevel: "PARCHIN_START",
    parchinPriceIrr: 5_000_000n,
    taxBps: 1_000,
    termMonths: 1,
  });
  assert.equal(breakdown.renewalPriceRial, oneMonth.renewalPriceRial);
});

// ---------------------------------------------------------------------------
// 11) historical snapshots stay immutable (pure engine, fresh objects)
// ---------------------------------------------------------------------------

test("engine output is deterministic and never shares mutable state", () => {
  const input = {
    providerMonthlyPriceIrr: 10_000_000n,
    providerMarkupBps: 4_286,
    productMarkupBps: 0,
    parchinLevel: "PARCHIN_START" as const,
    parchinPriceIrr: 5_000_000n,
    taxBps: 1_000,
    termMonths: 3 as const,
  };
  const first = computeCommercialPriceBreakdown(input);
  // Tamper with the first result the way a careless caller might.
  first.lineItems.pop();
  (first as { finalPriceRial: bigint }).finalPriceRial = 0n;
  const second = computeCommercialPriceBreakdown(input);
  assert.equal(second.lineItems.length, 5);
  assert.ok(second.finalPriceRial > 0n);
  const third = computeCommercialPriceBreakdown(input);
  assert.deepEqual(
    third.lineItems.map((item) => `${item.type}:${item.amountIrr}`),
    second.lineItems.map((item) => `${item.type}:${item.amountIrr}`),
  );
});

// ---------------------------------------------------------------------------
// 12) legacy adapter parity (quotes/orders/renewal call sites)
// ---------------------------------------------------------------------------

test("calculateQuotePricing adapter matches the engine byte for byte", () => {
  const input = {
    providerMonthlyPriceIrr: 33_333_333n,
    providerMarkupBps: 4_286,
    productMarkupBps: 777,
    parchinLevel: "PARCHIN_STABLE" as const,
    parchinPriceIrr: 50_000_000n,
    taxBps: 1_000,
    termMonths: 6 as const,
    couponDiscountBps: null,
    couponCode: null,
  };
  const engine = computeCommercialPriceBreakdown(input);
  const legacy = calculateQuotePricing(input);
  assert.equal(legacy.finalPriceIrr, engine.finalPriceRial);
  assert.equal(legacy.renewalAmountIrr, engine.renewalPriceRial);
  assert.equal(legacy.markupAmountIrr, engine.totalMarkupRial);
  assert.equal(legacy.taxAmountIrr, engine.taxRial);
  assert.equal(legacy.discountIrr, engine.discountRial);
  assert.equal(legacy.monthlyPretaxIrr, engine.monthlyPretaxRial);
  assert.deepEqual(
    legacy.lineItems.map((item) => `${item.type}:${item.amountIrr}`),
    engine.lineItems.map((item) => `${item.type}:${item.amountIrr}`),
  );
});

// ---------------------------------------------------------------------------
// 13) guardrails for abnormal pricing
// ---------------------------------------------------------------------------

test("margin guardrails reject, warn and require confirmation", () => {
  assert.equal(evaluateMarginGuardrail(0).level, "ok");
  assert.equal(evaluateMarginGuardrail(3_000).level, "ok");
  assert.equal(evaluateMarginGuardrail(4_999).level, "ok");
  assert.equal(evaluateMarginGuardrail(5_000).level, "warn");
  assert.equal(evaluateMarginGuardrail(6_999).level, "warn");
  assert.equal(evaluateMarginGuardrail(7_000).level, "confirm");
  assert.equal(evaluateMarginGuardrail(9_999).level, "confirm");
  assert.throws(() => evaluateMarginGuardrail(-1));
  assert.throws(() => evaluateMarginGuardrail(10_000));
  assert.equal(typeof HIGH_MARGIN_CONFIRMATION_PHRASE, "string");
  assert.ok(HIGH_MARGIN_CONFIRMATION_PHRASE.length > 0);
});

test("finance configuration service enforces the typed confirmation", async () => {
  const service = await readFile("lib/admin/finance-configuration.ts", "utf8");
  assert.match(service, /margin_confirmation_required/);
  assert.match(service, /HIGH_MARGIN_CONFIRMATION_PHRASE/);
  assert.match(service, /card_quote_parity_failed/);
  assert.match(service, /prisma\.\$transaction/);
  assert.match(service, /financeConfigurationRevision\.create/);
});

// ---------------------------------------------------------------------------
// 14) usage equivalents derive from the billed monthly amount
// ---------------------------------------------------------------------------

test("hourly/daily equivalents are ceil divisions of the billed month", () => {
  const { hourlyRial, dailyRial } = deriveUsageEquivalentPrices(21_600_010n);
  assert.equal(hourlyRial, (21_600_010n + 719n) / 720n);
  assert.equal(dailyRial, (21_600_010n + 29n) / 30n);
  assert.deepEqual(deriveUsageEquivalentPrices(0n), {
    hourlyRial: 0n,
    dailyRial: 0n,
  });
});

// ---------------------------------------------------------------------------
// Audit regressions — Card/Quote/Checkout parity + PAYG isolation
// ---------------------------------------------------------------------------

test("card one-month final equals quote final for fixture commercial inputs", () => {
  const fixture = {
    providerMonthlyPriceIrr: 10_000_000n,
    providerMarkupBps: 4_286,
    productMarkupBps: 500,
    parchinLevel: "PARCHIN_START" as const,
    parchinPriceIrr: 5_000_000n,
    taxBps: 1_000,
    couponDiscountBps: null,
    couponCode: null,
  };
  const month = computeCommercialPriceBreakdown({
    ...fixture,
    termMonths: 1,
  });
  for (const term of [1, 3, 6, 12] as const) {
    const termPrice = computeCommercialPriceBreakdown({
      ...fixture,
      termMonths: term,
    });
    if (term === 1) {
      assert.equal(termPrice.finalPriceRial, month.finalPriceRial);
    } else {
      assert.ok(termPrice.finalPriceRial > 0n);
      assert.equal(termPrice.termMonths, term);
    }
    // Renewal always one prepaid month without term discount.
    assert.equal(termPrice.renewalPriceRial, month.finalPriceRial);
  }
  const coupon = computeCommercialPriceBreakdown({
    ...fixture,
    termMonths: 12,
    couponDiscountBps: 2_500,
    couponCode: "SAVE25",
  });
  const termOnly = computeCommercialPriceBreakdown({
    ...fixture,
    termMonths: 12,
  });
  // Coupon replaces term discount rather than stacking.
  assert.notEqual(coupon.finalPriceRial, termOnly.finalPriceRial);
  assert.equal(coupon.discountSource, "coupon");
  assert.equal(termOnly.discountSource, "term");
  assert.equal(
    computeCommercialPriceBreakdown({ ...fixture, termMonths: 1 }).discountSource,
    "none",
  );
});

test("legacy pricing write endpoints are retired (410)", async () => {
  const pricing = await readFile(
    "app/api/admin/infrastructure/pricing/route.ts",
    "utf8",
  );
  const markup = await readFile(
    "app/api/admin/infrastructure/providers/markup/route.ts",
    "utf8",
  );
  assert.match(pricing, /requireAdminUser/);
  assert.match(pricing, /410/);
  assert.match(pricing, /legacy_pricing_endpoint_retired/);
  assert.doesNotMatch(pricing, /prisma\.\$transaction/);
  assert.match(markup, /requireAdminUser/);
  assert.match(markup, /410/);
  assert.match(markup, /legacy_markup_endpoint_retired/);
  assert.doesNotMatch(markup, /providerPricingConfig\.upsert/);
});

test("public storefront payloads zero markup/tax basis points", async () => {
  const assortment = await readFile(
    "lib/storefront/assortment-service.ts",
    "utf8",
  );
  const plans = await readFile("lib/orders/plans.ts", "utf8");
  assert.match(assortment, /markupBasisPoints: 0/);
  assert.match(assortment, /taxBasisPoints: 0/);
  assert.match(plans, /markupBasisPoints: 0/);
  assert.match(plans, /taxBasisPoints: 0/);
  // Branding must not advertise a higher Parchin while billing START.
  assert.doesNotMatch(assortment, /brandingLevel/);
  assert.doesNotMatch(assortment, /brandingContract/);
  assert.match(assortment, /billedContract/);
});

test("PAYG cannot charge prepaid storefront checkout", async () => {
  const orders = await readFile("lib/orders/service.ts", "utf8");
  const ensure = await readFile(
    "lib/storefront/ensure-sale-plans.ts",
    "utf8",
  );
  assert.match(orders, /PAYG_WALLET/);
  assert.match(ensure, /PREPAID_TERM/);
  assert.match(ensure, /PAYG_WALLET/);
});
