-- Drop ParsPack from the platform.
--
-- AbrChin sells ArvanCloud only. This migration removes every ParsPack row and
-- then removes the value from both provider enums, so the database can no
-- longer represent a ParsPack resource at all.
--
-- Forward-only. Rows that merely *reference* a provider (orders, quotes,
-- incidents) keep their history with a NULL provider; rows that ARE ParsPack
-- infrastructure (catalog, plans, regions, pricing) are deleted.
--
-- Most foreign keys into InfrastructurePlan / ProviderCatalogItem are
-- onDelete: Restrict, so every dependent is detached or deleted first, in
-- child-before-parent order.

-- ---------------------------------------------------------------------------
-- 1. History rows keep the record, forget the provider.
-- ---------------------------------------------------------------------------
UPDATE "ServiceOrder"        SET "provider" = NULL WHERE "provider" = 'PARSPACK';
UPDATE "RecommendationQuote" SET "provider" = NULL WHERE "provider" = 'PARSPACK';
UPDATE "ServiceRenewalQuote" SET "provider" = NULL WHERE "provider" = 'PARSPACK';
UPDATE "OperationalIncident" SET "provider" = NULL WHERE "provider" = 'PARSPACK';

-- ---------------------------------------------------------------------------
-- 2. Break every OPTIONAL Restrict link into ParsPack plans / catalog items.
--    (ServiceOrder.planId is onDelete: SetNull, but doing it explicitly keeps
--    the intent visible and the statement is a no-op when already null.)
-- ---------------------------------------------------------------------------
UPDATE "BillingPolicyVersion" SET "planId" = NULL
  WHERE "planId" IN (SELECT "id" FROM "InfrastructurePlan" WHERE "provider" = 'PARSPACK');

UPDATE "RateCardVersion" SET "planId" = NULL
  WHERE "planId" IN (SELECT "id" FROM "InfrastructurePlan" WHERE "provider" = 'PARSPACK');

UPDATE "ServiceOrder" SET "planId" = NULL
  WHERE "planId" IN (SELECT "id" FROM "InfrastructurePlan" WHERE "provider" = 'PARSPACK');

UPDATE "RecommendationQuote" SET "catalogItemId" = NULL
  WHERE "catalogItemId" IN (SELECT "id" FROM "ProviderCatalogItem" WHERE "provider" = 'PARSPACK');

-- An Arvan plan must never be left pointing at a ParsPack catalog row.
UPDATE "InfrastructurePlan" SET "catalogItemId" = NULL
  WHERE "provider" <> 'PARSPACK'
    AND "catalogItemId" IN (SELECT "id" FROM "ProviderCatalogItem" WHERE "provider" = 'PARSPACK');

UPDATE "ServiceBillingPolicySnapshot" SET "activationRequestId" = NULL
  WHERE "activationRequestId" IN (
    SELECT "id" FROM "ActivationRequest"
    WHERE "planId" IN (SELECT "id" FROM "InfrastructurePlan" WHERE "provider" = 'PARSPACK')
  );

-- ---------------------------------------------------------------------------
-- 3. Delete every REQUIRED-FK dependent, deepest child first.
-- ---------------------------------------------------------------------------
DELETE FROM "ServiceRenewalQuote"
  WHERE "catalogItemId" IN (SELECT "id" FROM "ProviderCatalogItem" WHERE "provider" = 'PARSPACK')
     OR "subscriptionId" IN (
       SELECT "id" FROM "ServiceSubscription"
       WHERE "planId" IN (SELECT "id" FROM "InfrastructurePlan" WHERE "provider" = 'PARSPACK')
     );

DELETE FROM "StorefrontAssortmentSlot"
  WHERE "catalogItemId" IN (SELECT "id" FROM "ProviderCatalogItem" WHERE "provider" = 'PARSPACK');

DELETE FROM "PreprovisionedInventoryItem"
  WHERE "provider" = 'PARSPACK'
     OR "planId" IN (SELECT "id" FROM "InfrastructurePlan" WHERE "provider" = 'PARSPACK')
     OR "catalogItemId" IN (SELECT "id" FROM "ProviderCatalogItem" WHERE "provider" = 'PARSPACK');

DELETE FROM "ResourceChangeRequest"
  WHERE "planId" IN (SELECT "id" FROM "InfrastructurePlan" WHERE "provider" = 'PARSPACK');

DELETE FROM "ResourceVersion"
  WHERE "provider" = 'PARSPACK'
     OR "planId" IN (SELECT "id" FROM "InfrastructurePlan" WHERE "provider" = 'PARSPACK');

DELETE FROM "ActivationRequest"
  WHERE "planId" IN (SELECT "id" FROM "InfrastructurePlan" WHERE "provider" = 'PARSPACK');

DELETE FROM "ServiceSubscription"
  WHERE "planId" IN (SELECT "id" FROM "InfrastructurePlan" WHERE "provider" = 'PARSPACK');

DELETE FROM "RecommendationQuote"
  WHERE "planId" IN (SELECT "id" FROM "InfrastructurePlan" WHERE "provider" = 'PARSPACK');

-- ---------------------------------------------------------------------------
-- 4. Delete the ParsPack infrastructure itself, children before parents.
-- ---------------------------------------------------------------------------
DELETE FROM "ProviderCatalogAsset"           WHERE "provider" = 'PARSPACK';
DELETE FROM "ProviderCatalogRegionState"     WHERE "provider" = 'PARSPACK';
DELETE FROM "ProviderCatalogSyncRun"         WHERE "provider" = 'PARSPACK';
DELETE FROM "ProviderCatalogState"           WHERE "provider" = 'PARSPACK';
DELETE FROM "BillingReconciliation"          WHERE "provider" = 'PARSPACK';
DELETE FROM "RateCardVersion"                WHERE "provider" = 'PARSPACK';
DELETE FROM "ProviderBillingContractVersion" WHERE "provider" = 'PARSPACK';
DELETE FROM "ProviderOperationLog"           WHERE "provider" = 'PARSPACK';
DELETE FROM "ProviderFundingConfirmation"    WHERE "provider" = 'PARSPACK';
DELETE FROM "CloudInstance"                  WHERE "provider" = 'PARSPACK';
DELETE FROM "InfrastructureOrder"            WHERE "provider" = 'PARSPACK';
DELETE FROM "InfrastructurePlan"             WHERE "provider" = 'PARSPACK';
DELETE FROM "ProviderCatalogItem"            WHERE "provider" = 'PARSPACK';
DELETE FROM "ProviderRegionConfig"           WHERE "provider" = 'PARSPACK';
DELETE FROM "ProviderPricingConfig"          WHERE "provider" = 'PARSPACK';
DELETE FROM "ProductPricingConfig"           WHERE "provider" = 'PARSPACK';
DELETE FROM "ServiceConnectionCheck"         WHERE "service"  = 'PARSPACK';

-- ---------------------------------------------------------------------------
-- 5. Recreate "InfrastructureProvider" without PARSPACK.
--    PostgreSQL cannot drop an enum value, so the type is rebuilt and every
--    column is re-pointed at it.
-- ---------------------------------------------------------------------------
ALTER TYPE "InfrastructureProvider" RENAME TO "InfrastructureProvider_old";
CREATE TYPE "InfrastructureProvider" AS ENUM ('ARVAN');

ALTER TABLE "ServiceOrder"                   ALTER COLUMN "provider" TYPE "InfrastructureProvider" USING ("provider"::text::"InfrastructureProvider");
ALTER TABLE "RecommendationQuote"            ALTER COLUMN "provider" TYPE "InfrastructureProvider" USING ("provider"::text::"InfrastructureProvider");
ALTER TABLE "InfrastructurePlan"             ALTER COLUMN "provider" TYPE "InfrastructureProvider" USING ("provider"::text::"InfrastructureProvider");
ALTER TABLE "InfrastructureOrder"            ALTER COLUMN "provider" TYPE "InfrastructureProvider" USING ("provider"::text::"InfrastructureProvider");
ALTER TABLE "ProviderFundingConfirmation"    ALTER COLUMN "provider" TYPE "InfrastructureProvider" USING ("provider"::text::"InfrastructureProvider");
ALTER TABLE "CloudInstance"                  ALTER COLUMN "provider" TYPE "InfrastructureProvider" USING ("provider"::text::"InfrastructureProvider");
ALTER TABLE "ServiceRenewalQuote"            ALTER COLUMN "provider" TYPE "InfrastructureProvider" USING ("provider"::text::"InfrastructureProvider");
ALTER TABLE "ProviderOperationLog"           ALTER COLUMN "provider" TYPE "InfrastructureProvider" USING ("provider"::text::"InfrastructureProvider");
ALTER TABLE "ProviderCatalogState"           ALTER COLUMN "provider" TYPE "InfrastructureProvider" USING ("provider"::text::"InfrastructureProvider");
ALTER TABLE "ProviderBillingContractVersion" ALTER COLUMN "provider" TYPE "InfrastructureProvider" USING ("provider"::text::"InfrastructureProvider");
ALTER TABLE "ResourceVersion"                ALTER COLUMN "provider" TYPE "InfrastructureProvider" USING ("provider"::text::"InfrastructureProvider");
ALTER TABLE "RateCardVersion"                ALTER COLUMN "provider" TYPE "InfrastructureProvider" USING ("provider"::text::"InfrastructureProvider");
ALTER TABLE "BillingReconciliation"          ALTER COLUMN "provider" TYPE "InfrastructureProvider" USING ("provider"::text::"InfrastructureProvider");
ALTER TABLE "ProviderCatalogItem"            ALTER COLUMN "provider" TYPE "InfrastructureProvider" USING ("provider"::text::"InfrastructureProvider");
ALTER TABLE "PreprovisionedInventoryItem"    ALTER COLUMN "provider" TYPE "InfrastructureProvider" USING ("provider"::text::"InfrastructureProvider");
ALTER TABLE "ProviderRegionConfig"           ALTER COLUMN "provider" TYPE "InfrastructureProvider" USING ("provider"::text::"InfrastructureProvider");
ALTER TABLE "ProviderPricingConfig"          ALTER COLUMN "provider" TYPE "InfrastructureProvider" USING ("provider"::text::"InfrastructureProvider");
ALTER TABLE "ProductPricingConfig"           ALTER COLUMN "provider" TYPE "InfrastructureProvider" USING ("provider"::text::"InfrastructureProvider");
ALTER TABLE "ProviderCatalogAsset"           ALTER COLUMN "provider" TYPE "InfrastructureProvider" USING ("provider"::text::"InfrastructureProvider");
ALTER TABLE "ProviderCatalogRegionState"     ALTER COLUMN "provider" TYPE "InfrastructureProvider" USING ("provider"::text::"InfrastructureProvider");
ALTER TABLE "ProviderCatalogSyncRun"         ALTER COLUMN "provider" TYPE "InfrastructureProvider" USING ("provider"::text::"InfrastructureProvider");
ALTER TABLE "OperationalIncident"            ALTER COLUMN "provider" TYPE "InfrastructureProvider" USING ("provider"::text::"InfrastructureProvider");

DROP TYPE "InfrastructureProvider_old";

-- ---------------------------------------------------------------------------
-- 6. Recreate "ServiceConnectionName" without PARSPACK.
-- ---------------------------------------------------------------------------
ALTER TYPE "ServiceConnectionName" RENAME TO "ServiceConnectionName_old";
CREATE TYPE "ServiceConnectionName" AS ENUM ('ARVAN', 'KAVENEGAR', 'PAYMENT_GATEWAY');

ALTER TABLE "ServiceConnectionCheck" ALTER COLUMN "service" TYPE "ServiceConnectionName" USING ("service"::text::"ServiceConnectionName");

DROP TYPE "ServiceConnectionName_old";

-- ---------------------------------------------------------------------------
-- 7. The pricing-config singleton id default moves off the ParsPack-era value.
-- ---------------------------------------------------------------------------
ALTER TABLE "ProviderPricingConfig" ALTER COLUMN "id" SET DEFAULT 'arvan';
