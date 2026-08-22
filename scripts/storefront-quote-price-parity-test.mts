/**
 * Guards the storefront card price against drifting away from the quote price.
 *
 * Regression: the card priced a plan with the flat ProviderPricingConfig markup
 * while the quote priced the same plan through the profit curve, so a customer
 * clicked one amount and was charged another. Both paths must resolve the
 * provider markup from the same curve and pass the same four commercial inputs.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveCatalogItemPricing } from "../lib/pricing/plan-pricing.ts";
import { resolveProviderMarkupForPlan } from "../lib/pricing/profit-curve-apply.ts";
import { defaultProfitCurveConfig } from "../lib/pricing/profit-curve.ts";

/** Real provider cost behind the cheapest Tehran card at launch. */
const PROVIDER_MONTHLY_COST_RIAL = 8_294_400n;
/** ProviderPricingConfig.markupBasisPoints default — the pre-fix card source. */
const FLAT_PROVIDER_MARKUP_BPS = 4_286;
const PARCHIN_START_RIAL = 5_000_000n;
const TAX_BPS = 1_000;

const curve = defaultProfitCurveConfig();

function catalogItem() {
  return {
    id: "catalog-item-price-parity",
    active: true,
    available: true,
    status: "ACTIVE",
    source: "API_CATALOG",
    providerMonthlyPriceIrr: PROVIDER_MONTHLY_COST_RIAL,
    manualLastVerifiedAt: null,
    manualPriceValidUntil: null,
    lastSyncedAt: new Date("2026-08-21T00:00:00.000Z"),
    vcpu: 1,
    ramMb: 2048,
    diskGb: 40,
  } as unknown as Parameters<typeof resolveCatalogItemPricing>[0];
}

function oneMonthPriceRial(
  providerMarkupBps: number,
  infrastructureSaleRialOverride: bigint | null,
) {
  const priced = resolveCatalogItemPricing(
    catalogItem(),
    { markupBasisPoints: providerMarkupBps },
    {
      productMarkupBasisPoints: 0,
      taxBasisPoints: TAX_BPS,
      parchinLevel: "PARCHIN_START",
      parchinPriceRial: PARCHIN_START_RIAL,
      termMonths: 1,
      minimumPostDiscountGrossMarginBps:
        curve.minimumPostDiscountGrossMarginBps,
      infrastructureSaleRialOverride,
    },
  );
  assert.ok(priced, "catalog item must price");
  return priced.finalPriceRial;
}

test("the profit curve, not the flat provider markup, sets the sale price", () => {
  const markup = resolveProviderMarkupForPlan({
    plan: { offerSource: "API_CATALOG", productKind: "READY_INSTANT_SERVER" },
    providerMonthlyCostRial: PROVIDER_MONTHLY_COST_RIAL,
    providerConfigMarkupBps: FLAT_PROVIDER_MARKUP_BPS,
    profitCurve: curve,
  });

  assert.equal(markup.source, "profit_curve");
  assert.notEqual(
    markup.providerMarkupBps,
    FLAT_PROVIDER_MARKUP_BPS,
    "test is meaningless if the curve and the flat markup agree",
  );

  const curvePrice = oneMonthPriceRial(
    markup.providerMarkupBps,
    markup.infrastructureSaleRialOverride,
  );
  const flatPrice = oneMonthPriceRial(FLAT_PROVIDER_MARKUP_BPS, null);

  // The exact failure the customer saw: the advertised amount was lower than
  // the amount the checkout locked.
  assert.ok(
    flatPrice < curvePrice,
    "flat markup must price below the curve, otherwise this regression cannot recur",
  );
});

test("storefront and quote resolve the price through the same four inputs", async () => {
  const [storefront, plans, store] = await Promise.all([
    readFile("lib/storefront/assortment-service.ts", "utf8"),
    readFile("lib/orders/plans.ts", "utf8"),
    readFile("lib/pricing/profit-curve-store.ts", "utf8"),
  ]);

  for (const [name, source] of [
    ["storefront", storefront],
    ["quote", plans],
  ] as const) {
    assert.match(
      source,
      /resolveProviderMarkupForPlan/,
      `${name} must resolve the provider markup from the profit curve`,
    );
    assert.match(
      source,
      /skuMarkupBasisPoints/,
      `${name} must honour the per-SKU markup override`,
    );
    assert.match(
      source,
      /minimumPostDiscountGrossMarginBps/,
      `${name} must apply the minimum post-discount margin`,
    );
    assert.match(
      source,
      /infrastructureSaleRialOverride/,
      `${name} must apply the transition-band sale override`,
    );
    assert.match(
      source,
      /loadProfitCurveConfiguration/,
      `${name} must read the curve through the shared store`,
    );
  }

  // The pre-fix call site handed the raw provider config in as the markup.
  assert.doesNotMatch(
    storefront,
    /resolveCatalogItemPricing\(\s*item,\s*providerPricing/,
    "storefront must not price from the flat provider config markup",
  );
});

test("the profit curve is read and mapped in exactly one place", async () => {
  const [storefront, plans, store] = await Promise.all([
    readFile("lib/storefront/assortment-service.ts", "utf8"),
    readFile("lib/orders/plans.ts", "utf8"),
    readFile("lib/pricing/profit-curve-store.ts", "utf8"),
  ]);

  assert.match(store, /profitCurveConfiguration\.findUnique/);
  for (const [name, source] of [
    ["storefront", storefront],
    ["quote", plans],
  ] as const) {
    assert.doesNotMatch(
      source,
      /profitCurveConfiguration\.findUnique/,
      `${name} must not load and map the curve itself — that duplication is what let the two prices drift`,
    );
  }
});
