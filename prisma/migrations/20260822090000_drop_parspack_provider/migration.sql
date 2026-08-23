-- Drop ParsPack from the platform.
--
-- AbrChin sells ArvanCloud only. This migration removes every ParsPack row and
-- then removes the value from both provider enums, so the database can no
-- longer represent a ParsPack resource at all.
--
-- Forward-only. Rows that merely *reference* a provider (orders, quotes,
-- incidents) keep their history with a NULL provider; rows that ARE ParsPack
-- infrastructure (catalog, plans, regions, pricing) are deleted.

-- 1. Detach history rows: keep the record, forget the provider.
UPDATE "ServiceOrder"          SET "provider" = NULL WHERE "provider" = 'PARSPACK';
UPDATE "RecommendationQuote"   SET "provider" = NULL WHERE "provider" = 'PARSPACK';
UPDATE "ServiceRenewalQuote"   SET "provider" = NULL WHERE "provider" = 'PARSPACK';
UPDATE "OperationalIncident"   SET "provider" = NULL WHERE "provider" = 'PARSPACK';

-- 2. Delete ParsPack infrastructure, children before parents.
DELETE FROM "ProviderCatalogAsset"          WHERE "provider" = 'PARSPACK';
DELETE FROM "ProviderCatalogRegionState"    WHERE "provider" = 'PARSPACK';
DELETE FROM "ProviderCatalogSyncRun"        WHERE "provider" = 'PARSPACK';
DELETE FROM "ProviderCatalogItem"           WHERE "provider" = 'PARSPACK';
DELETE FROM "ProviderCatalogState"          WHERE "provider" = 'PARSPACK';
DELETE FROM "PreprovisionedInventoryItem"   WHERE "provider" = 'PARSPACK';
DELETE FROM "BillingReconciliation"         WHERE "provider" = 'PARSPACK';
DELETE FROM "RateCardVersion"               WHERE "provider" = 'PARSPACK';
DELETE FROM "ResourceVersion"               WHERE "provider" = 'PARSPACK';
DELETE FROM "ProviderBillingContractVersion" WHERE "provider" = 'PARSPACK';
DELETE FROM "ProviderOperationLog"          WHERE "provider" = 'PARSPACK';
DELETE FROM "ProviderFundingConfirmation"   WHERE "provider" = 'PARSPACK';
DELETE FROM "CloudInstance"                 WHERE "provider" = 'PARSPACK';
DELETE FROM "InfrastructureOrder"           WHERE "provider" = 'PARSPACK';
DELETE FROM "InfrastructurePlan"            WHERE "provider" = 'PARSPACK';
DELETE FROM "ProviderRegionConfig"          WHERE "provider" = 'PARSPACK';
DELETE FROM "ProviderPricingConfig"         WHERE "provider" = 'PARSPACK';
DELETE FROM "ProductPricingConfig"          WHERE "provider" = 'PARSPACK';

-- 3. Delete the ParsPack service-connection health row.
DELETE FROM "ServiceConnectionCheck" WHERE "service" = 'PARSPACK';

-- 4. Recreate "InfrastructureProvider" without PARSPACK.
--    PostgreSQL cannot drop an enum value, so the type is rebuilt and every
--    column is re-pointed at it.
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

-- 5. Recreate "ServiceConnectionName" without PARSPACK.
ALTER TYPE "ServiceConnectionName" RENAME TO "ServiceConnectionName_old";
CREATE TYPE "ServiceConnectionName" AS ENUM ('ARVAN', 'KAVENEGAR', 'PAYMENT_GATEWAY');

ALTER TABLE "ServiceConnectionCheck" ALTER COLUMN "service" TYPE "ServiceConnectionName" USING ("service"::text::"ServiceConnectionName");

DROP TYPE "ServiceConnectionName_old";

-- 6. The pricing-config singleton id default moves off the ParsPack-era value.
ALTER TABLE "ProviderPricingConfig" ALTER COLUMN "id" SET DEFAULT 'arvan';
