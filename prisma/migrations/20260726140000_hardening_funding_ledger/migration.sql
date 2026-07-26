-- ProviderFundingConfirmation: support multiple funding attempts per order
ALTER TABLE "ProviderFundingConfirmation" ADD COLUMN IF NOT EXISTS "attempt" INTEGER;
ALTER TABLE "ProviderFundingConfirmation" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

UPDATE "ProviderFundingConfirmation"
SET "attempt" = 1
WHERE "attempt" IS NULL;

UPDATE "ProviderFundingConfirmation"
SET "idempotencyKey" = 'legacy_' || "id"
WHERE "idempotencyKey" IS NULL;

ALTER TABLE "ProviderFundingConfirmation" ALTER COLUMN "attempt" SET NOT NULL;
ALTER TABLE "ProviderFundingConfirmation" ALTER COLUMN "idempotencyKey" SET NOT NULL;

DROP INDEX IF EXISTS "ProviderFundingConfirmation_infrastructureOrderId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "ProviderFundingConfirmation_idempotencyKey_key"
  ON "ProviderFundingConfirmation"("idempotencyKey");

CREATE UNIQUE INDEX IF NOT EXISTS "ProviderFundingConfirmation_infrastructureOrderId_attempt_key"
  ON "ProviderFundingConfirmation"("infrastructureOrderId", "attempt");

CREATE INDEX IF NOT EXISTS "ProviderFundingConfirmation_infrastructureOrderId_confirmedAt_idx"
  ON "ProviderFundingConfirmation"("infrastructureOrderId", "confirmedAt");

-- Ledger: index for reverse lookup; completed entries remain immutable
CREATE INDEX IF NOT EXISTS "WalletLedgerEntry_reversedEntryId_idx"
  ON "WalletLedgerEntry"("reversedEntryId");

-- Only one active create_instance job per infrastructure order
CREATE UNIQUE INDEX IF NOT EXISTS "ProvisioningJob_one_active_create_per_order"
  ON "ProvisioningJob"("infrastructureOrderId")
  WHERE status IN ('QUEUED', 'RUNNING') AND operation = 'create_instance';

CREATE INDEX IF NOT EXISTS "ProvisioningJob_infrastructureOrderId_operation_status_idx"
  ON "ProvisioningJob"("infrastructureOrderId", "operation", "status");
