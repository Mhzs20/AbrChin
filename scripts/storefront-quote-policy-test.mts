import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public storefront exposes only customer-safe sellable SKU fields", async () => {
  const [plans, cards] = await Promise.all([
    readFile("lib/orders/plans.ts", "utf8"),
    readFile("components/ready-cloud-catalog.tsx", "utf8"),
  ]);
  const publicOffer = plans.slice(
    plans.indexOf("export type PublicPlanOffer"),
    plans.indexOf("function withEffectivePricing"),
  );

  assert.match(publicOffer, /operatingSystemLabels/);
  assert.doesNotMatch(publicOffer, /catalogSource|providerBasePrice|markupBasisPoints/);
  assert.match(cards, /سیستم‌عامل‌های مجاز/);
  assert.doesNotMatch(cards, /catalogSource|providerBasePrice|basePrice|markup/i);
});

test("stale catalogs fail closed and customer requests never trigger a full sync", async () => {
  const [plans, quotes] = await Promise.all([
    readFile("lib/orders/plans.ts", "utf8"),
    readFile("lib/recommendation/quote-service.ts", "utf8"),
  ]);

  assert.doesNotMatch(plans, /requestCatalogSync/);
  assert.doesNotMatch(quotes, /requestCatalogSync/);
  assert.match(plans, /if \(!access\.visible\) return \[\]/);
  assert.match(plans, /const purchasable = access\.purchasable && capacityAvailable/);
  // The public offer list still gates on catalog freshness; the provider
  // ternary that produced an intermediate "freshness" variable is gone now
  // that Arvan is the only provider.
  assert.match(plans, /catalogFresh = apiCatalog/);
  assert.match(plans, /arvanResult\?\.fresh === true/);
  assert.match(quotes, /quote_revalidation_failed/);
});

test("quote checkout locks the customer amount and does not reprice on payment", async () => {
  const [checkout, payment, login, quoteService] = await Promise.all([
    readFile("lib/orders/service.ts", "utf8"),
    readFile("lib/orders/pay-order-tx.ts", "utf8"),
    readFile("components/login-form.tsx", "utf8"),
    readFile("lib/recommendation/quote-service.ts", "utf8"),
  ]);

  assert.match(quoteService, /RECOMMENDATION_QUOTE_VALIDITY_MS = 60 \* 60 \* 1000/);
  assert.match(checkout, /amount: quote\.amountRial/);
  assert.match(checkout, /rejectIfQuoteExpired/);
  assert.doesNotMatch(checkout, /samePriceSnapshot/);
  assert.doesNotMatch(checkout, /quote_price_changed/);
  assert.match(payment, /const amountRial = order\.amount/);
  assert.doesNotMatch(payment, /samePriceSnapshot/);
  assert.doesNotMatch(payment, /quote_price_changed/);
  assert.match(login, /sessions\/claim/);
  assert.match(login, /safeCustomerReturnPath/);
});

test("active quote reads require a mapped, published SKU", async () => {
  const quotes = await readFile("lib/recommendation/quote-service.ts", "utf8");
  const activeRead = quotes.slice(
    quotes.indexOf("export async function getActiveRecommendationQuote"),
    quotes.indexOf("export async function getActiveReadyServerQuote"),
  );

  assert.match(activeRead, /publicationStatus: "PUBLISHED"/);
  assert.match(activeRead, /catalogMappingStatus: "MAPPED"/);
});
