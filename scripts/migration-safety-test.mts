import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath =
  "prisma/migrations/20260729200000_parspack_catalog_pricing/migration.sql";
const multiProviderMigrationPath =
  "prisma/migrations/20260730160000_multi_provider_routing/migration.sql";

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

test("multi-provider migration preserves paid financial snapshots and adds regional identity", async () => {
  const migration = await readFile(multiProviderMigrationPath, "utf8");
  assert.match(migration, /ADD VALUE IF NOT EXISTS 'ARVAN'/);
  assert.match(migration, /CREATE TABLE "ProviderCatalogAsset"/);
  assert.match(migration, /CREATE TABLE "ProviderCatalogRegionState"/);
  assert.match(migration, /CREATE TABLE "ProviderCatalogSyncRun"/);
  assert.match(migration, /CREATE TABLE "ProductFlowTransition"/);
  assert.match(
    migration,
    /ProviderCatalogItem_provider_apiVersion_regionCode_externalPlanId_key/,
  );
  assert.match(migration, /ADD COLUMN "providerSelectionSnapshot" JSONB/);
  assert.match(migration, /ADD COLUMN "lineItemsSnapshot" JSONB/);
  assert.match(
    migration,
    /ALTER TABLE "ServiceSubscription"[\s\S]*ADD COLUMN "parchinLevel"/,
  );
  assert.doesNotMatch(migration, /\bDROP TABLE\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /DELETE FROM/i);
  assert.doesNotMatch(migration, /UPDATE "WalletLedgerEntry"/);
  const serviceOrderBackfill =
    migration.match(/UPDATE "ServiceOrder"[\s\S]*?;/)?.[0] ?? "";
  assert.doesNotMatch(serviceOrderBackfill, /"amount"/);
  assert.doesNotMatch(serviceOrderBackfill, /"status"/);
});
