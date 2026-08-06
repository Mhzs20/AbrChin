-- Commercial pricing v3 (forward-only, additive):
-- 1) Append-only Financial Center configuration revisions.
-- 2) New launch default markup = 4286 bps (30% target gross margin).
-- 3) Repair ONLY provider configs still on the untouched legacy automatic
--    value 23333 bps (~70% margin). Custom admin values stay untouched.
--    Historical quotes/orders keep their own snapshots.

CREATE TABLE "FinanceConfigurationRevision" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "reason" TEXT,
    "rollbackOfId" TEXT,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "FinanceConfigurationRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FinanceConfigurationRevision_createdAt_idx"
    ON "FinanceConfigurationRevision"("createdAt");

CREATE INDEX "FinanceConfigurationRevision_actorUserId_idx"
    ON "FinanceConfigurationRevision"("actorUserId");

ALTER TABLE "FinanceConfigurationRevision"
    ADD CONSTRAINT "FinanceConfigurationRevision_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProviderPricingConfig"
    ALTER COLUMN "markupBasisPoints" SET DEFAULT 4286;

UPDATE "ProviderPricingConfig"
SET "markupBasisPoints" = 4286
WHERE "markupBasisPoints" = 23333;
