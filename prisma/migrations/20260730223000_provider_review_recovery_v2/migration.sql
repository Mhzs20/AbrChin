-- Forward-only remediation for the second provider-flow review.
-- This migration intentionally does not rewrite 20260730190000 because that
-- migration may already be recorded in an environment.

ALTER TYPE "InfrastructureOrderStatus"
  ADD VALUE IF NOT EXISTS 'MANUAL_REVIEW';

ALTER TABLE "RecommendationSession"
  ADD COLUMN "catalogCheckoutIdempotencyKey" TEXT,
  ADD COLUMN "catalogCheckoutRequestHash" TEXT;

CREATE UNIQUE INDEX "RecommendationSession_catalogCheckoutIdempotencyKey_key"
  ON "RecommendationSession"("catalogCheckoutIdempotencyKey");

ALTER TABLE "AuditLog"
  ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "AuditLog_idempotencyKey_key"
  ON "AuditLog"("idempotencyKey");

ALTER TABLE "ProvisioningJob"
  ADD COLUMN "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "jobMetadata" JSONB;

CREATE INDEX "ProvisioningJob_status_availableAt_createdAt_idx"
  ON "ProvisioningJob"("status", "availableAt", "createdAt");

CREATE UNIQUE INDEX "ProvisioningJob_active_health_retry_key"
  ON "ProvisioningJob"("infrastructureOrderId")
  WHERE operation = 'health_check_retry'
    AND status IN ('QUEUED', 'RUNNING');

ALTER TABLE "InfrastructureHealthCheck"
  ADD COLUMN "topologyVerificationMode" TEXT NOT NULL
    DEFAULT 'STRICT_OBSERVED';

UPDATE "InfrastructureHealthCheck" hc
SET "topologyVerificationMode" =
  CASE
    WHEN io.provider = 'PARSPACK' THEN 'PROVIDER_MANAGED'
    ELSE 'STRICT_OBSERVED'
  END
FROM "InfrastructureOrder" io
WHERE io.id = hc."infrastructureOrderId";

ALTER TABLE "InfrastructureHealthCheck"
  ADD CONSTRAINT "InfrastructureHealthCheck_topology_mode_check"
  CHECK (
    "topologyVerificationMode" IN (
      'STRICT_OBSERVED',
      'PROVIDER_MANAGED'
    )
  );

-- Evaluate checkout validity once per Session. DISTINCT ON and the explicit
-- ordering ensure PostgreSQL never produces competing UPDATE ... FROM rows.
CREATE TEMP TABLE "_AbrchinV2ValidCheckoutGraph" ON COMMIT DROP AS
WITH candidates AS (
  SELECT
    q.id AS "quoteId",
    q."sessionId",
    so.id AS "serviceOrderId",
    q."deliveryConfigurationSnapshot",
    row_number() OVER (
      PARTITION BY q."sessionId"
      ORDER BY
        CASE WHEN q.status = 'SELECTED' THEN 0 ELSE 1 END,
        q."selectedAt" DESC NULLS LAST,
        q."createdAt" DESC,
        q.id
    ) AS rank
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
    AND q."deliveryConfigurationSnapshot"->>'providerApiVersion' =
      q."providerApiVersion"
    AND q."deliveryConfigurationSnapshot"->>'productKind' =
      q."productKind"::text
    AND q."deliveryConfigurationSnapshot"->>'region' = q."providerRegion"
    AND q."deliveryConfigurationSnapshot"->>'externalPlanId' =
      q."externalPlanId"
    AND q."deliveryConfigurationSnapshot"->>'externalImageId' =
      q."externalImageId"
    AND q."deliveryConfigurationSnapshot"->>'accessMethod'
      IN ('SSH_KEY', 'ONE_TIME_PASSWORD', 'WINDOWS_PASSWORD')
    AND (
      (
        q.provider = 'ARVAN'
        AND q."externalNetworkId" IS NOT NULL
        AND q."externalSecurityId" IS NOT NULL
        AND q."deliveryConfigurationSnapshot"->>'externalNetworkId' =
          q."externalNetworkId"
        AND q."deliveryConfigurationSnapshot"->>'externalSecurityId' =
          q."externalSecurityId"
      )
      OR
      (
        q.provider = 'PARSPACK'
        AND (
          (
            q."externalNetworkId" = 'provider-default'
            AND q."externalSecurityId" = 'provider-default'
            AND q."deliveryConfigurationSnapshot"->>'externalNetworkId' =
              'provider-default'
            AND q."deliveryConfigurationSnapshot"->>'externalSecurityId' =
              'provider-default'
          )
          OR
          (
            q."externalNetworkId" IS NULL
            AND q."externalSecurityId" IS NULL
            AND q."deliveryConfigurationSnapshot"->>
              'topologyVerificationMode' = 'PROVIDER_MANAGED'
          )
        )
      )
    )
)
SELECT
  c."quoteId",
  c."sessionId",
  c."serviceOrderId",
  c."deliveryConfigurationSnapshot",
  CASE
    WHEN s."productFlowState" = 'AWAITING_PAYMENT'
      AND so."productFlowState" = 'AWAITING_PAYMENT'
      AND s."productFlowRevision" = so."productFlowRevision"
    THEN s."productFlowRevision"
    ELSE greatest(
      s."productFlowRevision",
      so."productFlowRevision"
    ) + 1
  END AS "targetRevision"
FROM candidates c
JOIN "RecommendationSession" s ON s.id = c."sessionId"
JOIN "ServiceOrder" so ON so.id = c."serviceOrderId"
WHERE c.rank = 1;

UPDATE "RecommendationSession" s
SET "productFlowState" = 'AWAITING_PAYMENT',
    "productFlowRevision" = g."targetRevision",
    "deliveryConfiguration" = g."deliveryConfigurationSnapshot"
FROM "_AbrchinV2ValidCheckoutGraph" g
WHERE s.id = g."sessionId";

UPDATE "ServiceOrder" so
SET "productFlowState" = 'AWAITING_PAYMENT',
    "productFlowRevision" = g."targetRevision"
FROM "_AbrchinV2ValidCheckoutGraph" g
WHERE so.id = g."serviceOrderId";

UPDATE "RecommendationQuote" q
SET status = 'SELECTED'
FROM "_AbrchinV2ValidCheckoutGraph" g
WHERE q.id = g."quoteId";

-- Sibling comparison Quotes are not part of the selected checkout graph.
-- Their invalidation must not change Session state, revision, or delivery.
UPDATE "RecommendationQuote" q
SET status =
  CASE
    WHEN q."expiresAt" <= CURRENT_TIMESTAMP
      THEN 'EXPIRED'::"RecommendationQuoteStatus"
    ELSE 'INVALIDATED'::"RecommendationQuoteStatus"
  END
FROM "_AbrchinV2ValidCheckoutGraph" g
WHERE q."sessionId" = g."sessionId"
  AND q.id <> g."quoteId"
  AND q.status IN ('ACTIVE', 'SELECTED');

UPDATE "ServiceOrder" so
SET status = 'DRAFT',
    "productFlowState" = 'REQUIREMENTS_COMPLETE',
    "productFlowRevision" = g."targetRevision"
FROM "RecommendationQuote" q
JOIN "_AbrchinV2ValidCheckoutGraph" g
  ON g."sessionId" = q."sessionId"
WHERE so."recommendationQuoteId" = q.id
  AND q.id <> g."quoteId"
  AND so.status <> 'PAID';

INSERT INTO "ProductFlowTransition" (
  id, "recommendationSessionId", "serviceOrderId",
  "fromState", "toState", reason, metadata, "idempotencyKey",
  "ownerFingerprint", "fromRevision", "toRevision"
)
SELECT
  'migration:v2:checkout:' || g."sessionId",
  g."sessionId", g."serviceOrderId",
  'LEGACY_CHECKOUT_GRAPH', 'AWAITING_PAYMENT',
  'legacy_checkout_graph_aligned',
  jsonb_build_object(
    'migration', '20260730223000',
    'selectedQuoteId', g."quoteId",
    'scope', 'session_checkout_graph'
  ),
  'migration:v2:checkout:' || g."sessionId",
  g."sessionId" || ':' || g."serviceOrderId" || ':-',
  greatest(g."targetRevision" - 1, 0),
  g."targetRevision"
FROM "_AbrchinV2ValidCheckoutGraph" g
ON CONFLICT ("idempotencyKey") DO NOTHING;

-- Invalid checkout remediation is also one row per Session. It includes
-- Sessions already partially remediated by the prior migration so revisions
-- can be deterministically re-aligned.
CREATE TEMP TABLE "_AbrchinV2InvalidCheckoutGraph" ON COMMIT DROP AS
WITH invalid_sessions AS (
  SELECT DISTINCT q."sessionId"
  FROM "RecommendationQuote" q
  JOIN "RecommendationSession" s ON s.id = q."sessionId"
  LEFT JOIN "_AbrchinV2ValidCheckoutGraph" valid
    ON valid."sessionId" = q."sessionId"
  WHERE valid."sessionId" IS NULL
    AND q.status IN ('ACTIVE', 'SELECTED', 'INVALIDATED', 'EXPIRED')
    AND NOT EXISTS (
      SELECT 1
      FROM "RecommendationQuote" paid_q
      JOIN "ServiceOrder" paid_so
        ON paid_so."recommendationQuoteId" = paid_q.id
      WHERE paid_q."sessionId" = q."sessionId"
        AND paid_so.status = 'PAID'
    )
    AND (
      q.status IN ('ACTIVE', 'SELECTED')
      OR s."productFlowState" = 'REQUIREMENTS_COMPLETE'
    )
),
revision_rollup AS (
  SELECT
    invalid."sessionId",
    s."productFlowRevision" AS "sessionRevision",
    coalesce(max(so."productFlowRevision"), 0) AS "maxOrderRevision",
    bool_and(
      so.id IS NULL
      OR (
        so."productFlowState" = 'REQUIREMENTS_COMPLETE'
        AND so.status = 'DRAFT'
        AND so."productFlowRevision" = s."productFlowRevision"
      )
    ) AS aligned
  FROM invalid_sessions invalid
  JOIN "RecommendationSession" s ON s.id = invalid."sessionId"
  LEFT JOIN "RecommendationQuote" q ON q."sessionId" = invalid."sessionId"
  LEFT JOIN "ServiceOrder" so
    ON so."recommendationQuoteId" = q.id
    AND so.status <> 'PAID'
  GROUP BY invalid."sessionId", s."productFlowRevision"
)
SELECT
  r."sessionId",
  CASE
    WHEN r.aligned
      AND s."productFlowState" = 'REQUIREMENTS_COMPLETE'
    THEN r."sessionRevision"
    ELSE greatest(r."sessionRevision", r."maxOrderRevision") + 1
  END AS "targetRevision"
FROM revision_rollup r
JOIN "RecommendationSession" s ON s.id = r."sessionId";

UPDATE "RecommendationQuote" q
SET status =
  CASE
    WHEN q."expiresAt" <= CURRENT_TIMESTAMP
      THEN 'EXPIRED'::"RecommendationQuoteStatus"
    ELSE 'INVALIDATED'::"RecommendationQuoteStatus"
  END
FROM "_AbrchinV2InvalidCheckoutGraph" g
WHERE q."sessionId" = g."sessionId"
  AND q.status IN ('ACTIVE', 'SELECTED');

UPDATE "RecommendationSession" s
SET "productFlowState" = 'REQUIREMENTS_COMPLETE',
    "productFlowRevision" = g."targetRevision",
    "deliveryConfiguration" = NULL
FROM "_AbrchinV2InvalidCheckoutGraph" g
WHERE s.id = g."sessionId";

UPDATE "ServiceOrder" so
SET status = 'DRAFT',
    "productFlowState" = 'REQUIREMENTS_COMPLETE',
    "productFlowRevision" = g."targetRevision"
FROM "RecommendationQuote" q
JOIN "_AbrchinV2InvalidCheckoutGraph" g
  ON g."sessionId" = q."sessionId"
WHERE so."recommendationQuoteId" = q.id
  AND so.status <> 'PAID';

INSERT INTO "ProductFlowTransition" (
  id, "recommendationSessionId",
  "fromState", "toState", reason, metadata, "idempotencyKey",
  "ownerFingerprint", "fromRevision", "toRevision"
)
SELECT
  'migration:v2:invalid:' || g."sessionId",
  g."sessionId",
  'LEGACY_UNPAID_GRAPH', 'REQUIREMENTS_COMPLETE',
  'legacy_checkout_requires_reselection',
  jsonb_build_object(
    'migration', '20260730223000',
    'scope', 'session_checkout_graph'
  ),
  'migration:v2:invalid:' || g."sessionId",
  g."sessionId" || ':-:-',
  greatest(g."targetRevision" - 1, 0),
  g."targetRevision"
FROM "_AbrchinV2InvalidCheckoutGraph" g
ON CONFLICT ("idempotencyKey") DO NOTHING;

-- Paid financial rows remain immutable. Selection now includes state
-- mismatches on every graph owner, even when all revisions already match.
CREATE TEMP TABLE "_AbrchinV2PaidGraph" ON COMMIT DROP AS
WITH paid AS (
  SELECT
    so.id AS "serviceOrderId",
    q."sessionId",
    io.id AS "infrastructureOrderId",
    s."productFlowState" AS "sessionState",
    so."productFlowState" AS "serviceOrderState",
    io."productFlowState" AS "infrastructureOrderState",
    coalesce(s."productFlowRevision", 0) AS "sessionRevision",
    so."productFlowRevision" AS "serviceOrderRevision",
    coalesce(io."productFlowRevision", 0) AS "infrastructureOrderRevision",
    CASE
      WHEN io.status = 'ACTIVE' THEN 'ACTIVE'
      WHEN io.status = 'PROVISIONING' THEN 'PROVISIONING'
      WHEN io.status = 'NEEDS_RECONCILIATION'
        THEN 'PROVISIONING_RECONCILING'
      WHEN io.status = 'FAILED' THEN 'PROVISIONING_RETRYABLE'
      WHEN io.status IN ('FUNDING_CONFIRMED', 'QUEUED')
        THEN 'PROVISIONING_SUBMITTED'
      WHEN io.status IN ('CANCELED', 'REFUNDED') THEN 'CANCELLED'
      ELSE 'PAID'
    END AS "targetState"
  FROM "ServiceOrder" so
  LEFT JOIN "RecommendationQuote" q
    ON q.id = so."recommendationQuoteId"
  LEFT JOIN "RecommendationSession" s ON s.id = q."sessionId"
  LEFT JOIN "InfrastructureOrder" io ON io."serviceOrderId" = so.id
  WHERE so.status = 'PAID'
)
SELECT
  paid.*,
  greatest(
    paid."sessionRevision",
    paid."serviceOrderRevision",
    paid."infrastructureOrderRevision"
  ) + 1 AS "targetRevision"
FROM paid
WHERE paid."serviceOrderState" IS DISTINCT FROM paid."targetState"
   OR (
     paid."sessionId" IS NOT NULL
     AND paid."sessionState" IS DISTINCT FROM paid."targetState"
   )
   OR (
     paid."infrastructureOrderId" IS NOT NULL
     AND paid."infrastructureOrderState"
       IS DISTINCT FROM paid."targetState"
   )
   OR (
     paid."sessionId" IS NOT NULL
     AND paid."sessionRevision" <> paid."serviceOrderRevision"
   )
   OR (
     paid."infrastructureOrderId" IS NOT NULL
     AND paid."infrastructureOrderRevision" <>
       paid."serviceOrderRevision"
   );

UPDATE "RecommendationSession" s
SET "productFlowState" = g."targetState",
    "productFlowRevision" = g."targetRevision"
FROM "_AbrchinV2PaidGraph" g
WHERE s.id = g."sessionId";

UPDATE "ServiceOrder" so
SET "productFlowState" = g."targetState",
    "productFlowRevision" = g."targetRevision"
FROM "_AbrchinV2PaidGraph" g
WHERE so.id = g."serviceOrderId";

UPDATE "InfrastructureOrder" io
SET "productFlowState" = g."targetState",
    "productFlowRevision" = g."targetRevision"
FROM "_AbrchinV2PaidGraph" g
WHERE io.id = g."infrastructureOrderId";

INSERT INTO "ProductFlowTransition" (
  id, "recommendationSessionId", "serviceOrderId",
  "infrastructureOrderId", "fromState", "toState", reason,
  metadata, "idempotencyKey", "ownerFingerprint",
  "fromRevision", "toRevision"
)
SELECT
  'migration:v2:paid:' || g."serviceOrderId",
  g."sessionId", g."serviceOrderId", g."infrastructureOrderId",
  'LEGACY_PAID_GRAPH', g."targetState",
  'legacy_paid_graph_state_aligned',
  jsonb_build_object(
    'migration', '20260730223000',
    'financialDataChanged', false
  ),
  'migration:v2:paid:' || g."serviceOrderId",
  coalesce(g."sessionId", '-') || ':' || g."serviceOrderId" || ':' ||
    coalesce(g."infrastructureOrderId", '-'),
  greatest(g."targetRevision" - 1, 0),
  g."targetRevision"
FROM "_AbrchinV2PaidGraph" g
ON CONFLICT ("idempotencyKey") DO NOTHING;
