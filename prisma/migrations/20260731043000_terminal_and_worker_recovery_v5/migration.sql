-- Forward-only V5 remediation. Earlier review migrations are immutable.
--
-- This migration repairs only the optimistic-concurrency revision regression
-- produced by the V3/V4 terminal recovery sequence. It never updates money,
-- Wallet, WalletLedgerEntry, PaymentTransaction, paidAt, quote financial
-- snapshots, planSnapshot, or providerSelectionSnapshot.

ALTER TABLE "ProvisioningJob"
  ADD COLUMN phase TEXT NOT NULL DEFAULT 'PROVIDER',
  ADD COLUMN "healthCheckId" TEXT,
  ADD COLUMN "healthResultSnapshot" JSONB,
  ADD COLUMN "healthResultPersistedAt" TIMESTAMP(3);

CREATE INDEX "ProvisioningJob_healthCheckId_idx"
  ON "ProvisioningJob"("healthCheckId");

CREATE TABLE "ProvisioningNotificationOutbox" (
  id TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "infrastructureOrderId" TEXT NOT NULL,
  type "AdminNotificationType" NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProvisioningNotificationOutbox_pkey" PRIMARY KEY (id),
  CONSTRAINT
    "ProvisioningNotificationOutbox_infrastructureOrderId_fkey"
    FOREIGN KEY ("infrastructureOrderId")
    REFERENCES "InfrastructureOrder"(id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX
  "ProvisioningNotificationOutbox_idempotencyKey_key"
  ON "ProvisioningNotificationOutbox"("idempotencyKey");
CREATE INDEX
  "ProvisioningNotificationOutbox_status_createdAt_idx"
  ON "ProvisioningNotificationOutbox"(status, "createdAt");
CREATE INDEX
  "ProvisioningNotificationOutbox_infrastructureOrderId_createdAt_idx"
  ON "ProvisioningNotificationOutbox"(
    "infrastructureOrderId", "createdAt"
  );

-- One row per live ServiceOrder. Semantic validation is deliberately stricter
-- than signature equality: a PAID order may be in a paid/provisioning state,
-- while PENDING_PAYMENT must be AWAITING_PAYMENT. Infrastructure status must
-- also agree with its ProductFlow state.
CREATE TEMP TABLE "_AbrchinV5LiveOwner" ON COMMIT DROP AS
SELECT
  s.id AS "sessionId",
  s."productFlowState" AS "sessionState",
  s."productFlowRevision" AS "sessionRevision",
  so.id AS "serviceOrderId",
  so.status::TEXT AS "serviceOrderStatus",
  so."productFlowState" AS "serviceOrderState",
  so."productFlowRevision" AS "serviceOrderRevision",
  io.id AS "infrastructureOrderId",
  io.status::TEXT AS "infrastructureOrderStatus",
  io."productFlowState" AS "infrastructureOrderState",
  io."productFlowRevision" AS "infrastructureOrderRevision",
  (
    CASE so.status::TEXT
      WHEN 'DRAFT' THEN so."productFlowState" IN (
        'DRAFT', 'UNDERSTANDING_CONFIRMED', 'REQUIREMENTS_COMPLETE',
        'RECOMMENDED', 'PARCHIN_SELECTED', 'DELIVERY_CONFIGURED',
        'QUOTED', 'AUTH_REQUIRED', 'QUOTE_EXPIRED'
      )
      WHEN 'PENDING_PAYMENT' THEN
        so."productFlowState" = 'AWAITING_PAYMENT'
      WHEN 'PAID' THEN so."productFlowState" IN (
        'PAID', 'PROVISIONING_SUBMITTED', 'PROVISIONING',
        'HEALTH_CHECKING', 'HEALTH_CHECK_FAILED',
        'PROVISIONING_RETRYABLE', 'PROVISIONING_RECONCILING',
        'PROVISIONING_MANUAL_REVIEW', 'DELIVERED',
        'DELIVERY_RETRYABLE', 'ACTIVE'
      )
      ELSE FALSE
    END
  ) AS "serviceSemanticValid",
  (
    io.id IS NULL OR (
      io."productFlowState" = so."productFlowState"
      AND CASE io.status::TEXT
        WHEN 'WAITING_ADMIN_FUNDING' THEN
          io."productFlowState" IN (
            'PAID', 'PROVISIONING_MANUAL_REVIEW'
          )
        WHEN 'FUNDING_CONFIRMED' THEN
          io."productFlowState" = 'PROVISIONING_SUBMITTED'
        WHEN 'QUEUED' THEN
          io."productFlowState" = 'PROVISIONING_SUBMITTED'
        WHEN 'PROVISIONING' THEN
          io."productFlowState" IN (
            'PROVISIONING', 'HEALTH_CHECKING',
            'HEALTH_CHECK_FAILED', 'DELIVERED',
            'DELIVERY_RETRYABLE'
          )
        WHEN 'ACTIVE' THEN io."productFlowState" = 'ACTIVE'
        WHEN 'BLOCKED_PROVIDER_BALANCE' THEN
          io."productFlowState" = 'PROVISIONING_MANUAL_REVIEW'
        WHEN 'NEEDS_RECONCILIATION' THEN
          io."productFlowState" = 'PROVISIONING_RECONCILING'
        WHEN 'MANUAL_REVIEW' THEN
          io."productFlowState" = 'PROVISIONING_MANUAL_REVIEW'
        WHEN 'FAILED' THEN io."productFlowState" IN (
          'PROVISIONING_RETRYABLE', 'PROVISIONING_MANUAL_REVIEW',
          'HEALTH_CHECK_FAILED'
        )
        ELSE FALSE
      END
    )
  ) AS "infrastructureSemanticValid"
FROM "RecommendationSession" s
JOIN "RecommendationQuote" q ON q."sessionId" = s.id
JOIN "ServiceOrder" so ON so."recommendationQuoteId" = q.id
LEFT JOIN "InfrastructureOrder" io ON io."serviceOrderId" = so.id
WHERE so.status NOT IN ('REFUNDED', 'CANCELED');

CREATE TEMP TABLE "_AbrchinV5SessionGraph" ON COMMIT DROP AS
WITH rollup AS (
  SELECT
    owner."sessionId",
    min(owner."sessionState") AS "sessionState",
    min(owner."sessionRevision") AS "sessionRevision",
    count(*)::INTEGER AS "liveOrderCount",
    count(DISTINCT owner."serviceOrderState")::INTEGER
      AS "liveStateSignatureCount",
    min(owner."serviceOrderState") AS "liveState",
    bool_and(
      owner."serviceOrderState" IS NOT NULL
      AND (
        owner."infrastructureOrderId" IS NULL
        OR owner."infrastructureOrderState" =
          owner."serviceOrderState"
      )
    ) AS "ownerStatesAligned",
    bool_and(
      owner."serviceSemanticValid"
      AND owner."infrastructureSemanticValid"
    ) AS "semanticValid",
    greatest(
      max(owner."sessionRevision"),
      max(owner."serviceOrderRevision"),
      coalesce(max(owner."infrastructureOrderRevision"), 0)
    ) AS "maxOwnerRevision"
  FROM "_AbrchinV5LiveOwner" owner
  GROUP BY owner."sessionId"
)
SELECT
  rollup.*,
  coalesce((
    SELECT max(greatest(
      transition."fromRevision",
      transition."toRevision"
    ))
    FROM "ProductFlowTransition" transition
    WHERE transition."recommendationSessionId" = rollup."sessionId"
       OR transition."serviceOrderId" IN (
         SELECT live."serviceOrderId"
         FROM "_AbrchinV5LiveOwner" live
         WHERE live."sessionId" = rollup."sessionId"
       )
       OR transition."infrastructureOrderId" IN (
         SELECT live."infrastructureOrderId"
         FROM "_AbrchinV5LiveOwner" live
         WHERE live."sessionId" = rollup."sessionId"
           AND live."infrastructureOrderId" IS NOT NULL
       )
  ), 0) AS "maxTransitionRevision",
  EXISTS (
    SELECT 1
    FROM "ProductFlowTransition" v4_transition
    WHERE v4_transition."idempotencyKey" =
      'migration:v4:session-restore:' || rollup."sessionId"
      AND v4_transition."toRevision" <=
        v4_transition."fromRevision"
  ) AS "hasV4RevisionRegression"
FROM rollup;

-- A single signature is not sufficient. Invalid status/state combinations,
-- owner-state disagreement, or multiple live states are manual cases.
INSERT INTO "ProductFlowRemediationCase" (
  id, "recommendationSessionId", reason, status, evidence,
  "idempotencyKey"
)
SELECT
  'migration:v5:manual:' || graph."sessionId",
  graph."sessionId",
  'live_graph_semantic_or_signature_conflict',
  'OPEN',
  jsonb_build_object(
    'migration', '20260731043000',
    'sessionState', graph."sessionState",
    'sessionRevision', graph."sessionRevision",
    'liveState', graph."liveState",
    'liveOrderCount', graph."liveOrderCount",
    'liveStateSignatureCount', graph."liveStateSignatureCount",
    'ownerStatesAligned', graph."ownerStatesAligned",
    'semanticValid', graph."semanticValid",
    'hasV4RevisionRegression', graph."hasV4RevisionRegression",
    'financialDataChanged', false
  ),
  'migration:v5:manual:' || graph."sessionId"
FROM "_AbrchinV5SessionGraph" graph
WHERE graph."liveStateSignatureCount" <> 1
   OR NOT graph."ownerStatesAligned"
   OR NOT graph."semanticValid"
   OR graph."sessionState" IS DISTINCT FROM graph."liveState"
ON CONFLICT ("idempotencyKey") DO NOTHING;

CREATE TEMP TABLE "_AbrchinV5RecoverableGraph" ON COMMIT DROP AS
SELECT
  graph.*,
  greatest(
    graph."maxOwnerRevision",
    graph."maxTransitionRevision"
  ) + 1 AS "targetRevision"
FROM "_AbrchinV5SessionGraph" graph
WHERE graph."hasV4RevisionRegression"
  AND graph."liveStateSignatureCount" = 1
  AND graph."ownerStatesAligned"
  AND graph."semanticValid"
  AND graph."liveState" IS NOT NULL
  AND graph."sessionState" = graph."liveState";

CREATE TEMP TABLE "_AbrchinV5SessionBefore" ON COMMIT DROP AS
SELECT
  graph."sessionId",
  graph."sessionState",
  graph."sessionRevision",
  graph."liveState",
  graph."targetRevision",
  graph."maxOwnerRevision",
  graph."maxTransitionRevision"
FROM "_AbrchinV5RecoverableGraph" graph;

CREATE TEMP TABLE "_AbrchinV5ServiceBefore" ON COMMIT DROP AS
SELECT
  live."sessionId",
  live."serviceOrderId",
  live."serviceOrderState",
  live."serviceOrderRevision",
  graph."targetRevision"
FROM "_AbrchinV5LiveOwner" live
JOIN "_AbrchinV5RecoverableGraph" graph
  ON graph."sessionId" = live."sessionId";

CREATE TEMP TABLE "_AbrchinV5InfrastructureBefore" ON COMMIT DROP AS
SELECT
  live."sessionId",
  live."infrastructureOrderId",
  live."infrastructureOrderState",
  live."infrastructureOrderRevision",
  graph."targetRevision"
FROM "_AbrchinV5LiveOwner" live
JOIN "_AbrchinV5RecoverableGraph" graph
  ON graph."sessionId" = live."sessionId"
WHERE live."infrastructureOrderId" IS NOT NULL;

UPDATE "RecommendationSession" session
SET "productFlowState" = before."liveState",
    "productFlowRevision" = before."targetRevision"
FROM "_AbrchinV5SessionBefore" before
WHERE session.id = before."sessionId"
  AND before."targetRevision" > before."sessionRevision";

UPDATE "ServiceOrder" service_order
SET "productFlowState" = before."serviceOrderState",
    "productFlowRevision" = before."targetRevision"
FROM "_AbrchinV5ServiceBefore" before
WHERE service_order.id = before."serviceOrderId"
  AND before."targetRevision" > before."serviceOrderRevision";

UPDATE "InfrastructureOrder" infrastructure_order
SET "productFlowState" = before."infrastructureOrderState",
    "productFlowRevision" = before."targetRevision"
FROM "_AbrchinV5InfrastructureBefore" before
WHERE infrastructure_order.id = before."infrastructureOrderId"
  AND before."targetRevision" >
    before."infrastructureOrderRevision";

INSERT INTO "ProductFlowTransition" (
  id, "recommendationSessionId", "serviceOrderId",
  "infrastructureOrderId", "fromState", "toState", reason,
  metadata, "idempotencyKey", "ownerFingerprint",
  "fromRevision", "toRevision"
)
SELECT
  'migration:v5:session-revision:' || before."sessionId",
  before."sessionId", NULL, NULL,
  before."sessionState", before."liveState",
  'v4_revision_regression_repaired',
  jsonb_build_object(
    'migration', '20260731043000',
    'scope', 'recommendation_session',
    'maxOwnerRevision', before."maxOwnerRevision",
    'maxTransitionRevision', before."maxTransitionRevision",
    'financialDataChanged', false
  ),
  'migration:v5:session-revision:' || before."sessionId",
  before."sessionId" || ':-:-',
  before."sessionRevision", before."targetRevision"
FROM "_AbrchinV5SessionBefore" before
WHERE before."targetRevision" > before."sessionRevision"
ON CONFLICT ("idempotencyKey") DO NOTHING;

INSERT INTO "ProductFlowTransition" (
  id, "recommendationSessionId", "serviceOrderId",
  "infrastructureOrderId", "fromState", "toState", reason,
  metadata, "idempotencyKey", "ownerFingerprint",
  "fromRevision", "toRevision"
)
SELECT
  'migration:v5:service-revision:' || before."serviceOrderId",
  NULL, before."serviceOrderId", NULL,
  before."serviceOrderState", before."serviceOrderState",
  'v4_revision_regression_repaired',
  jsonb_build_object(
    'migration', '20260731043000',
    'scope', 'live_service_order',
    'financialDataChanged', false
  ),
  'migration:v5:service-revision:' || before."serviceOrderId",
  '-:' || before."serviceOrderId" || ':-',
  before."serviceOrderRevision", before."targetRevision"
FROM "_AbrchinV5ServiceBefore" before
WHERE before."targetRevision" > before."serviceOrderRevision"
ON CONFLICT ("idempotencyKey") DO NOTHING;

INSERT INTO "ProductFlowTransition" (
  id, "recommendationSessionId", "serviceOrderId",
  "infrastructureOrderId", "fromState", "toState", reason,
  metadata, "idempotencyKey", "ownerFingerprint",
  "fromRevision", "toRevision"
)
SELECT
  'migration:v5:infrastructure-revision:' ||
    before."infrastructureOrderId",
  NULL, NULL, before."infrastructureOrderId",
  before."infrastructureOrderState",
  before."infrastructureOrderState",
  'v4_revision_regression_repaired',
  jsonb_build_object(
    'migration', '20260731043000',
    'scope', 'live_infrastructure_order',
    'financialDataChanged', false
  ),
  'migration:v5:infrastructure-revision:' ||
    before."infrastructureOrderId",
  '-:-:' || before."infrastructureOrderId",
  before."infrastructureOrderRevision",
  before."targetRevision"
FROM "_AbrchinV5InfrastructureBefore" before
WHERE before."targetRevision" >
  before."infrastructureOrderRevision"
ON CONFLICT ("idempotencyKey") DO NOTHING;
