-- Forward-only V6 recovery. V1-V5 migrations are immutable.
--
-- This migration aligns legacy checkout semantic mapping with the runtime
-- state machine, repairs only monotonic revisions, and adds durable command
-- and health-retry dispatch storage. It never updates financial/provider
-- snapshots, Wallet, Ledger, Payment, amount, or paidAt.

ALTER TABLE "AdminCommandReceipt"
  ALTER COLUMN "infrastructureOrderId" DROP NOT NULL,
  ADD COLUMN "serviceOrderId" TEXT;

ALTER TABLE "AdminCommandReceipt"
  ADD CONSTRAINT "AdminCommandReceipt_serviceOrderId_fkey"
  FOREIGN KEY ("serviceOrderId") REFERENCES "ServiceOrder"(id)
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "AdminCommandReceipt_serviceOrderId_operation_createdAt_idx"
  ON "AdminCommandReceipt"("serviceOrderId", operation, "createdAt");

CREATE TABLE "HealthRetryDispatch" (
  id TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "infrastructureOrderId" TEXT NOT NULL,
  "sourceHealthCheckId" TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "dispatchedJobId" TEXT,
  "lastError" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HealthRetryDispatch_pkey" PRIMARY KEY (id),
  CONSTRAINT "HealthRetryDispatch_infrastructureOrderId_fkey"
    FOREIGN KEY ("infrastructureOrderId")
    REFERENCES "InfrastructureOrder"(id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "HealthRetryDispatch_idempotencyKey_key"
  ON "HealthRetryDispatch"("idempotencyKey");
CREATE UNIQUE INDEX
  "HealthRetryDispatch_infrastructureOrderId_sourceHealthCheckId_key"
  ON "HealthRetryDispatch"(
    "infrastructureOrderId", "sourceHealthCheckId"
  );
CREATE INDEX "HealthRetryDispatch_status_createdAt_idx"
  ON "HealthRetryDispatch"(status, "createdAt");
CREATE INDEX "HealthRetryDispatch_infrastructureOrderId_createdAt_idx"
  ON "HealthRetryDispatch"("infrastructureOrderId", "createdAt");

-- PENDING_PAYMENT legitimately occurs in AWAITING_PAYMENT, PAYMENT_REVIEW,
-- and QUOTE_EXPIRED. PAYMENT_REVIEW is a non-payable review state; runtime
-- must transition it back to AWAITING_PAYMENT (or PAID) before payment.
CREATE TEMP TABLE "_AbrchinV6LiveOwner" ON COMMIT DROP AS
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
  CASE so.status::TEXT
    WHEN 'DRAFT' THEN so."productFlowState" IN (
      'DRAFT', 'UNDERSTANDING_CONFIRMED', 'REQUIREMENTS_COMPLETE',
      'RECOMMENDED', 'PARCHIN_SELECTED', 'DELIVERY_CONFIGURED',
      'QUOTED', 'AUTH_REQUIRED', 'QUOTE_EXPIRED'
    )
    WHEN 'PENDING_PAYMENT' THEN so."productFlowState" IN (
      'AWAITING_PAYMENT', 'PAYMENT_REVIEW', 'QUOTE_EXPIRED'
    )
    WHEN 'PAID' THEN so."productFlowState" IN (
      'PAID', 'PROVISIONING_SUBMITTED', 'PROVISIONING',
      'HEALTH_CHECKING', 'HEALTH_CHECK_FAILED',
      'PROVISIONING_RETRYABLE', 'PROVISIONING_RECONCILING',
      'PROVISIONING_MANUAL_REVIEW', 'DELIVERED',
      'DELIVERY_RETRYABLE', 'ACTIVE'
    )
    ELSE FALSE
  END AS "serviceSemanticValid",
  (
    io.id IS NULL OR (
      io."productFlowState" = so."productFlowState"
      AND CASE io.status::TEXT
        WHEN 'WAITING_ADMIN_FUNDING' THEN io."productFlowState" IN (
          'PAID', 'PROVISIONING_MANUAL_REVIEW'
        )
        WHEN 'FUNDING_CONFIRMED' THEN
          io."productFlowState" = 'PROVISIONING_SUBMITTED'
        WHEN 'QUEUED' THEN
          io."productFlowState" = 'PROVISIONING_SUBMITTED'
        WHEN 'PROVISIONING' THEN io."productFlowState" IN (
          'PROVISIONING', 'HEALTH_CHECKING', 'HEALTH_CHECK_FAILED',
          'DELIVERED', 'DELIVERY_RETRYABLE'
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

CREATE TEMP TABLE "_AbrchinV6Graph" ON COMMIT DROP AS
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
        OR owner."infrastructureOrderState" = owner."serviceOrderState"
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
  FROM "_AbrchinV6LiveOwner" owner
  GROUP BY owner."sessionId"
)
SELECT
  rollup.*,
  coalesce((
    SELECT max(greatest(t."fromRevision", t."toRevision"))
    FROM "ProductFlowTransition" t
    WHERE t."recommendationSessionId" = rollup."sessionId"
       OR t."serviceOrderId" IN (
         SELECT live."serviceOrderId"
         FROM "_AbrchinV6LiveOwner" live
         WHERE live."sessionId" = rollup."sessionId"
       )
       OR t."infrastructureOrderId" IN (
         SELECT live."infrastructureOrderId"
         FROM "_AbrchinV6LiveOwner" live
         WHERE live."sessionId" = rollup."sessionId"
           AND live."infrastructureOrderId" IS NOT NULL
       )
  ), 0) AS "maxTransitionRevision",
  EXISTS (
    SELECT 1
    FROM "ProductFlowRemediationCase" remediation
    WHERE remediation."recommendationSessionId" = rollup."sessionId"
      AND remediation."idempotencyKey" =
        'migration:v5:manual:' || rollup."sessionId"
      AND remediation.status = 'OPEN'
  ) AS "hasOpenV5Case",
  EXISTS (
    SELECT 1
    FROM "ProductFlowTransition" v4
    WHERE v4."idempotencyKey" =
      'migration:v4:session-restore:' || rollup."sessionId"
      AND v4."toRevision" <= v4."fromRevision"
  ) AS "hasV4RevisionRegression"
FROM rollup;

CREATE TEMP TABLE "_AbrchinV6Recoverable" ON COMMIT DROP AS
SELECT
  graph.*,
  greatest(
    graph."maxOwnerRevision", graph."maxTransitionRevision"
  ) + 1 AS "targetRevision"
FROM "_AbrchinV6Graph" graph
WHERE graph."hasOpenV5Case"
  AND graph."liveStateSignatureCount" = 1
  AND graph."ownerStatesAligned"
  AND graph."semanticValid"
  AND graph."liveState" IS NOT NULL
  AND graph."sessionState" = graph."liveState";

CREATE TEMP TABLE "_AbrchinV6SessionBefore" ON COMMIT DROP AS
SELECT
  graph."sessionId", graph."sessionState", graph."sessionRevision",
  graph."liveState", graph."targetRevision",
  graph."maxOwnerRevision", graph."maxTransitionRevision"
FROM "_AbrchinV6Recoverable" graph;

CREATE TEMP TABLE "_AbrchinV6ServiceBefore" ON COMMIT DROP AS
SELECT
  live."sessionId", live."serviceOrderId",
  live."serviceOrderState", live."serviceOrderRevision",
  graph."targetRevision"
FROM "_AbrchinV6LiveOwner" live
JOIN "_AbrchinV6Recoverable" graph
  ON graph."sessionId" = live."sessionId";

CREATE TEMP TABLE "_AbrchinV6InfrastructureBefore" ON COMMIT DROP AS
SELECT
  live."sessionId", live."infrastructureOrderId",
  live."infrastructureOrderState", live."infrastructureOrderRevision",
  graph."targetRevision"
FROM "_AbrchinV6LiveOwner" live
JOIN "_AbrchinV6Recoverable" graph
  ON graph."sessionId" = live."sessionId"
WHERE live."infrastructureOrderId" IS NOT NULL;

UPDATE "RecommendationSession" session
SET "productFlowState" = before."liveState",
    "productFlowRevision" = before."targetRevision"
FROM "_AbrchinV6SessionBefore" before
WHERE session.id = before."sessionId"
  AND before."targetRevision" > session."productFlowRevision";

UPDATE "ServiceOrder" service_order
SET "productFlowState" = before."serviceOrderState",
    "productFlowRevision" = before."targetRevision"
FROM "_AbrchinV6ServiceBefore" before
WHERE service_order.id = before."serviceOrderId"
  AND before."targetRevision" > service_order."productFlowRevision";

UPDATE "InfrastructureOrder" infrastructure_order
SET "productFlowState" = before."infrastructureOrderState",
    "productFlowRevision" = before."targetRevision"
FROM "_AbrchinV6InfrastructureBefore" before
WHERE infrastructure_order.id = before."infrastructureOrderId"
  AND before."targetRevision" >
    infrastructure_order."productFlowRevision";

INSERT INTO "ProductFlowTransition" (
  id, "recommendationSessionId", "serviceOrderId",
  "infrastructureOrderId", "fromState", "toState", reason,
  metadata, "idempotencyKey", "ownerFingerprint",
  "fromRevision", "toRevision"
)
SELECT
  'migration:v6:session-revision:' || before."sessionId",
  before."sessionId", NULL, NULL,
  before."sessionState", before."liveState",
  'v5_semantic_mapping_repaired',
  jsonb_build_object(
    'migration', '20260731120000',
    'scope', 'recommendation_session',
    'evidence', CASE
      WHEN before."liveState" = 'PAYMENT_REVIEW'
        THEN 'pending_payment_payment_review_runtime_valid'
      WHEN before."liveState" = 'QUOTE_EXPIRED'
        THEN 'pending_payment_quote_expired_runtime_valid'
      ELSE 'runtime_semantic_mapping_valid'
    END,
    'maxOwnerRevision', before."maxOwnerRevision",
    'maxTransitionRevision', before."maxTransitionRevision",
    'financialDataChanged', false
  ),
  'migration:v6:session-revision:' || before."sessionId",
  before."sessionId" || ':-:-',
  before."sessionRevision", before."targetRevision"
FROM "_AbrchinV6SessionBefore" before
WHERE before."targetRevision" > before."sessionRevision"
ON CONFLICT ("idempotencyKey") DO NOTHING;

INSERT INTO "ProductFlowTransition" (
  id, "recommendationSessionId", "serviceOrderId",
  "infrastructureOrderId", "fromState", "toState", reason,
  metadata, "idempotencyKey", "ownerFingerprint",
  "fromRevision", "toRevision"
)
SELECT
  'migration:v6:service-revision:' || before."serviceOrderId",
  NULL, before."serviceOrderId", NULL,
  before."serviceOrderState", before."serviceOrderState",
  'v5_semantic_mapping_repaired',
  jsonb_build_object(
    'migration', '20260731120000',
    'scope', 'live_service_order',
    'evidence', CASE
      WHEN before."serviceOrderState" = 'PAYMENT_REVIEW'
        THEN 'pending_payment_payment_review_runtime_valid'
      WHEN before."serviceOrderState" = 'QUOTE_EXPIRED'
        THEN 'pending_payment_quote_expired_runtime_valid'
      ELSE 'runtime_semantic_mapping_valid'
    END,
    'financialDataChanged', false
  ),
  'migration:v6:service-revision:' || before."serviceOrderId",
  '-:' || before."serviceOrderId" || ':-',
  before."serviceOrderRevision", before."targetRevision"
FROM "_AbrchinV6ServiceBefore" before
WHERE before."targetRevision" > before."serviceOrderRevision"
ON CONFLICT ("idempotencyKey") DO NOTHING;

INSERT INTO "ProductFlowTransition" (
  id, "recommendationSessionId", "serviceOrderId",
  "infrastructureOrderId", "fromState", "toState", reason,
  metadata, "idempotencyKey", "ownerFingerprint",
  "fromRevision", "toRevision"
)
SELECT
  'migration:v6:infrastructure-revision:' ||
    before."infrastructureOrderId",
  NULL, NULL, before."infrastructureOrderId",
  before."infrastructureOrderState", before."infrastructureOrderState",
  'v5_semantic_mapping_repaired',
  jsonb_build_object(
    'migration', '20260731120000',
    'scope', 'live_infrastructure_order',
    'evidence', CASE
      WHEN before."infrastructureOrderState" = 'PAYMENT_REVIEW'
        THEN 'pending_payment_payment_review_runtime_valid'
      WHEN before."infrastructureOrderState" = 'QUOTE_EXPIRED'
        THEN 'pending_payment_quote_expired_runtime_valid'
      ELSE 'runtime_semantic_mapping_valid'
    END,
    'financialDataChanged', false
  ),
  'migration:v6:infrastructure-revision:' ||
    before."infrastructureOrderId",
  '-:-:' || before."infrastructureOrderId",
  before."infrastructureOrderRevision", before."targetRevision"
FROM "_AbrchinV6InfrastructureBefore" before
WHERE before."targetRevision" > before."infrastructureOrderRevision"
ON CONFLICT ("idempotencyKey") DO NOTHING;

-- Resolve only the exact V5 case whose graph was deterministically repaired.
UPDATE "ProductFlowRemediationCase" remediation
SET status = 'RESOLVED',
    "resolvedAt" = CURRENT_TIMESTAMP,
    evidence = remediation.evidence || jsonb_build_object(
      'resolvedByMigration', '20260731120000',
      'resolution', 'runtime_semantic_mapping_confirmed',
      'financialDataChanged', false,
      'resolvedAt', CURRENT_TIMESTAMP
    )
FROM "_AbrchinV6Recoverable" repaired
WHERE remediation."recommendationSessionId" = repaired."sessionId"
  AND remediation."idempotencyKey" =
    'migration:v5:manual:' || repaired."sessionId"
  AND remediation.status = 'OPEN';
