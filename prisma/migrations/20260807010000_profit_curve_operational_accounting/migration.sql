-- Profit curve persistence + operational accounting journal (forward-only, additive).
-- Does not rewrite historical money snapshots. Provider costs are never invented.

-- 1) Commerce pricing floor for post-discount infrastructure margin.
ALTER TABLE "CommercePricingConfig"
  ADD COLUMN IF NOT EXISTS "minimumPostDiscountGrossMarginBps" INTEGER NOT NULL DEFAULT 2000;

UPDATE "CommercePricingConfig"
SET "minimumPostDiscountGrossMarginBps" = 2000
WHERE "id" = 'default'
  AND ("minimumPostDiscountGrossMarginBps" IS NULL OR "minimumPostDiscountGrossMarginBps" = 2000);

-- 2) Optional commercial economics / profit-curve audit snapshots.
ALTER TABLE "ServiceOrder"
  ADD COLUMN IF NOT EXISTS "commercialEconomicsSnapshot" JSONB;
ALTER TABLE "RecommendationQuote"
  ADD COLUMN IF NOT EXISTS "commercialEconomicsSnapshot" JSONB;

-- 3) Accounting enums
DO $$ BEGIN
  CREATE TYPE "AccountingJournalStatus" AS ENUM ('PENDING', 'POSTED', 'REVERSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AccountingQuality" AS ENUM ('FINAL', 'ESTIMATED', 'NEEDS_RECONCILIATION', 'REVERSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OperatingExpenseStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OperatingExpenseCategory" AS ENUM (
    'GATEWAY_FEES',
    'SMS_EXPENSE',
    'SUPPORT_OPERATIONS',
    'HOSTING_OPERATIONS',
    'MARKETING_EXPENSE',
    'PAYROLL_CONTRACTOR',
    'OTHER_OPERATING_EXPENSE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4) Journal tables
CREATE TABLE IF NOT EXISTS "AccountingJournalEntry" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "status" "AccountingJournalStatus" NOT NULL DEFAULT 'POSTED',
    "quality" "AccountingQuality" NOT NULL DEFAULT 'FINAL',
    "metadata" JSONB,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversesEntryId" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingJournalEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AccountingJournalEntry_idempotencyKey_key"
  ON "AccountingJournalEntry"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "AccountingJournalEntry_reversesEntryId_key"
  ON "AccountingJournalEntry"("reversesEntryId");
CREATE INDEX IF NOT EXISTS "AccountingJournalEntry_referenceType_referenceId_idx"
  ON "AccountingJournalEntry"("referenceType", "referenceId");
CREATE INDEX IF NOT EXISTS "AccountingJournalEntry_eventType_occurredAt_idx"
  ON "AccountingJournalEntry"("eventType", "occurredAt");
CREATE INDEX IF NOT EXISTS "AccountingJournalEntry_status_occurredAt_idx"
  ON "AccountingJournalEntry"("status", "occurredAt");
CREATE INDEX IF NOT EXISTS "AccountingJournalEntry_quality_occurredAt_idx"
  ON "AccountingJournalEntry"("quality", "occurredAt");

ALTER TABLE "AccountingJournalEntry"
  DROP CONSTRAINT IF EXISTS "AccountingJournalEntry_reversesEntryId_fkey";
ALTER TABLE "AccountingJournalEntry"
  ADD CONSTRAINT "AccountingJournalEntry_reversesEntryId_fkey"
  FOREIGN KEY ("reversesEntryId") REFERENCES "AccountingJournalEntry"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "AccountingJournalLine" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "debitRial" BIGINT NOT NULL DEFAULT 0,
    "creditRial" BIGINT NOT NULL DEFAULT 0,
    "description" TEXT,
    "metadata" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingJournalLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AccountingJournalLine_journalEntryId_sortOrder_idx"
  ON "AccountingJournalLine"("journalEntryId", "sortOrder");
CREATE INDEX IF NOT EXISTS "AccountingJournalLine_accountCode_idx"
  ON "AccountingJournalLine"("accountCode");

ALTER TABLE "AccountingJournalLine"
  DROP CONSTRAINT IF EXISTS "AccountingJournalLine_journalEntryId_fkey";
ALTER TABLE "AccountingJournalLine"
  ADD CONSTRAINT "AccountingJournalLine_journalEntryId_fkey"
  FOREIGN KEY ("journalEntryId") REFERENCES "AccountingJournalEntry"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5) Manual operating expenses
CREATE TABLE IF NOT EXISTS "OperatingExpense" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amountRial" BIGINT NOT NULL,
    "category" "OperatingExpenseCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "vendor" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "status" "OperatingExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "postedById" TEXT,
    "reversedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "journalEntryId" TEXT,
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatingExpense_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OperatingExpense_journalEntryId_key"
  ON "OperatingExpense"("journalEntryId");
CREATE INDEX IF NOT EXISTS "OperatingExpense_status_date_idx"
  ON "OperatingExpense"("status", "date");
CREATE INDEX IF NOT EXISTS "OperatingExpense_category_date_idx"
  ON "OperatingExpense"("category", "date");
CREATE INDEX IF NOT EXISTS "OperatingExpense_createdById_createdAt_idx"
  ON "OperatingExpense"("createdById", "createdAt");

ALTER TABLE "OperatingExpense"
  DROP CONSTRAINT IF EXISTS "OperatingExpense_createdById_fkey";
ALTER TABLE "OperatingExpense"
  ADD CONSTRAINT "OperatingExpense_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperatingExpense"
  DROP CONSTRAINT IF EXISTS "OperatingExpense_postedById_fkey";
ALTER TABLE "OperatingExpense"
  ADD CONSTRAINT "OperatingExpense_postedById_fkey"
  FOREIGN KEY ("postedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OperatingExpense"
  DROP CONSTRAINT IF EXISTS "OperatingExpense_reversedById_fkey";
ALTER TABLE "OperatingExpense"
  ADD CONSTRAINT "OperatingExpense_reversedById_fkey"
  FOREIGN KEY ("reversedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 6) Profit curve configuration + bands
CREATE TABLE IF NOT EXISTS "ProfitCurveConfiguration" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "minimumPostDiscountGrossMarginBps" INTEGER NOT NULL DEFAULT 2000,
    "activeRevisionId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "ProfitCurveConfiguration_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProfitCurveConfiguration"
  DROP CONSTRAINT IF EXISTS "ProfitCurveConfiguration_updatedById_fkey";
ALTER TABLE "ProfitCurveConfiguration"
  ADD CONSTRAINT "ProfitCurveConfiguration_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "ProfitCurveBand" (
    "id" TEXT NOT NULL,
    "configurationId" TEXT NOT NULL DEFAULT 'default',
    "sortOrder" INTEGER NOT NULL,
    "minProviderCostRial" BIGINT NOT NULL,
    "maxProviderCostRial" BIGINT,
    "targetGrossMarginBps" INTEGER NOT NULL,

    CONSTRAINT "ProfitCurveBand_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProfitCurveBand_configurationId_sortOrder_key"
  ON "ProfitCurveBand"("configurationId", "sortOrder");
CREATE INDEX IF NOT EXISTS "ProfitCurveBand_configurationId_minProviderCostRial_idx"
  ON "ProfitCurveBand"("configurationId", "minProviderCostRial");

ALTER TABLE "ProfitCurveBand"
  DROP CONSTRAINT IF EXISTS "ProfitCurveBand_configurationId_fkey";
ALTER TABLE "ProfitCurveBand"
  ADD CONSTRAINT "ProfitCurveBand_configurationId_fkey"
  FOREIGN KEY ("configurationId") REFERENCES "ProfitCurveConfiguration"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 7) Seed default profit curve (Rial thresholds; margins in bps)
INSERT INTO "ProfitCurveConfiguration" (
  "id", "enabled", "minimumPostDiscountGrossMarginBps", "activeRevisionId", "updatedAt", "updatedById"
) VALUES (
  'default', true, 2000, NULL, CURRENT_TIMESTAMP, NULL
)
ON CONFLICT ("id") DO UPDATE SET
  "minimumPostDiscountGrossMarginBps" = EXCLUDED."minimumPostDiscountGrossMarginBps",
  "enabled" = EXCLUDED."enabled";

INSERT INTO "ProfitCurveBand" (
  "id", "configurationId", "sortOrder", "minProviderCostRial", "maxProviderCostRial", "targetGrossMarginBps"
) VALUES
  ('pcband_0_50m', 'default', 0, 0, 50000000, 7000),
  ('pcband_50_100m', 'default', 1, 50000000, 100000000, 6000),
  ('pcband_100_150m', 'default', 2, 100000000, 150000000, 5000),
  ('pcband_150_250m', 'default', 3, 150000000, 250000000, 4000),
  ('pcband_250m_plus', 'default', 4, 250000000, NULL, 3000)
ON CONFLICT ("id") DO UPDATE SET
  "sortOrder" = EXCLUDED."sortOrder",
  "minProviderCostRial" = EXCLUDED."minProviderCostRial",
  "maxProviderCostRial" = EXCLUDED."maxProviderCostRial",
  "targetGrossMarginBps" = EXCLUDED."targetGrossMarginBps";
