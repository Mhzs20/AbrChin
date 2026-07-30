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
    ADD COLUMN "providerObservedAt" TIMESTAMP(3),
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

-- A legacy quote is recoverable as payable only when every provider and
-- delivery lock is explicit. Never infer an image, network, security group,
-- access method, provider route, or price.
UPDATE "RecommendationQuote" q
SET "deliveryConfigurationSnapshot" = q."planSnapshot"->'deliveryConfiguration'
WHERE q."deliveryConfigurationSnapshot" IS NULL
  AND jsonb_typeof(q."planSnapshot"->'deliveryConfiguration') = 'object'
  AND q."planSnapshot"->'deliveryConfiguration'->>'provider' = q."provider"::text
  AND q."planSnapshot"->'deliveryConfiguration'->>'providerApiVersion' = q."providerApiVersion"
  AND q."planSnapshot"->'deliveryConfiguration'->>'productKind' = q."productKind"::text
  AND q."planSnapshot"->'deliveryConfiguration'->>'region' = q."providerRegion"
  AND q."planSnapshot"->'deliveryConfiguration'->>'externalPlanId' = q."externalPlanId"
  AND q."planSnapshot"->'deliveryConfiguration'->>'externalImageId' = q."externalImageId"
  AND q."planSnapshot"->'deliveryConfiguration'->>'externalNetworkId' = q."externalNetworkId"
  AND q."planSnapshot"->'deliveryConfiguration'->>'externalSecurityId' = q."externalSecurityId"
  AND q."planSnapshot"->'deliveryConfiguration'->>'accessMethod'
      IN ('SSH_KEY', 'ONE_TIME_PASSWORD', 'WINDOWS_PASSWORD');

CREATE TEMP TABLE "_AbrchinValidLegacyUnpaidGraph" ON COMMIT DROP AS
SELECT
  q.id AS "quoteId",
  q."sessionId",
  so.id AS "serviceOrderId",
  CASE
    WHEN s."productFlowState" = 'AWAITING_PAYMENT'
      AND so."productFlowState" = 'AWAITING_PAYMENT'
      AND s."productFlowRevision" = so."productFlowRevision"
    THEN s."productFlowRevision"
    ELSE greatest(s."productFlowRevision", so."productFlowRevision") + 1
  END AS "targetRevision"
FROM "RecommendationQuote" q
JOIN "RecommendationSession" s ON s.id = q."sessionId"
JOIN "ServiceOrder" so ON so."recommendationQuoteId" = q.id
LEFT JOIN "InfrastructureOrder" io ON io."serviceOrderId" = so.id
WHERE so.status = 'PENDING_PAYMENT'
  AND io.id IS NULL
  AND q.status IN ('ACTIVE', 'SELECTED')
  AND q."expiresAt" > CURRENT_TIMESTAMP
  AND s."expiresAt" > CURRENT_TIMESTAMP
  AND q."catalogItemId" IS NOT NULL
  AND q.provider IS NOT NULL
  AND q."providerApiVersion" = 'v1'
  AND q."productKind" IS NOT NULL
  AND q."providerRegion" IS NOT NULL
  AND q."externalPlanId" IS NOT NULL
  AND q."externalImageId" IS NOT NULL
  AND q."externalNetworkId" IS NOT NULL
  AND q."externalSecurityId" IS NOT NULL
  AND q."providerMonthlyPriceIrr" > 0
  AND q."providerBasePriceRialSnapshot" > 0
  AND q."finalPriceRialSnapshot" > 0
  AND q."amountRial" = so.amount
  AND q."amountRial" = q."finalPriceRialSnapshot"
  AND q."currencySnapshot" = 'IRR'
  AND q."quotedAt" IS NOT NULL
  AND q."providerPriceCheckedAt" IS NOT NULL
  AND q."catalogVersion" IS NOT NULL
  AND q."providerPayloadHash" IS NOT NULL
  AND q."parchinLevel" IS NOT NULL
  AND q."parchinPriceIrr" IS NOT NULL
  AND q."taxBasisPointsSnapshot" IS NOT NULL
  AND q."taxAmountIrr" IS NOT NULL
  AND jsonb_typeof(q."deliveryConfigurationSnapshot") = 'object'
  AND q."deliveryConfigurationSnapshot"->>'provider' = q.provider::text
  AND q."deliveryConfigurationSnapshot"->>'providerApiVersion' = q."providerApiVersion"
  AND q."deliveryConfigurationSnapshot"->>'productKind' = q."productKind"::text
  AND q."deliveryConfigurationSnapshot"->>'region' = q."providerRegion"
  AND q."deliveryConfigurationSnapshot"->>'externalPlanId' = q."externalPlanId"
  AND q."deliveryConfigurationSnapshot"->>'externalImageId' = q."externalImageId"
  AND q."deliveryConfigurationSnapshot"->>'externalNetworkId' = q."externalNetworkId"
  AND q."deliveryConfigurationSnapshot"->>'externalSecurityId' = q."externalSecurityId"
  AND q."deliveryConfigurationSnapshot"->>'accessMethod'
      IN ('SSH_KEY', 'ONE_TIME_PASSWORD', 'WINDOWS_PASSWORD');

UPDATE "RecommendationSession" s
SET "productFlowState" = 'AWAITING_PAYMENT',
    "productFlowRevision" = g."targetRevision",
    "deliveryConfiguration" = q."deliveryConfigurationSnapshot"
FROM "_AbrchinValidLegacyUnpaidGraph" g
JOIN "RecommendationQuote" q ON q.id = g."quoteId"
WHERE s.id = g."sessionId";

UPDATE "ServiceOrder" so
SET "productFlowState" = 'AWAITING_PAYMENT',
    "productFlowRevision" = g."targetRevision"
FROM "_AbrchinValidLegacyUnpaidGraph" g
WHERE so.id = g."serviceOrderId";

INSERT INTO "ProductFlowTransition" (
  id, "recommendationSessionId", "serviceOrderId",
  "fromState", "toState", reason, metadata, "idempotencyKey",
  "ownerFingerprint", "fromRevision", "toRevision"
)
SELECT
  'migration:legacy-valid:' || g."quoteId",
  g."sessionId", g."serviceOrderId",
  'LEGACY_UNPAID', 'AWAITING_PAYMENT',
  'legacy_graph_validated',
  jsonb_build_object('migration', '20260730190000', 'quoteId', g."quoteId"),
  'migration:legacy-valid:' || g."quoteId",
  g."sessionId" || ':' || g."serviceOrderId" || ':-',
  greatest(g."targetRevision" - 1, 0), g."targetRevision"
FROM "_AbrchinValidLegacyUnpaidGraph" g
ON CONFLICT ("idempotencyKey") DO NOTHING;

CREATE TEMP TABLE "_AbrchinInvalidLegacyUnpaidGraph" ON COMMIT DROP AS
SELECT
  q.id AS "quoteId",
  q."sessionId",
  so.id AS "serviceOrderId",
  greatest(s."productFlowRevision", coalesce(so."productFlowRevision", 0)) + 1 AS "targetRevision",
  q."expiresAt" <= CURRENT_TIMESTAMP AS expired
FROM "RecommendationQuote" q
JOIN "RecommendationSession" s ON s.id = q."sessionId"
LEFT JOIN "ServiceOrder" so ON so."recommendationQuoteId" = q.id
LEFT JOIN "InfrastructureOrder" io ON io."serviceOrderId" = so.id
LEFT JOIN "_AbrchinValidLegacyUnpaidGraph" valid ON valid."quoteId" = q.id
WHERE q.status IN ('ACTIVE', 'SELECTED')
  AND (so.id IS NULL OR so.status <> 'PAID')
  AND io.id IS NULL
  AND valid."quoteId" IS NULL;

UPDATE "RecommendationQuote" q
SET status = CASE WHEN g.expired THEN 'EXPIRED'::"RecommendationQuoteStatus"
                  ELSE 'INVALIDATED'::"RecommendationQuoteStatus" END
FROM "_AbrchinInvalidLegacyUnpaidGraph" g
WHERE q.id = g."quoteId";

UPDATE "RecommendationSession" s
SET "productFlowState" = 'REQUIREMENTS_COMPLETE',
    "productFlowRevision" = g."targetRevision",
    "deliveryConfiguration" = NULL
FROM "_AbrchinInvalidLegacyUnpaidGraph" g
WHERE s.id = g."sessionId";

UPDATE "ServiceOrder" so
SET status = 'DRAFT',
    "productFlowState" = 'REQUIREMENTS_COMPLETE',
    "productFlowRevision" = g."targetRevision"
FROM "_AbrchinInvalidLegacyUnpaidGraph" g
WHERE so.id = g."serviceOrderId"
  AND so.status <> 'PAID';

INSERT INTO "ProductFlowTransition" (
  id, "recommendationSessionId", "serviceOrderId",
  "fromState", "toState", reason, metadata, "idempotencyKey",
  "ownerFingerprint", "fromRevision", "toRevision"
)
SELECT
  'migration:legacy-invalid:' || g."quoteId",
  g."sessionId", g."serviceOrderId",
  'LEGACY_UNPAID', 'REQUIREMENTS_COMPLETE',
  'legacy_quote_requires_reselection',
  jsonb_build_object(
    'migration', '20260730190000',
    'quoteId', g."quoteId",
    'expired', g.expired
  ),
  'migration:legacy-invalid:' || g."quoteId",
  g."sessionId" || ':' || coalesce(g."serviceOrderId", '-') || ':-',
  greatest(g."targetRevision" - 1, 0), g."targetRevision"
FROM "_AbrchinInvalidLegacyUnpaidGraph" g
ON CONFLICT ("idempotencyKey") DO NOTHING;

-- Paid financial rows are immutable. Only canonical flow markers are aligned
-- so a legacy paid graph can safely continue into provisioning.
CREATE TEMP TABLE "_AbrchinPaidLegacyGraph" ON COMMIT DROP AS
SELECT
  so.id AS "serviceOrderId",
  q."sessionId",
  io.id AS "infrastructureOrderId",
  CASE
    WHEN io.status = 'ACTIVE' THEN 'ACTIVE'
    WHEN io.status = 'PROVISIONING' THEN 'PROVISIONING'
    WHEN io.status = 'NEEDS_RECONCILIATION' THEN 'PROVISIONING_RECONCILING'
    WHEN io.status = 'FAILED' THEN 'PROVISIONING_RETRYABLE'
    WHEN io.status IN ('FUNDING_CONFIRMED', 'QUEUED') THEN 'PROVISIONING_SUBMITTED'
    WHEN io.status IN ('CANCELED', 'REFUNDED') THEN 'CANCELLED'
    ELSE 'PAID'
  END AS "targetState",
  greatest(
    so."productFlowRevision",
    coalesce(s."productFlowRevision", 0),
    coalesce(io."productFlowRevision", 0)
  ) + 1 AS "targetRevision"
FROM "ServiceOrder" so
LEFT JOIN "RecommendationQuote" q ON q.id = so."recommendationQuoteId"
LEFT JOIN "RecommendationSession" s ON s.id = q."sessionId"
LEFT JOIN "InfrastructureOrder" io ON io."serviceOrderId" = so.id
WHERE so.status = 'PAID'
  AND (
    so."productFlowState" IS DISTINCT FROM
      CASE
        WHEN io.status = 'ACTIVE' THEN 'ACTIVE'
        WHEN io.status = 'PROVISIONING' THEN 'PROVISIONING'
        WHEN io.status = 'NEEDS_RECONCILIATION' THEN 'PROVISIONING_RECONCILING'
        WHEN io.status = 'FAILED' THEN 'PROVISIONING_RETRYABLE'
        WHEN io.status IN ('FUNDING_CONFIRMED', 'QUEUED') THEN 'PROVISIONING_SUBMITTED'
        WHEN io.status IN ('CANCELED', 'REFUNDED') THEN 'CANCELLED'
        ELSE 'PAID'
      END
    OR (s.id IS NOT NULL AND s."productFlowRevision" <> so."productFlowRevision")
    OR (io.id IS NOT NULL AND io."productFlowRevision" <> so."productFlowRevision")
  );

UPDATE "RecommendationSession" s
SET "productFlowState" = g."targetState",
    "productFlowRevision" = g."targetRevision"
FROM "_AbrchinPaidLegacyGraph" g
WHERE s.id = g."sessionId";

UPDATE "ServiceOrder" so
SET "productFlowState" = g."targetState",
    "productFlowRevision" = g."targetRevision"
FROM "_AbrchinPaidLegacyGraph" g
WHERE so.id = g."serviceOrderId";

UPDATE "InfrastructureOrder" io
SET "productFlowState" = g."targetState",
    "productFlowRevision" = g."targetRevision"
FROM "_AbrchinPaidLegacyGraph" g
WHERE io.id = g."infrastructureOrderId";

INSERT INTO "ProductFlowTransition" (
  id, "recommendationSessionId", "serviceOrderId", "infrastructureOrderId",
  "fromState", "toState", reason, metadata, "idempotencyKey",
  "ownerFingerprint", "fromRevision", "toRevision"
)
SELECT
  'migration:legacy-paid:' || g."serviceOrderId",
  g."sessionId", g."serviceOrderId", g."infrastructureOrderId",
  'LEGACY_PAID', g."targetState",
  'legacy_paid_graph_aligned',
  jsonb_build_object('migration', '20260730190000'),
  'migration:legacy-paid:' || g."serviceOrderId",
  coalesce(g."sessionId", '-') || ':' || g."serviceOrderId" || ':' ||
    coalesce(g."infrastructureOrderId", '-'),
  greatest(g."targetRevision" - 1, 0), g."targetRevision"
FROM "_AbrchinPaidLegacyGraph" g
ON CONFLICT ("idempotencyKey") DO NOTHING;

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
    "observedNetworkId" TEXT,
    "expectedSecurityId" TEXT,
    "observedSecurityId" TEXT,
    "providerObservedAt" TIMESTAMP(3),
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
