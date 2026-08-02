import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("catalog sync keeps raw Provider offers separate from local SKU publication", async () => {
  const source = await readFile("lib/infrastructure/catalog-service.ts", "utf8");

  assert.doesNotMatch(source, /materializeReadyServerPlans/);
  assert.doesNotMatch(source, /infrastructurePlan\.upsert/);
  assert.match(source, /offerSource: "API_CATALOG"/);
});

test("catalog-based SKU creation is always an unpublished Admin draft", async () => {
  const source = await readFile(
    "app/api/admin/infrastructure/plans/route.ts",
    "utf8",
  );

  assert.match(source, /productKind: catalogItem\.productKind/);
  assert.match(source, /active: false/);
  assert.match(source, /publicationStatus: InfrastructurePlanPublicationStatus\.DRAFT/);
  assert.match(source, /موجودی دستی فقط از مسیر اختصاصی خود مدیریت می‌شود/);
});

test("only an explicit audited publication change can make a SKU sellable", async () => {
  const [route, pricing] = await Promise.all([
    readFile("app/api/admin/infrastructure/plans/[id]/route.ts", "utf8"),
    readFile("lib/orders/plans.ts", "utf8"),
  ]);

  assert.match(route, /requestedPublication/);
  assert.match(route, /InfrastructurePlanPublicationStatus\.PUBLISHED/);
  assert.match(route, /if \(requestedActive && !pricing\)/);
  assert.match(route, /publicationStatus: before\.publicationStatus/);
  assert.match(pricing, /plan\.skuMarkupBasisPoints \?\? product!\.markupBasisPoints/);
});

test("SKU markup migration is additive and avoids financial data", async () => {
  const migration = await readFile(
    "prisma/migrations/20260803113000_sku_markup_and_manual_publication/migration.sql",
    "utf8",
  );

  assert.match(migration, /ADD COLUMN IF NOT EXISTS "skuMarkupBasisPoints" INTEGER/);
  assert.match(migration, /UPDATE "InfrastructurePlan"/);
  assert.match(migration, /READY_PARSPACK_/);
  assert.doesNotMatch(migration, /Wallet|Ledger|Payment|DELETE|DROP/i);
});
