-- Review hardening for canonical product flow, DB-authoritative delivery,
-- catalog freshness locking, and audited health/secure delivery.
-- Financial amounts, paid orders, ledger rows, and historical quote snapshots
-- are intentionally not recalculated or rewritten.

CREATE TYPE "InfrastructureHealthCheckStatus" AS ENUM (
    'RUNNING',
    'SUCCEEDED',
    'FAILED'
);

CREATE TYPE "SecureDeliveryStatus" AS ENUM (
    'PENDING',
    'DELIVERED',
    'FAILED'
);

ALTER TYPE "ProviderCatalogStatus" ADD VALUE IF NOT EXISTS 'INVALID_RESOURCE';

ALTER TABLE "ServiceOrder"
    ADD COLUMN "productFlowRevision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "RecommendationSession"
    ADD COLUMN "productFlowRevision" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "selectedParchinLevel" "ParchinLevel",
    ADD COLUMN "deliveryConfiguration" JSONB;

ALTER TABLE "RecommendationQuote"
    ADD COLUMN "deliveryConfigurationSnapshot" JSONB;

ALTER TABLE "InfrastructureOrder"
    ADD COLUMN "productFlowRevision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "CloudInstance"
    ADD COLUMN "providerState" TEXT,
    ADD COLUMN "networkId" TEXT,
    ADD COLUMN "securityId" TEXT,
    ADD COLUMN "healthCheckedAt" TIMESTAMP(3),
    ADD COLUMN "deliveredAt" TIMESTAMP(3);

ALTER TABLE "ProviderCatalogState"
    ADD COLUMN "freshnessSlaSeconds" INTEGER NOT NULL DEFAULT 900,
    ADD COLUMN "invalidResourceCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "syncRequestedAt" TIMESTAMP(3),
    ADD COLUMN "syncLeaseToken" TEXT,
    ADD COLUMN "syncLeaseExpiresAt" TIMESTAMP(3);

ALTER TABLE "ProviderCatalogState"
    ADD CONSTRAINT "ProviderCatalogState_freshness_sla_check"
    CHECK ("freshnessSlaSeconds" >= 60 AND "freshnessSlaSeconds" <= 86400);

ALTER TABLE "ProviderCatalogAsset"
    ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ProductFlowTransition"
    ADD COLUMN "ownerFingerprint" TEXT,
    ADD COLUMN "fromRevision" INTEGER,
    ADD COLUMN "toRevision" INTEGER;

UPDATE "ProductFlowTransition"
SET
    "ownerFingerprint" =
        coalesce("recommendationSessionId", '-') || ':' ||
        coalesce("serviceOrderId", '-') || ':' ||
        coalesce("infrastructureOrderId", '-'),
    "fromRevision" = 0,
    "toRevision" = 1
WHERE "ownerFingerprint" IS NULL
   OR "fromRevision" IS NULL
   OR "toRevision" IS NULL;

ALTER TABLE "ProductFlowTransition"
    ALTER COLUMN "ownerFingerprint" SET NOT NULL,
    ALTER COLUMN "fromRevision" SET NOT NULL,
    ALTER COLUMN "toRevision" SET NOT NULL;

-- Canonicalize only the flow marker. Business, financial, and provider status
-- columns remain untouched. Ambiguous legacy discovery/configuration states
-- move backwards to the last state proven by persisted data.
UPDATE "RecommendationSession"
SET "productFlowState" = CASE
    WHEN "productFlowState" IN (
        'DRAFT', 'UNDERSTANDING_CONFIRMED', 'REQUIREMENTS_COMPLETE',
        'RECOMMENDED', 'PARCHIN_SELECTED', 'DELIVERY_CONFIGURED',
        'AUTH_REQUIRED', 'AWAITING_PAYMENT', 'PAID',
        'PROVISIONING_SUBMITTED', 'PROVISIONING', 'HEALTH_CHECKING',
        'DELIVERED', 'ACTIVE', 'QUOTE_EXPIRED', 'PAYMENT_REVIEW',
        'PROVISIONING_RETRYABLE', 'PROVISIONING_RECONCILING',
        'PROVISIONING_MANUAL_REVIEW', 'HEALTH_CHECK_FAILED',
        'DELIVERY_RETRYABLE', 'CANCELLED'
    ) THEN "productFlowState"
    WHEN "productFlowState" IN ('COMPARING', 'EXPIRED') THEN 'REQUIREMENTS_COMPLETE'
    WHEN "productFlowState" = 'QUOTED' THEN 'RECOMMENDED'
    WHEN "productFlowState" IN ('AUTHENTICATING', 'CHECKOUT', 'PAYMENT_PENDING')
        THEN 'AWAITING_PAYMENT'
    WHEN "productFlowState" = 'WAITING_PROVIDER_FUNDING'
        THEN 'PROVISIONING_SUBMITTED'
    WHEN "productFlowState" = 'RECONCILING'
        THEN 'PROVISIONING_RECONCILING'
    WHEN "productFlowState" IN ('HEALTH_CHECK', 'SECURE_DELIVERY')
        THEN 'HEALTH_CHECKING'
    WHEN "productFlowState" IN ('ESCALATED', 'FAILED')
        THEN 'PROVISIONING_MANUAL_REVIEW'
    WHEN "productFlowState" IN ('ENTRY', 'DISCOVERY', 'PROFILE_REVIEW', 'CONFIGURING')
        THEN 'DRAFT'
    WHEN "status" = 'QUOTED' THEN 'RECOMMENDED'
    WHEN "status" = 'CHECKOUT' THEN 'AWAITING_PAYMENT'
    WHEN "status" = 'CONVERTED' THEN 'PAID'
    WHEN "status" = 'EXPIRED' THEN 'QUOTE_EXPIRED'
    ELSE 'DRAFT'
END;

UPDATE "ServiceOrder"
SET "productFlowState" = CASE
    WHEN "productFlowState" IN (
        'DRAFT', 'UNDERSTANDING_CONFIRMED', 'REQUIREMENTS_COMPLETE',
        'RECOMMENDED', 'PARCHIN_SELECTED', 'DELIVERY_CONFIGURED', 'QUOTED',
        'AUTH_REQUIRED', 'AWAITING_PAYMENT', 'PAID',
        'PROVISIONING_SUBMITTED', 'PROVISIONING', 'HEALTH_CHECKING',
        'DELIVERED', 'ACTIVE', 'QUOTE_EXPIRED', 'PAYMENT_REVIEW',
        'PROVISIONING_RETRYABLE', 'PROVISIONING_RECONCILING',
        'PROVISIONING_MANUAL_REVIEW', 'HEALTH_CHECK_FAILED',
        'DELIVERY_RETRYABLE', 'CANCELLED'
    ) THEN "productFlowState"
    WHEN "status" = 'PAID' THEN 'PAID'
    WHEN "status" = 'PENDING_PAYMENT' THEN 'AWAITING_PAYMENT'
    WHEN "status" IN ('CANCELED', 'REFUNDED') THEN 'CANCELLED'
    ELSE 'DRAFT'
END;

UPDATE "InfrastructureOrder"
SET "productFlowState" = CASE
    WHEN "productFlowState" IN (
        'PAID', 'PROVISIONING_SUBMITTED', 'PROVISIONING',
        'HEALTH_CHECKING', 'DELIVERED', 'ACTIVE',
        'PROVISIONING_RETRYABLE', 'PROVISIONING_RECONCILING',
        'PROVISIONING_MANUAL_REVIEW', 'HEALTH_CHECK_FAILED',
        'DELIVERY_RETRYABLE', 'CANCELLED'
    ) THEN "productFlowState"
    WHEN "status" = 'ACTIVE' THEN 'ACTIVE'
    WHEN "status" = 'PROVISIONING' THEN 'PROVISIONING'
    WHEN "status" = 'NEEDS_RECONCILIATION' THEN 'PROVISIONING_RECONCILING'
    WHEN "status" = 'FAILED' THEN 'PROVISIONING_RETRYABLE'
    WHEN "status" IN ('CANCELED', 'REFUNDED') THEN 'CANCELLED'
    WHEN "status" IN ('FUNDING_CONFIRMED', 'QUEUED')
        THEN 'PROVISIONING_SUBMITTED'
    ELSE 'PAID'
END;

CREATE TABLE "InfrastructureHealthCheck" (
    "id" TEXT NOT NULL,
    "infrastructureOrderId" TEXT NOT NULL,
    "cloudInstanceId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "InfrastructureHealthCheckStatus" NOT NULL DEFAULT 'RUNNING',
    "providerState" TEXT,
    "expectedIpv4" TEXT,
    "observedIpv4" TEXT,
    "expectedNetworkId" TEXT,
    "connectivityProtocol" TEXT,
    "resultCode" TEXT,
    "durationMs" INTEGER,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "metadata" JSONB,
    CONSTRAINT "InfrastructureHealthCheck_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InfrastructureHealthCheck_order_attempt_key"
    ON "InfrastructureHealthCheck"("infrastructureOrderId", "attempt");
CREATE INDEX "InfrastructureHealthCheck_order_status_checked_idx"
    ON "InfrastructureHealthCheck"("infrastructureOrderId", "status", "checkedAt");
CREATE INDEX "InfrastructureHealthCheck_instance_checked_idx"
    ON "InfrastructureHealthCheck"("cloudInstanceId", "checkedAt");

CREATE TABLE "SecureDeliveryEvent" (
    "id" TEXT NOT NULL,
    "infrastructureOrderId" TEXT NOT NULL,
    "cloudInstanceId" TEXT NOT NULL,
    "status" "SecureDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "method" TEXT NOT NULL,
    "resultCode" TEXT,
    "metadata" JSONB,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SecureDeliveryEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SecureDeliveryEvent_order_status_created_idx"
    ON "SecureDeliveryEvent"("infrastructureOrderId", "status", "createdAt");
CREATE INDEX "SecureDeliveryEvent_instance_created_idx"
    ON "SecureDeliveryEvent"("cloudInstanceId", "createdAt");

ALTER TABLE "InfrastructureHealthCheck"
    ADD CONSTRAINT "InfrastructureHealthCheck_order_fkey"
    FOREIGN KEY ("infrastructureOrderId") REFERENCES "InfrastructureOrder"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InfrastructureHealthCheck"
    ADD CONSTRAINT "InfrastructureHealthCheck_instance_fkey"
    FOREIGN KEY ("cloudInstanceId") REFERENCES "CloudInstance"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecureDeliveryEvent"
    ADD CONSTRAINT "SecureDeliveryEvent_order_fkey"
    FOREIGN KEY ("infrastructureOrderId") REFERENCES "InfrastructureOrder"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecureDeliveryEvent"
    ADD CONSTRAINT "SecureDeliveryEvent_instance_fkey"
    FOREIGN KEY ("cloudInstanceId") REFERENCES "CloudInstance"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
