-- Durable ParsPack history archive. Additive and idempotent.
-- Does not rewrite 20260822090000_drop_parspack_provider.
-- Pre-drop archival copies rows here. This migration keeps the tables on
-- databases that already applied the drop with no remaining ParsPack enum.

CREATE TABLE IF NOT EXISTS "ParsPackArchivedRow" (
    "id" TEXT NOT NULL,
    "sourceTable" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    "payloadSha256" TEXT NOT NULL,

    CONSTRAINT "ParsPackArchivedRow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ParsPackArchivedRow_sourceTable_sourceId_key"
    ON "ParsPackArchivedRow"("sourceTable", "sourceId");

CREATE INDEX IF NOT EXISTS "ParsPackArchivedRow_sourceTable_idx"
    ON "ParsPackArchivedRow"("sourceTable");

CREATE TABLE IF NOT EXISTS "ParsPackArchiveReceipt" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dropMigrationName" TEXT NOT NULL,
    "dropAlreadyApplied" BOOLEAN NOT NULL,
    "beforeCounts" JSONB NOT NULL,
    "afterArchiveCounts" JSONB NOT NULL,
    "beforeChecksum" TEXT NOT NULL,
    "afterChecksum" TEXT NOT NULL,
    "databaseVersion" TEXT NOT NULL,
    "verificationResult" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "ParsPackArchiveReceipt_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ParchinPricingConfig"
    ADD COLUMN IF NOT EXISTS "operationalEvidenceApprovedAt" TIMESTAMP(3);
