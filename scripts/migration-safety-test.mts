import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath =
  "prisma/migrations/20260729200000_parspack_catalog_pricing/migration.sql";
const multiProviderMigrationPath =
  "prisma/migrations/20260730160000_multi_provider_routing/migration.sql";
const adminCatalogMigrationPath =
  "prisma/migrations/20260801120000_admin_catalog_resilience/migration.sql";
const preprovisionedInventoryMigrationPath =
  "prisma/migrations/20260801210000_preprovisioned_inventory_safety/migration.sql";
const inventoryCredentialMigrationPath =
  "prisma/migrations/20260801230000_arvan_sale_inventory_credentials/migration.sql";
const finalLaunchMigrationPath =
  "prisma/migrations/20260801235900_final_launch_routing/migration.sql";

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

test("admin catalog resilience migration is forward-only and financially isolated", async () => {
  const migration = await readFile(adminCatalogMigrationPath, "utf8");
  assert.match(migration, /CREATE TABLE "ProviderRegionConfig"/);
  assert.match(migration, /CREATE TABLE "OperationalIncident"/);
  assert.match(migration, /CREATE TABLE "OperationalAlertOutbox"/);
  assert.match(migration, /ADD COLUMN "publicationStatus"/);
  assert.match(migration, /ADD COLUMN "source"/);
  assert.doesNotMatch(migration, /\bDROP\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /UPDATE "ServiceOrder"/);
  assert.doesNotMatch(migration, /UPDATE "InfrastructureOrder"/);
  assert.doesNotMatch(migration, /UPDATE "Wallet"/);
  assert.doesNotMatch(migration, /UPDATE "WalletLedgerEntry"/);
  assert.doesNotMatch(migration, /UPDATE "Payment/);
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
  assert.match(
    migration,
    /'legacy-parspack-ready', 'PARSPACK', 'v1', 'READY_INSTANT_SERVER',\s*0,\s*"enabled"/,
    "legacy provider markup must not be copied into product markup",
  );
});

test("preprovisioned inventory migration is additive and commerce-immutable", async () => {
  const migration = await readFile(
    preprovisionedInventoryMigrationPath,
    "utf8",
  );
  assert.match(migration, /CREATE TABLE "PreprovisionedInventoryItem"/);
  assert.match(
    migration,
    /provider_apiVersion_providerResourceId_key/,
  );
  assert.match(migration, /ADD COLUMN "preprovisionedInventoryItemId"/);
  assert.doesNotMatch(migration, /RENAME VALUE/);
  assert.match(migration, /CREATE TYPE "InfrastructureOfferSource"/);
  assert.doesNotMatch(migration, /\bDROP TABLE\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /DELETE FROM/i);
  assert.doesNotMatch(migration, /UPDATE "ServiceOrder"/);
  assert.doesNotMatch(migration, /UPDATE "RecommendationQuote"/);
  assert.doesNotMatch(migration, /UPDATE "InfrastructureOrder"/);
  assert.doesNotMatch(migration, /UPDATE "Wallet"/);
  assert.doesNotMatch(migration, /UPDATE "WalletLedgerEntry"/);
  assert.doesNotMatch(migration, /UPDATE "Payment/);
});

test("inventory credential migration is additive and commerce-immutable", async () => {
  const migration = await readFile(inventoryCredentialMigrationPath, "utf8");
  assert.match(
    migration,
    /CREATE TABLE "PreprovisionedInventoryCredential"/,
  );
  assert.match(migration, /secretFingerprint_key/);
  assert.match(migration, /'READY', 'TRANSFERRED', 'REVOKED'/);
  assert.doesNotMatch(migration, /\bDROP TABLE\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /DELETE FROM/i);
  assert.doesNotMatch(migration, /UPDATE "ServiceOrder"/);
  assert.doesNotMatch(migration, /UPDATE "RecommendationQuote"/);
  assert.doesNotMatch(migration, /UPDATE "InfrastructureOrder"/);
  assert.doesNotMatch(migration, /UPDATE "Wallet"/);
  assert.doesNotMatch(migration, /UPDATE "WalletLedgerEntry"/);
  assert.doesNotMatch(migration, /UPDATE "Payment/);
});

test("final launch migration is additive and preserves all financial rows", async () => {
  const migration = await readFile(finalLaunchMigrationPath, "utf8");
  assert.match(migration, /ADD VALUE IF NOT EXISTS 'MANUAL_ADMIN'/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "purchaseOrderId" TEXT/);
  assert.match(migration, /WalletTopUp_purchaseOrderId_fkey/);
  assert.match(migration, /'ARVAN',[\s\S]*'READY_INSTANT_SERVER',[\s\S]*0/);
  assert.doesNotMatch(migration, /\bDROP\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /DELETE FROM/i);
  assert.doesNotMatch(migration, /UPDATE "ServiceOrder"/);
  assert.doesNotMatch(migration, /UPDATE "RecommendationQuote"/);
  assert.doesNotMatch(migration, /UPDATE "InfrastructureOrder"/);
  assert.doesNotMatch(migration, /UPDATE "Wallet"/);
  assert.doesNotMatch(migration, /UPDATE "WalletLedgerEntry"/);
  assert.doesNotMatch(migration, /UPDATE "Payment/);
});
