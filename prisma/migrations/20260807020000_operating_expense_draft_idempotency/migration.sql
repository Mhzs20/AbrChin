-- Additive: draft operating-expense create idempotency for Admin double-submit safety.
ALTER TABLE "OperatingExpense"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "OperatingExpense_idempotencyKey_key"
  ON "OperatingExpense"("idempotencyKey");
