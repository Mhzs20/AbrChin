import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

/** Historical migrations are addressed by their immutable timestamp prefix. */
async function migrationSqlByTimestamp(timestamp: string) {
  const entries = await readdir("prisma/migrations");
  const directory = entries.find((entry) => entry.startsWith(`${timestamp}_`));
  assert.ok(directory, `migration ${timestamp} must exist`);
  return readFile(`prisma/migrations/${directory}/migration.sql`, "utf8");
}

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
  const migration = await migrationSqlByTimestamp("20260729200000");
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

test("provider region discovery migration only extends the source enum", async () => {
  const migration = await readFile(
    "prisma/migrations/20260806140000_provider_region_discovery/migration.sql",
    "utf8",
  );
  assert.match(
    migration,
    /ALTER TYPE "ProviderRegionConfigSource" ADD VALUE IF NOT EXISTS 'PROVIDER_DISCOVERY'/,
  );
  assert.doesNotMatch(migration, /\bDROP\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /DELETE FROM/i);
  assert.doesNotMatch(migration, /UPDATE "ProviderRegionConfig"/);
});

test("user account status migration is additive", async () => {
  const migration = await readFile(
    "prisma/migrations/20260806150000_user_account_status/migration.sql",
    "utf8",
  );
  assert.match(migration, /CREATE TYPE "UserAccountStatus"/);
  assert.match(migration, /ADD COLUMN "accountStatus"/);
  assert.match(migration, /ADD COLUMN "blockedAt"/);
  assert.match(migration, /ADD COLUMN "blockedReason"/);
  assert.doesNotMatch(migration, /\bDROP\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /DELETE FROM "User"/);
});

test("storefront dominance and parchin v3 migration is additive", async () => {
  const migration = await readFile(
    "prisma/migrations/20260806210000_storefront_dominance_parchin_v3/migration.sql",
    "utf8",
  );
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "parchinServiceSnapshot"/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "includedServices"/);
  assert.match(migration, /ostovarMinDiskGb" SET DEFAULT 0/);
  assert.doesNotMatch(migration, /\bDROP TABLE\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /DELETE FROM/i);
});

test("commercial pricing v3 migration is additive and preserves financial history", async () => {
  const migration = await readFile(
    "prisma/migrations/20260806200000_commercial_pricing_v3/migration.sql",
    "utf8",
  );
  assert.match(migration, /CREATE TABLE "FinanceConfigurationRevision"/);
  assert.match(migration, /markupBasisPoints" SET DEFAULT 4286/);
  assert.match(
    migration,
    /UPDATE "ProviderPricingConfig"[\s\S]*SET "markupBasisPoints" = 4286[\s\S]*WHERE "markupBasisPoints" = 23333/,
  );
  assert.doesNotMatch(migration, /\bDROP TABLE\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /DELETE FROM/i);
  assert.doesNotMatch(migration, /UPDATE "ServiceOrder"/);
  assert.doesNotMatch(migration, /UPDATE "RecommendationQuote"/);
  assert.doesNotMatch(migration, /UPDATE "Wallet"/);
  assert.doesNotMatch(migration, /UPDATE "WalletLedgerEntry"/);
  assert.doesNotMatch(migration, /UPDATE "Payment/);
});

test("profit curve operational accounting migration is additive", async () => {
  const migration = await readFile(
    "prisma/migrations/20260807010000_profit_curve_operational_accounting/migration.sql",
    "utf8",
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "AccountingJournalEntry"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "AccountingJournalLine"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "OperatingExpense"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "ProfitCurveConfiguration"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "ProfitCurveBand"/);
  assert.match(migration, /minimumPostDiscountGrossMarginBps/);
  assert.match(migration, /commercialEconomicsSnapshot/);
  assert.match(migration, /NEEDS_RECONCILIATION/);
  assert.match(migration, /pcband_0_50m/);
  assert.match(migration, /pcband_250m_plus/);
  assert.match(migration, /targetGrossMarginBps.*7000|7000/);
  assert.doesNotMatch(migration, /\bDROP TABLE\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /DELETE FROM/i);
  assert.doesNotMatch(migration, /UPDATE "ServiceOrder"/);
  assert.doesNotMatch(migration, /UPDATE "WalletLedgerEntry"/);
  assert.doesNotMatch(migration, /UPDATE "Payment/);
});

test("operating expense draft idempotency migration is additive", async () => {
  const migration = await readFile(
    "prisma/migrations/20260807020000_operating_expense_draft_idempotency/migration.sql",
    "utf8",
  );
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "idempotencyKey"/);
  assert.match(migration, /OperatingExpense_idempotencyKey_key/);
  assert.doesNotMatch(migration, /\bDROP TABLE\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /DELETE FROM/i);
  assert.doesNotMatch(migration, /UPDATE "OperatingExpense"/);
  assert.doesNotMatch(migration, /UPDATE "AccountingJournalEntry"/);
});

test("rate limit bucket migration is additive and PAYG repair is forward-only", async () => {
  const migration = await readFile(
    "prisma/migrations/20260807130000_rate_limit_bucket_and_payg_repair/migration.sql",
    "utf8",
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "RateLimitBucket"/);
  assert.match(migration, /UPDATE "InfrastructurePlan"/);
  assert.match(migration, /PREPAID_TERM/);
  assert.doesNotMatch(migration, /\bDROP TABLE\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /DELETE FROM/i);
  assert.doesNotMatch(migration, /UPDATE "ServiceOrder"/);
  assert.doesNotMatch(migration, /UPDATE "WalletLedgerEntry"/);
  assert.doesNotMatch(migration, /UPDATE "RecommendationQuote"/);
});

test("support request migration is additive", async () => {
  const migration = await readFile(
    "prisma/migrations/20260807140000_support_requests/migration.sql",
    "utf8",
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "SupportRequest"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "SupportRequestMessage"/);
  assert.doesNotMatch(migration, /\bDROP TABLE\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /DELETE FROM/i);
  assert.doesNotMatch(migration, /UPDATE "ServiceOrder"/);
});

test("customer identity email verification migration is additive and backfills existing users", async () => {
  const migration = await readFile(
    "prisma/migrations/20260807150000_customer_identity_email_verification/migration.sql",
    "utf8",
  );
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "firstName"/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "lastName"/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "email"/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "emailVerifiedAt"/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "registrationCompletedAt"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "EmailVerificationChallenge"/);
  assert.match(
    migration,
    /SET "registrationCompletedAt" = COALESCE\("registrationCompletedAt", "createdAt"\)/,
  );
  assert.doesNotMatch(migration, /\bDROP TABLE\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /DELETE FROM/i);
  assert.doesNotMatch(migration, /UPDATE "ServiceOrder"/);
  assert.doesNotMatch(migration, /UPDATE "WalletLedgerEntry"/);
});
