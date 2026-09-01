import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { rankProviderOffers } from "../lib/recommendation/provider-ranking.ts";
import type { ProviderOffer, ResourceProfile } from "../lib/recommendation/types.ts";
import {
  isVerifiedSellablePricing,
  PricingUnavailableError,
  requireVerifiedSellablePricing,
  type EffectivePlanPricing,
} from "../lib/pricing/plan-pricing.ts";

function priced(overrides: Partial<EffectivePlanPricing> = {}): EffectivePlanPricing {
  return {
    catalogItemId: "item",
    providerBasePriceRial: 8_000_000n,
    markupBasisPoints: 2500,
    providerMarkupBasisPoints: 2500,
    productMarkupBasisPoints: 0,
    markupAmountRial: 2_000_000n,
    parchinLevel: "PARCHIN_START",
    parchinPriceRial: 0n,
    taxBasisPoints: 1000,
    taxAmountRial: 1_000_000n,
    termMonths: 1,
    termDiscountBps: 0,
    lineItems: [],
    finalPriceRial: 11_000_000n,
    renewalPriceRial: 11_000_000n,
    currency: "IRR",
    providerPriceCheckedAt: new Date("2026-08-01T00:00:00.000Z"),
    vcpu: 2,
    ramGb: 4,
    storageGb: 50,
    available: true,
    ...overrides,
  };
}

test("missing and placeholder sellable prices fail closed", () => {
  assert.equal(isVerifiedSellablePricing(null), false);
  assert.equal(isVerifiedSellablePricing(priced({ finalPriceRial: 0n })), false);
  assert.equal(isVerifiedSellablePricing(priced({ finalPriceRial: 1n })), false);
  assert.equal(isVerifiedSellablePricing(priced({ renewalPriceRial: 1n })), false);
  assert.equal(isVerifiedSellablePricing(priced({ providerBasePriceRial: 1n })), false);
  const valid = priced();
  assert.equal(isVerifiedSellablePricing(valid), true);
  assert.equal(requireVerifiedSellablePricing(valid), valid);
  assert.throws(
    () => requireVerifiedSellablePricing(null),
    (error: unknown) =>
      error instanceof PricingUnavailableError && error.code === "pricing_unavailable",
  );
  assert.throws(() => requireVerifiedSellablePricing(priced({ finalPriceRial: 1n })));
});

test("sale, publish, and quote paths do not fall back to 1-rial placeholders", async () => {
  const [sale, plans, adminCreate, adminPatch, ranking] = await Promise.all([
    readFile("lib/storefront/ensure-sale-plans.ts", "utf8"),
    readFile("lib/orders/plans.ts", "utf8"),
    readFile("app/api/admin/infrastructure/plans/route.ts", "utf8"),
    readFile("app/api/admin/infrastructure/plans/[id]/route.ts", "utf8"),
    readFile("lib/recommendation/provider-ranking.ts", "utf8"),
  ]);
  for (const source of [sale, plans, adminCreate, adminPatch]) {
    assert.doesNotMatch(source, /\?\? 1n/);
    assert.doesNotMatch(source, /salePriceRial:\s*1n/);
  }
  assert.match(sale, /requireVerifiedSellablePricing/);
  assert.match(plans, /isVerifiedSellablePricing/);
  assert.match(adminCreate, /requireVerifiedSellablePricing/);
  assert.match(adminPatch, /requireVerifiedSellablePricing/);
  assert.match(ranking, /salePriceRial <= 1/);
});

test("recommendation ranking rejects 1-rial placeholder offers", () => {
  const now = new Date("2026-08-01T00:00:00.000Z");
  const profile: ResourceProfile = {
    vcpu: 2,
    ramGb: 4,
    storageGb: 40,
    regionPreference: "IRAN",
    deliveryMode: "MANAGED",
    backupPolicy: "NONE",
    needsResize: false,
  };
  const offer = (salePriceRial: number): ProviderOffer => ({
    id: `p-${salePriceRial}`,
    planId: `plan-${salePriceRial}`,
    provider: "ARVAN",
    providerLabel: "ARVAN",
    regionCode: "ir-thr-1",
    countryCode: "IR",
    deliveryModes: ["MANAGED"],
    vcpu: 2,
    ramGb: 4,
    storageGb: 40,
    salePriceRial,
    available: true,
    supportsBackup: true,
    supportsResize: true,
    reliabilityScore: 85,
    capturedAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
  });
  const result = rankProviderOffers(profile, [offer(1), offer(2_000_000)], now);
  assert.deepEqual(
    result.rejected.map((item) => [item.offer.id, item.reason]),
    [["p-1", "invalid_price"]],
  );
  assert.deepEqual(result.ranked.map((item) => item.id), ["p-2000000"]);
});
