-- Forward-only V7 hardening for durable health retry dispatch.
-- V1-V6 remain immutable. This migration changes no financial, payment,
-- quote, plan, provider-selection, or provider-resource data.

ALTER TABLE "HealthRetryDispatch"
  ADD COLUMN "nextAttemptAt" TIMESTAMPTZ(3),
  ADD COLUMN "terminalReason" TEXT,
  ADD COLUMN "deadLetteredAt" TIMESTAMP(3);

-- Existing pending rows remain immediately eligible after deployment. The
-- timestamp becomes the durable backoff cursor for later transient failures.
UPDATE "HealthRetryDispatch"
SET "nextAttemptAt" = CURRENT_TIMESTAMP
WHERE "nextAttemptAt" IS NULL;

ALTER TABLE "HealthRetryDispatch"
  ALTER COLUMN "nextAttemptAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "nextAttemptAt" SET NOT NULL;

CREATE INDEX "HealthRetryDispatch_status_nextAttemptAt_createdAt_idx"
  ON "HealthRetryDispatch"(status, "nextAttemptAt", "createdAt");

ALTER TABLE "HealthRetryDispatch"
  ADD CONSTRAINT "HealthRetryDispatch_status_state_machine_check"
  CHECK (status IN (
    'PENDING', 'DISPATCHED', 'EXHAUSTED', 'OBSOLETE', 'DEAD_LETTER'
  ));
