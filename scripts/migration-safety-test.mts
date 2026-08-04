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
const providerBillingContractMigrationPath =
  "prisma/migrations/20260803190000_provider_billing_contract_gate/migration.sql";
const billingRuntimeSafetyMigrationPath =
  "prisma/migrations/20260803200000_billing_runtime_safety/migration.sql";
const launchParchinLifecycleMigrationPath =
  "prisma/migrations/20260804180000_launch_parchin_lifecycle/migration.sql";
const launchTermCouponsMigrationPath =
  "prisma/migrations/20260804190000_launch_term_coupons_lifecycle/migration.sql";

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

test("billing runtime safety migrations are additive and non-retroactive", async () => {
  const [providerContract, runtimeSafety] = await Promise.all([
    readFile(providerBillingContractMigrationPath, "utf8"),
    readFile(billingRuntimeSafetyMigrationPath, "utf8"),
  ]);
  assert.match(providerContract, /CREATE TABLE "ProviderBillingContractVersion"/);
  assert.match(providerContract, /route_version_key/);
  assert.match(runtimeSafety, /ADD VALUE IF NOT EXISTS 'REVOKED'/);
  assert.match(runtimeSafety, /ADD VALUE IF NOT EXISTS 'INVALID'/);
  assert.match(
    runtimeSafety,
    /ADD COLUMN "providerBillingContractSnapshot" JSONB/,
  );
  for (const migration of [providerContract, runtimeSafety]) {
    assert.doesNotMatch(migration, /\bDROP\b/i);
    assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
    assert.doesNotMatch(migration, /DELETE FROM/i);
    assert.doesNotMatch(migration, /UPDATE "ServiceOrder"/);
    assert.doesNotMatch(migration, /UPDATE "Wallet"/);
    assert.doesNotMatch(migration, /UPDATE "WalletLedgerEntry"/);
  }
});

test("launch parchin lifecycle migration is additive and keeps financial history", async () => {
  const migration = await readFile(launchParchinLifecycleMigrationPath, "utf8");
  assert.match(migration, /ADD COLUMN "reminderDaysBeforeDue"/);
  assert.match(migration, /ADD COLUMN "suspendGraceDaysAfterZero"/);
  assert.match(migration, /ADD COLUMN "deleteDaysAfterSuspend"/);
  assert.match(migration, /"taxBps" = 1000/);
  assert.match(migration, /"priceRial" = 5000000/);
  assert.match(migration, /"priceRial" = 15000000/);
  assert.match(migration, /"priceRial" = 50000000/);
  assert.doesNotMatch(migration, /\bDROP\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /DELETE FROM/i);
  assert.doesNotMatch(migration, /UPDATE "ServiceOrder"/);
  assert.doesNotMatch(migration, /UPDATE "Wallet"/);
  assert.doesNotMatch(migration, /UPDATE "WalletLedgerEntry"/);
  assert.doesNotMatch(migration, /UPDATE "Payment/);
});

test("launch term coupons lifecycle migration is additive", async () => {
  const migration = await readFile(launchTermCouponsMigrationPath, "utf8");
  assert.match(migration, /ADD VALUE IF NOT EXISTS 'TOP_UP_BONUS'/);
  assert.match(migration, /ADD VALUE IF NOT EXISTS 'TERM_DISCOUNT'/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "Coupon"/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "termMonths"/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "lastReminderSentAt"/);
  assert.doesNotMatch(migration, /\bDROP TABLE\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /DELETE FROM/i);
  assert.doesNotMatch(migration, /UPDATE "WalletLedgerEntry"/);
});

test("compass service prices migration is additive", async () => {
  const migration = await readFile(
    new URL(
      "../prisma/migrations/20260804200000_compass_service_prices/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "compassServicePrices"/);
  assert.doesNotMatch(migration, /\bDROP\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /DELETE FROM/i);
});
