-- Provider-neutral catalog, pricing, quote and orchestration metadata.
-- This migration is forward-only and additive. Legacy prices and paid-order
-- snapshots remain untouched and continue to be readable during rollback.

ALTER TYPE "InfrastructureProvider" ADD VALUE IF NOT EXISTS 'ARVAN';

CREATE TYPE "InfrastructureProductKind" AS ENUM (
    'READY_INSTANT_SERVER',
    'CLOUD_SERVER'
);
CREATE TYPE "ProviderCatalogStatus" AS ENUM (
    'ACTIVE',
    'STALE',
    'UNAVAILABLE',
    'INVALID_PRICE',
    'DISABLED'
);
CREATE TYPE "ProviderCatalogAssetKind" AS ENUM (
    'IMAGE',
    'NETWORK',
    'SECURITY'
);
CREATE TYPE "ProviderSyncStatus" AS ENUM (
    'RUNNING',
    'SUCCEEDED',
    'PARTIAL',
    'FAILED'
);
CREATE TYPE "ParchinLevel" AS ENUM (
    'PARCHIN_START',
    'PARCHIN_ACTIVE',
    'PARCHIN_STABLE'
);
CREATE TYPE "QuoteLineItemType" AS ENUM (
    'PROVIDER_INFRASTRUCTURE',
    'INFRASTRUCTURE_MARKUP',
    'PARCHIN',
    'PROVIDER_ADDON',
    'TAX'
);

ALTER TABLE "ProviderCatalogItem"
    ADD COLUMN "apiVersion" TEXT NOT NULL DEFAULT 'v1',
    ADD COLUMN "productKind" "InfrastructureProductKind" NOT NULL DEFAULT 'READY_INSTANT_SERVER',
    ADD COLUMN "externalPlanId" TEXT,
    ADD COLUMN "externalKey" TEXT,
    ADD COLUMN "status" "ProviderCatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN "providerHourlyPriceIrr" BIGINT,
    ADD COLUMN "providerMonthlyPriceIrr" BIGINT,
    ADD COLUMN "lastSeenAt" TIMESTAMP(3),
    ADD COLUMN "rawPayload" JSONB,
    ADD COLUMN "payloadHash" TEXT,
    ADD COLUMN "catalogVersion" TEXT;

UPDATE "ProviderCatalogItem"
SET
    "externalPlanId" = "sizeCode",
    "externalKey" = lower("provider"::text) || ':v1:' || "regionCode" || ':' || "sizeCode",
    "lastSeenAt" = "lastSyncedAt",
    "status" = CASE
        WHEN NOT "active" THEN 'DISABLED'::"ProviderCatalogStatus"
        WHEN NOT "available" THEN 'UNAVAILABLE'::"ProviderCatalogStatus"
        WHEN "priceMonthlyAmount" IS NULL OR "priceMonthlyAmount" <= 0
            THEN 'INVALID_PRICE'::"ProviderCatalogStatus"
        ELSE 'ACTIVE'::"ProviderCatalogStatus"
    END,
    "providerHourlyPriceIrr" = CASE
        WHEN "priceHourlyAmount" IS NULL OR "priceHourlyAmount" <= 0 THEN NULL
        WHEN upper(coalesce("currencyCode", '')) = 'IRR'
             AND upper(coalesce("amountUnit", '')) = 'RIAL'
            THEN ("priceHourlyAmount" + 999999) / 1000000
        WHEN upper(coalesce("currencyCode", '')) = 'IRR'
             AND upper(coalesce("amountUnit", '')) = 'TOMAN'
            THEN ("priceHourlyAmount" * 10 + 999999) / 1000000
        ELSE NULL
    END,
    "providerMonthlyPriceIrr" = CASE
        WHEN "priceMonthlyAmount" IS NULL OR "priceMonthlyAmount" <= 0 THEN NULL
        WHEN upper(coalesce("currencyCode", '')) = 'IRR'
             AND upper(coalesce("amountUnit", '')) = 'RIAL'
            THEN ("priceMonthlyAmount" + 999999) / 1000000
        WHEN upper(coalesce("currencyCode", '')) = 'IRR'
             AND upper(coalesce("amountUnit", '')) = 'TOMAN'
            THEN ("priceMonthlyAmount" * 10 + 999999) / 1000000
        ELSE NULL
    END;

CREATE UNIQUE INDEX "ProviderCatalogItem_externalKey_key"
    ON "ProviderCatalogItem"("externalKey");
DROP INDEX IF EXISTS "ProviderCatalogItem_provider_regionCode_sizeCode_key";
CREATE UNIQUE INDEX "ProviderCatalogItem_provider_apiVersion_regionCode_externalPlanId_key"
    ON "ProviderCatalogItem"("provider", "apiVersion", "regionCode", "externalPlanId");
CREATE INDEX "ProviderCatalogItem_provider_apiVersion_productKind_status_idx"
    ON "ProviderCatalogItem"("provider", "apiVersion", "productKind", "status");

ALTER TABLE "ProviderCatalogItem"
    ADD CONSTRAINT "ProviderCatalogItem_normalized_prices_check"
    CHECK (
        ("providerHourlyPriceIrr" IS NULL OR "providerHourlyPriceIrr" >= 0) AND
        ("providerMonthlyPriceIrr" IS NULL OR "providerMonthlyPriceIrr" >= 0)
    );

ALTER TABLE "InfrastructurePlan"
    ADD COLUMN "providerApiVersion" TEXT NOT NULL DEFAULT 'v1',
    ADD COLUMN "productKind" "InfrastructureProductKind" NOT NULL DEFAULT 'READY_INSTANT_SERVER',
    ADD COLUMN "minimumParchinLevel" "ParchinLevel";

UPDATE "InfrastructurePlan"
SET "minimumParchinLevel" = 'PARCHIN_START'
WHERE "parchinIncluded" = true;

ALTER TABLE "ServiceOrder"
    ADD COLUMN "provider" "InfrastructureProvider",
    ADD COLUMN "providerApiVersion" TEXT,
    ADD COLUMN "productKind" "InfrastructureProductKind",
    ADD COLUMN "parchinLevel" "ParchinLevel",
    ADD COLUMN "productFlowState" TEXT;

UPDATE "ServiceOrder" AS orders
SET
    "provider" = plans."provider",
    "providerApiVersion" = plans."providerApiVersion",
    "productKind" = plans."productKind",
    "parchinLevel" = plans."minimumParchinLevel"
FROM "InfrastructurePlan" AS plans
WHERE orders."planId" = plans."id";

ALTER TABLE "RecommendationSession"
    ADD COLUMN "productFlowState" TEXT,
    ADD COLUMN "guestAccessTokenHash" TEXT,
    ADD COLUMN "claimedAt" TIMESTAMP(3),
    ADD COLUMN "understandingSnapshot" JSONB,
    ADD COLUMN "requirementsSummary" JSONB,
    ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "RecommendationSession_guestAccessTokenHash_idx"
    ON "RecommendationSession"("guestAccessTokenHash");

DROP INDEX IF EXISTS "RecommendationQuote_sessionId_role_key";
CREATE INDEX "RecommendationQuote_sessionId_role_idx"
    ON "RecommendationQuote"("sessionId", "role");

ALTER TABLE "RecommendationQuote"
    ADD COLUMN "provider" "InfrastructureProvider",
    ADD COLUMN "providerApiVersion" TEXT,
    ADD COLUMN "productKind" "InfrastructureProductKind",
    ADD COLUMN "providerRegion" TEXT,
    ADD COLUMN "externalPlanId" TEXT,
    ADD COLUMN "externalImageId" TEXT,
    ADD COLUMN "externalNetworkId" TEXT,
    ADD COLUMN "externalSecurityId" TEXT,
    ADD COLUMN "vcpuSnapshot" INTEGER,
    ADD COLUMN "ramMbSnapshot" INTEGER,
    ADD COLUMN "diskGbSnapshot" INTEGER,
    ADD COLUMN "operatingSystemSnapshot" TEXT,
    ADD COLUMN "providerHourlyPriceIrr" BIGINT,
    ADD COLUMN "providerMonthlyPriceIrr" BIGINT,
    ADD COLUMN "markupAmountIrr" BIGINT,
    ADD COLUMN "parchinLevel" "ParchinLevel",
    ADD COLUMN "parchinPriceIrr" BIGINT,
    ADD COLUMN "providerAddonsSnapshot" JSONB,
    ADD COLUMN "taxBasisPointsSnapshot" INTEGER,
    ADD COLUMN "taxAmountIrr" BIGINT,
    ADD COLUMN "lineItemsSnapshot" JSONB,
    ADD COLUMN "quotedAt" TIMESTAMP(3),
    ADD COLUMN "catalogVersion" TEXT,
    ADD COLUMN "providerPayloadHash" TEXT;

UPDATE "RecommendationQuote" AS quotes
SET
    "provider" = plans."provider",
    "providerApiVersion" = plans."providerApiVersion",
    "productKind" = plans."productKind",
    "providerRegion" = plans."regionCode",
    "externalPlanId" = plans."sizeCode",
    "externalImageId" = plans."imageCode",
    "vcpuSnapshot" = plans."vcpu",
    "ramMbSnapshot" = CASE
        WHEN plans."ramGb" IS NULL THEN NULL
        ELSE plans."ramGb" * 1024
    END,
    "diskGbSnapshot" = plans."storageGb",
    "providerMonthlyPriceIrr" = quotes."providerBasePriceRialSnapshot",
    "markupAmountIrr" = CASE
        WHEN quotes."finalPriceRialSnapshot" IS NULL
          OR quotes."providerBasePriceRialSnapshot" IS NULL THEN NULL
        ELSE quotes."finalPriceRialSnapshot" - quotes."providerBasePriceRialSnapshot"
    END,
    "parchinLevel" = plans."minimumParchinLevel",
    "parchinPriceIrr" = 0,
    "taxBasisPointsSnapshot" = 0,
    "taxAmountIrr" = 0,
    "quotedAt" = quotes."createdAt"
FROM "InfrastructurePlan" AS plans
WHERE quotes."planId" = plans."id";

ALTER TABLE "InfrastructureOrder"
    ADD COLUMN "providerApiVersion" TEXT NOT NULL DEFAULT 'v1',
    ADD COLUMN "productKind" "InfrastructureProductKind" NOT NULL DEFAULT 'READY_INSTANT_SERVER',
    ADD COLUMN "parchinLevel" "ParchinLevel",
    ADD COLUMN "providerSelectionSnapshot" JSONB,
    ADD COLUMN "productFlowState" TEXT;

UPDATE "InfrastructureOrder" AS infra
SET
    "providerApiVersion" = plans."providerApiVersion",
    "productKind" = plans."productKind",
    "parchinLevel" = plans."minimumParchinLevel"
FROM "InfrastructurePlan" AS plans
WHERE infra."planId" = plans."id";

ALTER TABLE "ProvisioningJob"
    ADD COLUMN "providerTaskId" TEXT,
    ADD COLUMN "providerActionId" TEXT,
    ADD COLUMN "reconciliationKey" TEXT,
    ADD COLUMN "providerResourceId" TEXT,
    ADD COLUMN "lastPolledAt" TIMESTAMP(3);

CREATE INDEX "ProvisioningJob_reconciliationKey_idx"
    ON "ProvisioningJob"("reconciliationKey");

ALTER TABLE "CloudInstance"
    ADD COLUMN "providerApiVersion" TEXT NOT NULL DEFAULT 'v1';

ALTER TABLE "ServiceRenewalQuote"
    ADD COLUMN "provider" "InfrastructureProvider",
    ADD COLUMN "providerApiVersion" TEXT,
    ADD COLUMN "productKind" "InfrastructureProductKind",
    ADD COLUMN "parchinLevel" "ParchinLevel",
    ADD COLUMN "parchinPriceIrrSnapshot" BIGINT,
    ADD COLUMN "taxBasisPointsSnapshot" INTEGER,
    ADD COLUMN "taxAmountIrrSnapshot" BIGINT,
    ADD COLUMN "lineItemsSnapshot" JSONB;

ALTER TABLE "ServiceSubscription"
    ADD COLUMN "parchinLevel" "ParchinLevel";

UPDATE "ServiceSubscription" AS subscriptions
SET "parchinLevel" = coalesce(
    orders."parchinLevel",
    plans."minimumParchinLevel"
)
FROM "ServiceOrder" AS orders
LEFT JOIN "InfrastructurePlan" AS plans ON plans."id" = orders."planId"
WHERE subscriptions."sourceOrderId" = orders."id";

ALTER TABLE "ProviderOperationLog"
    ADD COLUMN "providerApiVersion" TEXT NOT NULL DEFAULT 'v1',
    ADD COLUMN "providerRegion" TEXT,
    ADD COLUMN "endpoint" TEXT,
    ADD COLUMN "httpStatus" INTEGER,
    ADD COLUMN "providerRequestId" TEXT,
    ADD COLUMN "durationMs" INTEGER;

ALTER TABLE "ProviderCatalogState"
    ADD COLUMN "apiVersion" TEXT NOT NULL DEFAULT 'v1',
    ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "staleItemCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "invalidPriceCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "networkCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "securityCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "lastSyncDurationMs" INTEGER,
    ADD COLUMN "lastSyncStatus" "ProviderSyncStatus",
    ADD COLUMN "catalogVersion" TEXT,
    ADD COLUMN "regionErrors" JSONB,
    ADD COLUMN "lastProviderRequestId" TEXT;

ALTER TABLE "ProviderPricingConfig"
    ADD COLUMN "apiVersion" TEXT NOT NULL DEFAULT 'v1',
    ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "sourceMoneyUnit" TEXT;

UPDATE "ProviderPricingConfig"
SET "sourceMoneyUnit" = CASE
    WHEN "provider" = 'PARSPACK' THEN NULL
    ELSE 'IRR'
END;

CREATE TABLE "ProductPricingConfig" (
    "id" TEXT NOT NULL,
    "provider" "InfrastructureProvider" NOT NULL,
    "apiVersion" TEXT NOT NULL DEFAULT 'v1',
    "productKind" "InfrastructureProductKind" NOT NULL,
    "markupBasisPoints" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductPricingConfig_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductPricingConfig_markup_check"
      CHECK ("markupBasisPoints" >= 0 AND "markupBasisPoints" <= 100000)
);

INSERT INTO "ProductPricingConfig" (
    "id", "provider", "apiVersion", "productKind", "markupBasisPoints",
    "enabled", "updatedAt"
)
SELECT
    'legacy-parspack-ready', 'PARSPACK', 'v1', 'READY_INSTANT_SERVER',
    0, "enabled", CURRENT_TIMESTAMP
FROM "ProviderPricingConfig"
WHERE "provider" = 'PARSPACK'
ON CONFLICT DO NOTHING;

CREATE UNIQUE INDEX "ProductPricingConfig_provider_apiVersion_productKind_key"
    ON "ProductPricingConfig"("provider", "apiVersion", "productKind");
CREATE INDEX "ProductPricingConfig_productKind_enabled_idx"
    ON "ProductPricingConfig"("productKind", "enabled");

CREATE TABLE "CommercePricingConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "taxBps" INTEGER NOT NULL DEFAULT 1000,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommercePricingConfig_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CommercePricingConfig_tax_check"
      CHECK ("taxBps" >= 0 AND "taxBps" <= 10000)
);
INSERT INTO "CommercePricingConfig" ("id", "taxBps", "updatedAt")
VALUES ('default', 1000, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

CREATE TABLE "ParchinPricingConfig" (
    "id" TEXT NOT NULL,
    "level" "ParchinLevel" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priceRial" BIGINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ParchinPricingConfig_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ParchinPricingConfig_price_check" CHECK ("priceRial" >= 0)
);
CREATE UNIQUE INDEX "ParchinPricingConfig_level_key"
    ON "ParchinPricingConfig"("level");
INSERT INTO "ParchinPricingConfig" (
    "id", "level", "title", "description", "priceRial", "active",
    "sortOrder", "updatedAt"
) VALUES
    ('parchin-start', 'PARCHIN_START', 'پرچین شروع',
     'حداقل اجباری تحویل امن و بررسی سلامت پایه', 0, true, 10, CURRENT_TIMESTAMP),
    ('parchin-active', 'PARCHIN_ACTIVE', 'پرچین فعال',
     'نیازمند تعیین قیمت و دامنه خدمت در پنل مدیریت', 0, false, 20, CURRENT_TIMESTAMP),
    ('parchin-stable', 'PARCHIN_STABLE', 'پرچین پایدار',
     'نیازمند تعیین قیمت و دامنه خدمت در پنل مدیریت', 0, false, 30, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

CREATE TABLE "ProviderCatalogAsset" (
    "id" TEXT NOT NULL,
    "provider" "InfrastructureProvider" NOT NULL,
    "apiVersion" TEXT NOT NULL DEFAULT 'v1',
    "regionCode" TEXT NOT NULL,
    "kind" "ProviderCatalogAssetKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ProviderCatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "available" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "rawUpdatedAt" TIMESTAMP(3),
    "rawPayload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProviderCatalogAsset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProviderCatalogAsset_identity_key"
    ON "ProviderCatalogAsset"("provider", "apiVersion", "regionCode", "kind", "externalId");
CREATE INDEX "ProviderCatalogAsset_listing_idx"
    ON "ProviderCatalogAsset"("provider", "apiVersion", "regionCode", "kind", "status");

CREATE TABLE "ProviderCatalogRegionState" (
    "id" TEXT NOT NULL,
    "provider" "InfrastructureProvider" NOT NULL,
    "apiVersion" TEXT NOT NULL DEFAULT 'v1',
    "regionCode" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "status" "ProviderCatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSeenAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "providerRequestId" TEXT,
    "syncDurationMs" INTEGER,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProviderCatalogRegionState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProviderCatalogRegionState_identity_key"
    ON "ProviderCatalogRegionState"("provider", "apiVersion", "regionCode");
CREATE INDEX "ProviderCatalogRegionState_status_idx"
    ON "ProviderCatalogRegionState"("provider", "apiVersion", "status");

CREATE TABLE "ProviderCatalogSyncRun" (
    "id" TEXT NOT NULL,
    "provider" "InfrastructureProvider" NOT NULL,
    "apiVersion" TEXT NOT NULL,
    "status" "ProviderSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "catalogVersion" TEXT NOT NULL,
    "regionCount" INTEGER NOT NULL DEFAULT 0,
    "successfulRegions" INTEGER NOT NULL DEFAULT 0,
    "failedRegions" INTEGER NOT NULL DEFAULT 0,
    "planCount" INTEGER NOT NULL DEFAULT 0,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "networkCount" INTEGER NOT NULL DEFAULT 0,
    "securityCount" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    CONSTRAINT "ProviderCatalogSyncRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProviderCatalogSyncRun_provider_startedAt_idx"
    ON "ProviderCatalogSyncRun"("provider", "apiVersion", "startedAt");
CREATE INDEX "ProviderCatalogSyncRun_status_startedAt_idx"
    ON "ProviderCatalogSyncRun"("status", "startedAt");

CREATE TABLE "ProductFlowTransition" (
    "id" TEXT NOT NULL,
    "recommendationSessionId" TEXT,
    "serviceOrderId" TEXT,
    "infrastructureOrderId" TEXT,
    "fromState" TEXT NOT NULL,
    "toState" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductFlowTransition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductFlowTransition_idempotencyKey_key"
    ON "ProductFlowTransition"("idempotencyKey");
CREATE INDEX "ProductFlowTransition_session_idx"
    ON "ProductFlowTransition"("recommendationSessionId", "createdAt");
CREATE INDEX "ProductFlowTransition_order_idx"
    ON "ProductFlowTransition"("serviceOrderId", "createdAt");
CREATE INDEX "ProductFlowTransition_infrastructure_idx"
    ON "ProductFlowTransition"("infrastructureOrderId", "createdAt");
