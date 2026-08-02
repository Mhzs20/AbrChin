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
  assert.match(plans, /if \(!purchasable\) return \[\]/);
  assert.match(plans, /\.filter\(\(\) => freshness\.fresh\)/);
  assert.match(quotes, /quote_revalidation_failed/);
});

test("quote checkout keeps the SKU markup snapshot and guest continuation", async () => {
  const [checkout, payment, login] = await Promise.all([
    readFile("lib/orders/service.ts", "utf8"),
    readFile("lib/orders/pay-order-tx.ts", "utf8"),
    readFile("components/login-form.tsx", "utf8"),
  ]);

  assert.match(checkout, /quote\.plan\.skuMarkupBasisPoints \?\? productPricing!\.markupBasisPoints/);
  assert.match(payment, /plan\.skuMarkupBasisPoints \?\? productPricing!\.markupBasisPoints/);
  assert.match(login, /sessions\/claim/);
  assert.match(login, /requestedNext\?\.startsWith\("\/"\)/);
  assert.match(login, /!requestedNext\.startsWith\("\/\/"\)/);
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
