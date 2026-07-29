CREATE TYPE "CatalogMappingStatus" AS ENUM ('UNMAPPED', 'MAPPED');
CREATE TYPE "RenewalQuoteStatus" AS ENUM ('ACTIVE', 'PAID', 'EXPIRED', 'INVALIDATED');

CREATE TABLE "ProviderCatalogItem" (
    "id" TEXT NOT NULL,
    "provider" "InfrastructureProvider" NOT NULL,
    "regionCode" TEXT NOT NULL,
    "sizeCode" TEXT NOT NULL,
    "sizeName" TEXT NOT NULL,
    "compatibleImageCodes" JSONB NOT NULL,
    "vcpu" INTEGER,
    "ramMb" INTEGER,
    "diskGb" INTEGER,
    "transfer" TEXT,
    "available" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "priceHourlyAmount" BIGINT,
    "priceMonthlyAmount" BIGINT,
    "priceScale" INTEGER NOT NULL DEFAULT 6,
    "currencyCode" TEXT,
    "amountUnit" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "rawUpdatedAt" TIMESTAMP(3),
    "unavailableAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderCatalogItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderPricingConfig" (
    "id" TEXT NOT NULL DEFAULT 'parspack',
    "provider" "InfrastructureProvider" NOT NULL,
    "markupBasisPoints" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "ProviderPricingConfig_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "InfrastructurePlan"
    ADD COLUMN "catalogItemId" TEXT,
    ADD COLUMN "catalogMappingStatus" "CatalogMappingStatus" NOT NULL DEFAULT 'UNMAPPED',
    ADD COLUMN "catalogMappedAt" TIMESTAMP(3);

ALTER TABLE "RecommendationQuote"
    ADD COLUMN "catalogItemId" TEXT,
    ADD COLUMN "providerBasePriceRialSnapshot" BIGINT,
    ADD COLUMN "markupBasisPointsSnapshot" INTEGER,
    ADD COLUMN "finalPriceRialSnapshot" BIGINT,
    ADD COLUMN "currencySnapshot" TEXT,
    ADD COLUMN "providerPriceCheckedAt" TIMESTAMP(3);

ALTER TABLE "ProviderCatalogState"
    ADD COLUMN "catalogItemCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "pricedItemCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "unavailableItemCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ServiceRenewalQuote" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "status" "RenewalQuoteStatus" NOT NULL DEFAULT 'ACTIVE',
    "providerBasePriceRialSnapshot" BIGINT NOT NULL,
    "markupBasisPointsSnapshot" INTEGER NOT NULL,
    "finalPriceRialSnapshot" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IRR',
    "providerPriceCheckedAt" TIMESTAMP(3) NOT NULL,
    "periodStartSnapshot" TIMESTAMP(3) NOT NULL,
    "periodEndSnapshot" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceRenewalQuote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderCatalogItem_provider_regionCode_sizeCode_key"
    ON "ProviderCatalogItem"("provider", "regionCode", "sizeCode");
CREATE INDEX "ProviderCatalogItem_provider_available_active_idx"
    ON "ProviderCatalogItem"("provider", "available", "active");
CREATE INDEX "ProviderCatalogItem_provider_lastSyncedAt_idx"
    ON "ProviderCatalogItem"("provider", "lastSyncedAt");
CREATE UNIQUE INDEX "ProviderPricingConfig_provider_key"
    ON "ProviderPricingConfig"("provider");
CREATE INDEX "InfrastructurePlan_catalogItemId_idx"
    ON "InfrastructurePlan"("catalogItemId");
CREATE INDEX "InfrastructurePlan_catalogMappingStatus_active_idx"
    ON "InfrastructurePlan"("catalogMappingStatus", "active");
CREATE INDEX "RecommendationQuote_catalogItemId_expiresAt_idx"
    ON "RecommendationQuote"("catalogItemId", "expiresAt");
CREATE INDEX "ServiceRenewalQuote_subscriptionId_status_expiresAt_idx"
    ON "ServiceRenewalQuote"("subscriptionId", "status", "expiresAt");
CREATE INDEX "ServiceRenewalQuote_userId_createdAt_idx"
    ON "ServiceRenewalQuote"("userId", "createdAt");
CREATE INDEX "ServiceRenewalQuote_catalogItemId_createdAt_idx"
    ON "ServiceRenewalQuote"("catalogItemId", "createdAt");

ALTER TABLE "ProviderPricingConfig"
    ADD CONSTRAINT "ProviderPricingConfig_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProviderPricingConfig"
    ADD CONSTRAINT "ProviderPricingConfig_markupBasisPoints_check"
    CHECK ("markupBasisPoints" >= 0 AND "markupBasisPoints" <= 100000);
ALTER TABLE "ProviderCatalogItem"
    ADD CONSTRAINT "ProviderCatalogItem_priceScale_check"
    CHECK ("priceScale" >= 0 AND "priceScale" <= 18);
ALTER TABLE "ProviderCatalogItem"
    ADD CONSTRAINT "ProviderCatalogItem_nonnegative_prices_check"
    CHECK (
        ("priceHourlyAmount" IS NULL OR "priceHourlyAmount" >= 0) AND
        ("priceMonthlyAmount" IS NULL OR "priceMonthlyAmount" >= 0)
    );
ALTER TABLE "InfrastructurePlan"
    ADD CONSTRAINT "InfrastructurePlan_catalogItemId_fkey"
    FOREIGN KEY ("catalogItemId") REFERENCES "ProviderCatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecommendationQuote"
    ADD CONSTRAINT "RecommendationQuote_catalogItemId_fkey"
    FOREIGN KEY ("catalogItemId") REFERENCES "ProviderCatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceRenewalQuote"
    ADD CONSTRAINT "ServiceRenewalQuote_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "ServiceSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceRenewalQuote"
    ADD CONSTRAINT "ServiceRenewalQuote_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceRenewalQuote"
    ADD CONSTRAINT "ServiceRenewalQuote_catalogItemId_fkey"
    FOREIGN KEY ("catalogItemId") REFERENCES "ProviderCatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The previous task introduced an auto-renew switch. Product policy now
-- requires explicit price confirmation for every renewal, so legacy flags are
-- disabled while the column is retained for backward-compatible rollback.
UPDATE "ServiceSubscription" SET "autoRenew" = false WHERE "autoRenew" = true;
