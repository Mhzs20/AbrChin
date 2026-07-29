import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath =
  "prisma/migrations/20260729200000_parspack_catalog_pricing/migration.sql";

test("catalog pricing migration is additive and preserves financial history", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /CREATE TABLE "ProviderCatalogItem"/);
  assert.match(migration, /CREATE TABLE "ProviderPricingConfig"/);
  assert.match(migration, /CREATE TABLE "ServiceRenewalQuote"/);
  assert.match(migration, /ADD COLUMN "catalogItemId" TEXT/);
  assert.match(migration, /ADD COLUMN "providerBasePriceRialSnapshot" BIGINT/);
  assert.doesNotMatch(migration, /\bDROP\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /DELETE FROM/i);
  assert.doesNotMatch(migration, /UPDATE "ServiceOrder"/);
  assert.doesNotMatch(migration, /UPDATE "WalletLedgerEntry"/);
  assert.match(
    migration,
    /UPDATE "ServiceSubscription" SET "autoRenew" = false/,
  );
});
