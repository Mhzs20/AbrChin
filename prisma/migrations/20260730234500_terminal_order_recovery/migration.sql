-- Forward-only terminal order protection and evidence-based legacy recovery.
-- The two prior review migrations remain immutable because they may already
-- have been deployed. This migration never updates Wallet, ledger amounts,
-- payment records, paidAt, Quote snapshots, or provider snapshots.

-- A health retry and a human-approved manual recovery must never run
-- concurrently for the same InfrastructureOrder.
CREATE UNIQUE INDEX "ProvisioningJob_active_health_operation_key"
  ON "ProvisioningJob"("infrastructureOrderId")
  WHERE operation IN (
    'health_check_retry',
    'health_check_manual_recovery'
  )
    AND status IN ('QUEUED', 'RUNNING');

-- Recover REFUNDED only from a completed REFUND that reverses the completed
-- SERVICE_PURCHASE debit for the exact ServiceOrder. Stronger wallet,
-- direction, and amount checks reject unrelated or malformed ledger rows.
CREATE TEMP TABLE "_AbrchinV3RefundedGraph" ON COMMIT DROP AS
WITH refund_evidence AS (
  SELECT DISTINCT ON (so.id)
    so.id AS "serviceOrderId"
  FROM "ServiceOrder" so
  JOIN "WalletLedgerEntry" debit
    ON debit.type = 'SERVICE_PURCHASE'
   AND debit.status = 'COMPLETED'
   AND debit.direction = 'DEBIT'
   AND debit."referenceType" = 'order'
   AND debit."referenceId" = so.id
  JOIN "WalletLedgerEntry" refund
    ON refund.type = 'REFUND'
   AND refund.status = 'COMPLETED'
   AND refund.direction = 'CREDIT'
   AND refund."reversedEntryId" = debit.id
   AND refund."walletId" = debit."walletId"
   AND refund.amount = debit.amount
  ORDER BY so.id, refund."createdAt", refund.id
),
graph AS (
  SELECT
    so.id AS "serviceOrderId",
    q."sessionId",
    io.id AS "infrastructureOrderId",
    so.status AS "serviceOrderStatus",
    so."productFlowState" AS "serviceOrderState",
    so."productFlowRevision" AS "serviceOrderRevision",
    s."productFlowState" AS "sessionState",
    coalesce(s."productFlowRevision", 0) AS "sessionRevision",
    io.status AS "infrastructureOrderStatus",
    io."productFlowState" AS "infrastructureOrderState",
    coalesce(io."productFlowRevision", 0) AS "infrastructureOrderRevision"
  FROM refund_evidence evidence
  JOIN "ServiceOrder" so ON so.id = evidence."serviceOrderId"
  LEFT JOIN "RecommendationQuote" q
    ON q.id = so."recommendationQuoteId"
  LEFT JOIN "RecommendationSession" s ON s.id = q."sessionId"
  LEFT JOIN "InfrastructureOrder" io ON io."serviceOrderId" = so.id
)
SELECT
  graph.*,
  CASE
    WHEN graph."serviceOrderStatus" = 'REFUNDED'
     AND graph."serviceOrderState" = 'CANCELLED'
     AND (
       graph."sessionId" IS NULL
       OR (
         graph."sessionState" = 'CANCELLED'
         AND graph."sessionRevision" = graph."serviceOrderRevision"
       )
     )
     AND (
       graph."infrastructureOrderId" IS NULL
       OR (
         graph."infrastructureOrderStatus" = 'REFUNDED'
         AND graph."infrastructureOrderState" = 'CANCELLED'
         AND graph."infrastructureOrderRevision" =
           graph."serviceOrderRevision"
       )
     )
    THEN graph."serviceOrderRevision"
    ELSE greatest(
      graph."serviceOrderRevision",
      graph."sessionRevision",
      graph."infrastructureOrderRevision"
    ) + 1
  END AS "targetRevision"
FROM graph;

UPDATE "RecommendationSession" s
SET "productFlowState" = 'CANCELLED',
    "productFlowRevision" = graph."targetRevision"
FROM "_AbrchinV3RefundedGraph" graph
WHERE s.id = graph."sessionId";

UPDATE "ServiceOrder" so
SET status = 'REFUNDED',
    "productFlowState" = 'CANCELLED',
    "productFlowRevision" = graph."targetRevision"
FROM "_AbrchinV3RefundedGraph" graph
WHERE so.id = graph."serviceOrderId";

UPDATE "InfrastructureOrder" io
SET status = 'REFUNDED',
    "productFlowState" = 'CANCELLED',
    "productFlowRevision" = graph."targetRevision"
FROM "_AbrchinV3RefundedGraph" graph
WHERE io.id = graph."infrastructureOrderId";

INSERT INTO "ProductFlowTransition" (
  id, "recommendationSessionId", "serviceOrderId",
  "infrastructureOrderId", "fromState", "toState", reason,
  metadata, "idempotencyKey", "ownerFingerprint",
  "fromRevision", "toRevision"
)
SELECT
  'migration:v3:refund:' || graph."serviceOrderId",
  graph."sessionId",
  graph."serviceOrderId",
  graph."infrastructureOrderId",
  coalesce(graph."serviceOrderState", 'LEGACY_REFUND_EVIDENCE'),
  'CANCELLED',
  'legacy_refund_evidence_recovered',
  jsonb_build_object(
    'migration', '20260730234500',
    'evidence', 'completed_refund_reverses_completed_purchase',
    'financialDataChanged', false
  ),
  'migration:v3:refund:' || graph."serviceOrderId",
  coalesce(graph."sessionId", '-') || ':' ||
    graph."serviceOrderId" || ':' ||
    coalesce(graph."infrastructureOrderId", '-'),
  greatest(graph."targetRevision" - 1, 0),
  graph."targetRevision"
FROM "_AbrchinV3RefundedGraph" graph
ON CONFLICT ("idempotencyKey") DO NOTHING;

-- CANCELED recovery is intentionally narrower. An InfrastructureOrder that is
-- itself terminal CANCELED is accepted as deterministic evidence. A paid or
-- refunded ServiceOrder is never reclassified from this evidence.
CREATE TEMP TABLE "_AbrchinV3CanceledGraph" ON COMMIT DROP AS
WITH graph AS (
  SELECT
    so.id AS "serviceOrderId",
    q."sessionId",
    io.id AS "infrastructureOrderId",
    so.status AS "serviceOrderStatus",
    so."productFlowState" AS "serviceOrderState",
    so."productFlowRevision" AS "serviceOrderRevision",
    s."productFlowState" AS "sessionState",
    coalesce(s."productFlowRevision", 0) AS "sessionRevision",
    io."productFlowState" AS "infrastructureOrderState",
    coalesce(io."productFlowRevision", 0) AS "infrastructureOrderRevision"
  FROM "InfrastructureOrder" io
  JOIN "ServiceOrder" so ON so.id = io."serviceOrderId"
  LEFT JOIN "RecommendationQuote" q
    ON q.id = so."recommendationQuoteId"
  LEFT JOIN "RecommendationSession" s ON s.id = q."sessionId"
  LEFT JOIN "_AbrchinV3RefundedGraph" refunded
    ON refunded."serviceOrderId" = so.id
  WHERE io.status = 'CANCELED'
    AND so.status IN ('DRAFT', 'PENDING_PAYMENT', 'CANCELED')
    AND refunded."serviceOrderId" IS NULL
)
SELECT
  graph.*,
  CASE
    WHEN graph."serviceOrderStatus" = 'CANCELED'
     AND graph."serviceOrderState" = 'CANCELLED'
     AND graph."infrastructureOrderState" = 'CANCELLED'
     AND graph."infrastructureOrderRevision" =
       graph."serviceOrderRevision"
     AND (
       graph."sessionId" IS NULL
       OR (
         graph."sessionState" = 'CANCELLED'
         AND graph."sessionRevision" = graph."serviceOrderRevision"
       )
     )
    THEN graph."serviceOrderRevision"
    ELSE greatest(
      graph."serviceOrderRevision",
      graph."sessionRevision",
      graph."infrastructureOrderRevision"
    ) + 1
  END AS "targetRevision"
FROM graph;

UPDATE "RecommendationSession" s
SET "productFlowState" = 'CANCELLED',
    "productFlowRevision" = graph."targetRevision"
FROM "_AbrchinV3CanceledGraph" graph
WHERE s.id = graph."sessionId";

UPDATE "ServiceOrder" so
SET status = 'CANCELED',
    "productFlowState" = 'CANCELLED',
    "productFlowRevision" = graph."targetRevision"
FROM "_AbrchinV3CanceledGraph" graph
WHERE so.id = graph."serviceOrderId";

UPDATE "InfrastructureOrder" io
SET "productFlowState" = 'CANCELLED',
    "productFlowRevision" = graph."targetRevision"
FROM "_AbrchinV3CanceledGraph" graph
WHERE io.id = graph."infrastructureOrderId";

INSERT INTO "ProductFlowTransition" (
  id, "recommendationSessionId", "serviceOrderId",
  "infrastructureOrderId", "fromState", "toState", reason,
  metadata, "idempotencyKey", "ownerFingerprint",
  "fromRevision", "toRevision"
)
SELECT
  'migration:v3:cancel:' || graph."serviceOrderId",
  graph."sessionId",
  graph."serviceOrderId",
  graph."infrastructureOrderId",
  coalesce(graph."serviceOrderState", 'LEGACY_CANCEL_EVIDENCE'),
  'CANCELLED',
  'legacy_cancel_evidence_recovered',
  jsonb_build_object(
    'migration', '20260730234500',
    'evidence', 'infrastructure_order_canceled',
    'financialDataChanged', false
  ),
  'migration:v3:cancel:' || graph."serviceOrderId",
  coalesce(graph."sessionId", '-') || ':' ||
    graph."serviceOrderId" || ':' ||
    graph."infrastructureOrderId",
  greatest(graph."targetRevision" - 1, 0),
  graph."targetRevision"
FROM "_AbrchinV3CanceledGraph" graph
ON CONFLICT ("idempotencyKey") DO NOTHING;

-- Enforce terminal immutability for all future application and migration
-- writes. PAID can only remain PAID or become REFUNDED. CANCELED and REFUNDED
-- cannot leave their terminal state.
CREATE OR REPLACE FUNCTION "abrchin_guard_service_order_terminal_status"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'PAID'
     AND NEW.status NOT IN ('PAID', 'REFUNDED') THEN
    RAISE EXCEPTION 'service_order_terminal_status_violation'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'REFUNDED' AND NEW.status <> 'REFUNDED' THEN
    RAISE EXCEPTION 'service_order_terminal_status_violation'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'CANCELED' AND NEW.status <> 'CANCELED' THEN
    RAISE EXCEPTION 'service_order_terminal_status_violation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "ServiceOrder_terminal_status_guard"
  ON "ServiceOrder";

CREATE TRIGGER "ServiceOrder_terminal_status_guard"
BEFORE UPDATE OF status ON "ServiceOrder"
FOR EACH ROW
EXECUTE FUNCTION "abrchin_guard_service_order_terminal_status"();
