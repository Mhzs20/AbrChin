-- Forward-only V4 remediation for multi-order RecommendationSessions,
-- attempt-scoped reconciliation, durable admin command receipts, and worker
-- fencing. The three earlier review migrations are intentionally immutable.
--
-- This migration never updates Wallet, WalletLedgerEntry, PaymentTransaction,
-- ServiceOrder.amount/paidAt/planSnapshot, RecommendationQuote financial
-- snapshots, or InfrastructureOrder.providerSelectionSnapshot.

ALTER TABLE "InfrastructureOrder"
  ADD COLUMN "reconcileNoResourceConfirmedJobId" TEXT,
  ADD COLUMN "reconcileNoResourceConfirmedAttempt" INTEGER;

ALTER TABLE "ProvisioningJob"
  ADD COLUMN "claimToken" TEXT;

CREATE INDEX "ProvisioningJob_id_claimToken_leaseExpiresAt_idx"
  ON "ProvisioningJob"("id", "claimToken", "leaseExpiresAt");

CREATE TABLE "AdminCommandReceipt" (
  id TEXT NOT NULL,
  operation TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "infrastructureOrderId" TEXT NOT NULL,
  "resultSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminCommandReceipt_pkey" PRIMARY KEY (id),
  CONSTRAINT "AdminCommandReceipt_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AdminCommandReceipt_infrastructureOrderId_fkey"
    FOREIGN KEY ("infrastructureOrderId") REFERENCES "InfrastructureOrder"(id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AdminCommandReceipt_idempotencyKey_key"
  ON "AdminCommandReceipt"("idempotencyKey");
CREATE INDEX "AdminCommandReceipt_actorUserId_createdAt_idx"
  ON "AdminCommandReceipt"("actorUserId", "createdAt");
CREATE INDEX
  "AdminCommandReceipt_infrastructureOrderId_operation_createdAt_idx"
  ON "AdminCommandReceipt"(
    "infrastructureOrderId", operation, "createdAt"
  );

CREATE TABLE "ProductFlowRemediationCase" (
  id TEXT NOT NULL,
  "recommendationSessionId" TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  evidence JSONB NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "ProductFlowRemediationCase_pkey" PRIMARY KEY (id),
  CONSTRAINT "ProductFlowRemediationCase_recommendationSessionId_fkey"
    FOREIGN KEY ("recommendationSessionId")
    REFERENCES "RecommendationSession"(id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProductFlowRemediationCase_idempotencyKey_key"
  ON "ProductFlowRemediationCase"("idempotencyKey");
CREATE INDEX "ProductFlowRemediationCase_status_createdAt_idx"
  ON "ProductFlowRemediationCase"(status, "createdAt");
CREATE INDEX
  "ProductFlowRemediationCase_recommendationSessionId_createdAt_idx"
  ON "ProductFlowRemediationCase"(
    "recommendationSessionId", "createdAt"
  );

-- Snapshot each Session once. A non-terminal sibling is recoverable only when
-- every non-terminal ServiceOrder and its optional InfrastructureOrder agree
-- on one exact state/revision. Contradictory siblings are never guessed.
CREATE TEMP TABLE "_AbrchinV4SessionGraph" ON COMMIT DROP AS
SELECT
  s.id AS "sessionId",
  s."productFlowState" AS "sessionState",
  s."productFlowRevision" AS "sessionRevision",
  count(so.id)::INTEGER AS "orderCount",
  count(so.id) FILTER (
    WHERE so.status NOT IN ('REFUNDED', 'CANCELED')
  )::INTEGER AS "nonTerminalCount",
  count(DISTINCT (
    so.status::TEXT || ':' ||
    coalesce(so."productFlowState", '<null>') || ':' ||
    so."productFlowRevision"::TEXT || ':' ||
    coalesce(io.status::TEXT, '<none>')
  )) FILTER (
    WHERE so.status NOT IN ('REFUNDED', 'CANCELED')
  )::INTEGER AS "nonTerminalSignatureCount",
  bool_and(
    CASE
      WHEN so.status NOT IN ('REFUNDED', 'CANCELED') THEN
        io.id IS NULL OR (
          io."productFlowState" = so."productFlowState"
          AND io."productFlowRevision" = so."productFlowRevision"
        )
      ELSE TRUE
    END
  ) AS "nonTerminalOwnersAligned",
  min(so."productFlowState") FILTER (
    WHERE so.status NOT IN ('REFUNDED', 'CANCELED')
  ) AS "nonTerminalState",
  min(so."productFlowRevision") FILTER (
    WHERE so.status NOT IN ('REFUNDED', 'CANCELED')
  ) AS "nonTerminalRevision",
  greatest(
    s."productFlowRevision",
    coalesce(max(so."productFlowRevision"), 0),
    coalesce(max(io."productFlowRevision"), 0)
  ) AS "maxGraphRevision",
  bool_and(
    so.id IS NULL OR (
      so.status IN ('REFUNDED', 'CANCELED')
      AND so."productFlowState" = 'CANCELLED'
      AND so."productFlowRevision" = s."productFlowRevision"
      AND (
        io.id IS NULL OR (
          io."productFlowState" = 'CANCELLED'
          AND io."productFlowRevision" = s."productFlowRevision"
        )
      )
    )
  ) AND s."productFlowState" = 'CANCELLED'
    AS "allTerminalGraphAligned"
FROM "RecommendationSession" s
LEFT JOIN "RecommendationQuote" q ON q."sessionId" = s.id
LEFT JOIN "ServiceOrder" so ON so."recommendationQuoteId" = q.id
LEFT JOIN "InfrastructureOrder" io ON io."serviceOrderId" = so.id
GROUP BY
  s.id, s."productFlowState", s."productFlowRevision";

-- Conflicting live siblings require human remediation. This is a durable,
-- idempotent audit record and deliberately changes no graph owner.
INSERT INTO "ProductFlowRemediationCase" (
  id, "recommendationSessionId", reason, status, evidence,
  "idempotencyKey"
)
SELECT
  'migration:v4:manual:' || graph."sessionId",
  graph."sessionId",
  'multi_order_non_terminal_graph_conflict',
  'OPEN',
  jsonb_build_object(
    'migration', '20260731003000',
    'sessionState', graph."sessionState",
    'sessionRevision', graph."sessionRevision",
    'nonTerminalCount', graph."nonTerminalCount",
    'nonTerminalSignatureCount',
      graph."nonTerminalSignatureCount",
    'nonTerminalOwnersAligned',
      graph."nonTerminalOwnersAligned",
    'financialDataChanged', false
  ),
  'migration:v4:manual:' || graph."sessionId"
FROM "_AbrchinV4SessionGraph" graph
WHERE graph."nonTerminalCount" > 0
  AND (
    graph."nonTerminalSignatureCount" <> 1
    OR NOT graph."nonTerminalOwnersAligned"
  )
ON CONFLICT ("idempotencyKey") DO NOTHING;

-- Repair only the Session state damaged by V3 when live siblings have one
-- deterministic graph signature. Healthy sibling owners are never updated.
CREATE TEMP TABLE "_AbrchinV4RecoverableSession" ON COMMIT DROP AS
SELECT *
FROM "_AbrchinV4SessionGraph" graph
WHERE graph."nonTerminalCount" > 0
  AND graph."nonTerminalSignatureCount" = 1
  AND graph."nonTerminalOwnersAligned"
  AND graph."nonTerminalState" IS NOT NULL
  AND graph."sessionState" = 'CANCELLED'
  AND (
    graph."sessionState" IS DISTINCT FROM graph."nonTerminalState"
    OR graph."sessionRevision" <> graph."nonTerminalRevision"
  );

UPDATE "RecommendationSession" session
SET "productFlowState" = graph."nonTerminalState",
    "productFlowRevision" = graph."nonTerminalRevision"
FROM "_AbrchinV4RecoverableSession" graph
WHERE session.id = graph."sessionId";

INSERT INTO "ProductFlowTransition" (
  id, "recommendationSessionId", "serviceOrderId",
  "infrastructureOrderId", "fromState", "toState", reason,
  metadata, "idempotencyKey", "ownerFingerprint",
  "fromRevision", "toRevision"
)
SELECT
  'migration:v4:session-restore:' || graph."sessionId",
  graph."sessionId",
  NULL,
  NULL,
  graph."sessionState",
  graph."nonTerminalState",
  'v3_terminal_scope_repaired_from_live_sibling',
  jsonb_build_object(
    'migration', '20260731003000',
    'scope', 'recommendation_session_only',
    'nonTerminalSiblingCount', graph."nonTerminalCount",
    'financialDataChanged', false
  ),
  'migration:v4:session-restore:' || graph."sessionId",
  graph."sessionId" || ':-:-',
  graph."sessionRevision",
  graph."nonTerminalRevision"
FROM "_AbrchinV4RecoverableSession" graph
ON CONFLICT ("idempotencyKey") DO NOTHING;

-- All-terminal Sessions are aligned as one graph. Already-correct graphs keep
-- their revision and receive no synthetic CANCELLED -> CANCELLED transition.
CREATE TEMP TABLE "_AbrchinV4AllTerminalSession" ON COMMIT DROP AS
SELECT
  graph.*,
  CASE
    WHEN graph."allTerminalGraphAligned"
      THEN graph."sessionRevision"
    ELSE graph."maxGraphRevision" + 1
  END AS "targetRevision",
  NOT graph."allTerminalGraphAligned" AS "needsAlignment"
FROM "_AbrchinV4SessionGraph" graph
WHERE graph."orderCount" > 0
  AND graph."nonTerminalCount" = 0;

-- Every terminal order is scoped independently unless its entire Session is
-- terminal. In mixed Sessions, recommendationSessionId is intentionally NULL
-- in the transition and the Session owner is not touched.
CREATE TEMP TABLE "_AbrchinV4TerminalOrder" ON COMMIT DROP AS
SELECT
  so.id AS "serviceOrderId",
  q."sessionId",
  io.id AS "infrastructureOrderId",
  so."productFlowState" AS "serviceOrderState",
  so."productFlowRevision" AS "serviceOrderRevision",
  io."productFlowState" AS "infrastructureOrderState",
  coalesce(io."productFlowRevision", 0) AS
    "infrastructureOrderRevision",
  all_terminal."sessionId" IS NOT NULL AS "allSessionTerminal",
  CASE
    WHEN all_terminal."sessionId" IS NOT NULL
      THEN all_terminal."targetRevision"
    WHEN so."productFlowState" = 'CANCELLED'
      AND (
        io.id IS NULL OR (
          io."productFlowState" = 'CANCELLED'
          AND io."productFlowRevision" = so."productFlowRevision"
        )
      )
      THEN so."productFlowRevision"
    ELSE greatest(
      so."productFlowRevision",
      coalesce(io."productFlowRevision", 0)
    ) + 1
  END AS "targetRevision",
  CASE
    WHEN all_terminal."sessionId" IS NOT NULL
      THEN (
        so."productFlowState" <> 'CANCELLED'
        OR so."productFlowRevision" <>
          all_terminal."targetRevision"
        OR (
          io.id IS NOT NULL AND (
            io."productFlowState" <> 'CANCELLED'
            OR io."productFlowRevision" <>
              all_terminal."targetRevision"
          )
        )
      )
    ELSE NOT (
      so."productFlowState" = 'CANCELLED'
      AND (
        io.id IS NULL OR (
          io."productFlowState" = 'CANCELLED'
          AND io."productFlowRevision" =
            so."productFlowRevision"
        )
      )
    )
  END AS "needsAlignment"
FROM "ServiceOrder" so
LEFT JOIN "RecommendationQuote" q
  ON q.id = so."recommendationQuoteId"
LEFT JOIN "InfrastructureOrder" io
  ON io."serviceOrderId" = so.id
LEFT JOIN "_AbrchinV4AllTerminalSession" all_terminal
  ON all_terminal."sessionId" = q."sessionId"
WHERE so.status IN ('REFUNDED', 'CANCELED');

UPDATE "RecommendationSession" session
SET "productFlowState" = 'CANCELLED',
    "productFlowRevision" = graph."targetRevision"
FROM "_AbrchinV4AllTerminalSession" graph
WHERE session.id = graph."sessionId"
  AND graph."needsAlignment";

UPDATE "ServiceOrder" service_order
SET "productFlowState" = 'CANCELLED',
    "productFlowRevision" = graph."targetRevision"
FROM "_AbrchinV4TerminalOrder" graph
WHERE service_order.id = graph."serviceOrderId"
  AND graph."needsAlignment";

UPDATE "InfrastructureOrder" infrastructure_order
SET "productFlowState" = 'CANCELLED',
    "productFlowRevision" = graph."targetRevision"
FROM "_AbrchinV4TerminalOrder" graph
WHERE infrastructure_order.id = graph."infrastructureOrderId"
  AND graph."needsAlignment";

INSERT INTO "ProductFlowTransition" (
  id, "recommendationSessionId", "serviceOrderId",
  "infrastructureOrderId", "fromState", "toState", reason,
  metadata, "idempotencyKey", "ownerFingerprint",
  "fromRevision", "toRevision"
)
SELECT
  'migration:v4:terminal-session:' || graph."sessionId",
  graph."sessionId",
  NULL,
  NULL,
  CASE
    WHEN graph."sessionState" = 'CANCELLED'
      THEN 'LEGACY_TERMINAL_SESSION_REVISION_MISMATCH'
    ELSE coalesce(graph."sessionState", 'LEGACY_TERMINAL_SESSION')
  END,
  'CANCELLED',
  'all_terminal_session_graph_aligned',
  jsonb_build_object(
    'migration', '20260731003000',
    'scope', 'all_terminal_session',
    'orderCount', graph."orderCount",
    'financialDataChanged', false
  ),
  'migration:v4:terminal-session:' || graph."sessionId",
  graph."sessionId" || ':-:-',
  graph."sessionRevision",
  graph."targetRevision"
FROM "_AbrchinV4AllTerminalSession" graph
WHERE graph."needsAlignment"
ON CONFLICT ("idempotencyKey") DO NOTHING;

INSERT INTO "ProductFlowTransition" (
  id, "recommendationSessionId", "serviceOrderId",
  "infrastructureOrderId", "fromState", "toState", reason,
  metadata, "idempotencyKey", "ownerFingerprint",
  "fromRevision", "toRevision"
)
SELECT
  'migration:v4:terminal-order:' || graph."serviceOrderId",
  NULL,
  graph."serviceOrderId",
  graph."infrastructureOrderId",
  CASE
    WHEN graph."serviceOrderState" = 'CANCELLED'
      THEN 'LEGACY_TERMINAL_ORDER_REVISION_MISMATCH'
    ELSE coalesce(
      graph."serviceOrderState", 'LEGACY_TERMINAL_ORDER'
    )
  END,
  'CANCELLED',
  CASE
    WHEN graph."allSessionTerminal"
      THEN 'terminal_order_aligned_with_terminal_session'
    ELSE 'terminal_order_isolated_from_live_siblings'
  END,
  jsonb_build_object(
    'migration', '20260731003000',
    'scope', CASE
      WHEN graph."allSessionTerminal"
        THEN 'all_terminal_session'
      ELSE 'terminal_order_without_session_owner'
    END,
    'financialDataChanged', false
  ),
  'migration:v4:terminal-order:' || graph."serviceOrderId",
  '-:' || graph."serviceOrderId" || ':' ||
    coalesce(graph."infrastructureOrderId", '-'),
  graph."serviceOrderRevision",
  graph."targetRevision"
FROM "_AbrchinV4TerminalOrder" graph
WHERE graph."needsAlignment"
ON CONFLICT ("idempotencyKey") DO NOTHING;
