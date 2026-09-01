import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
  return readFile(path, "utf8");
}

test("customer and guest delivery cannot publish catalog, pricing, or regions", async () => {
  const [delivery, route, sale, assortment] = await Promise.all([
    source("lib/recommendation/delivery-service.ts"),
    source("app/api/recommendations/sessions/[id]/delivery/route.ts"),
    source("lib/storefront/ensure-sale-plans.ts"),
    source("lib/storefront/assortment-service.ts"),
  ]);

  for (const file of [delivery, route]) {
    assert.doesNotMatch(file, /ensureStorefrontSaleReady/);
    assert.doesNotMatch(file, /ensurePublishedPlanForCatalogItem/);
    assert.doesNotMatch(file, /replaceStorefrontTierSlots/);
    assert.doesNotMatch(file, /providerPricingConfig\.(update|updateMany|upsert)/);
    assert.doesNotMatch(file, /productPricingConfig\.(update|updateMany|upsert)/);
    assert.doesNotMatch(file, /saleEnabled:\s*true/);
    assert.doesNotMatch(file, /publicationStatus:\s*InfrastructurePlanPublicationStatus\.PUBLISHED/);
  }

  assert.match(sale, /assertAdminActorTx/);
  assert.match(sale, /actorUserId/);
  assert.doesNotMatch(sale, /providerPricingConfig\.updateMany/);
  assert.doesNotMatch(sale, /productPricingConfig\.updateMany/);
  assert.doesNotMatch(sale, /saleEnabled:\s*true/);
  assert.doesNotMatch(sale, /\?\? 1n/);
  assert.doesNotMatch(sale, /take:\s*5000/);

  const replace = assortment.slice(
    assortment.indexOf("export async function replaceStorefrontTierSlots"),
  );
  assert.match(replace, /assertAdminActorTx/);
  assert.match(replace, /ensureStorefrontSaleReady\(\{ actorUserId: input\.actorUserId \}\)/);

  const listFn = assortment.slice(
    assortment.indexOf("export async function listPublicStorefrontTiers"),
    assortment.indexOf("function validateSlotBatch"),
  );
  assert.doesNotMatch(listFn, /ensureStorefrontSaleReady/);
  assert.doesNotMatch(listFn, /ensurePublishedPlanForCatalogItem/);
});
