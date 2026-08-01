-- Admin-controlled provider regions, curated storefront publication, explicit
-- manual catalog sources, and durable operational alerting.
-- Forward-only: financial, quote, order, payment, provider and ledger snapshots
-- are intentionally untouched.

CREATE TYPE "ProviderRegionConfigSource" AS ENUM ('ENV_BOOTSTRAP', 'ADMIN');
CREATE TYPE "ProviderCatalogItemSource" AS ENUM ('PROVIDER_API', 'ADMIN_MANAGED');
CREATE TYPE "InfrastructurePlanPublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED');
CREATE TYPE "OperationalIncidentSeverity" AS ENUM ('WARNING', 'CRITICAL');
CREATE TYPE "OperationalIncidentStatus" AS ENUM ('OPEN', 'RESOLVED');
CREATE TYPE "OperationalAlertDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'RETRY', 'EXHAUSTED');

ALTER TABLE "ProviderCatalogItem"
  ADD COLUMN "source" "ProviderCatalogItemSource" NOT NULL DEFAULT 'PROVIDER_API',
  ADD COLUMN "manualAvailableUnits" INTEGER,
  ADD COLUMN "manualPriceValidUntil" TIMESTAMP(3),
  ADD COLUMN "manualLastVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "manualUpdatedById" TEXT;

ALTER TABLE "ProviderCatalogItem"
  ADD CONSTRAINT "ProviderCatalogItem_manual_units_check"
    CHECK ("manualAvailableUnits" IS NULL OR "manualAvailableUnits" >= 0),
  ADD CONSTRAINT "ProviderCatalogItem_manual_contract_check"
    CHECK (
      "source" <> 'ADMIN_MANAGED' OR (
        "manualAvailableUnits" IS NOT NULL AND
        "manualPriceValidUntil" IS NOT NULL AND
        "manualLastVerifiedAt" IS NOT NULL AND
        "providerMonthlyPriceIrr" IS NOT NULL AND
        "providerMonthlyPriceIrr" > 0
      )
    ),
  ADD CONSTRAINT "ProviderCatalogItem_manualUpdatedById_fkey"
    FOREIGN KEY ("manualUpdatedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ProviderCatalogItem_provider_apiVersion_source_status_idx"
  ON "ProviderCatalogItem"("provider", "apiVersion", "source", "status");
CREATE INDEX "ProviderCatalogItem_manualUpdatedById_idx"
  ON "ProviderCatalogItem"("manualUpdatedById");

ALTER TABLE "InfrastructurePlan"
  ADD COLUMN "publicationStatus" "InfrastructurePlanPublicationStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "instantDelivery" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "displayDuringProviderOutage" BOOLEAN NOT NULL DEFAULT true;

UPDATE "InfrastructurePlan"
SET
  "publicationStatus" = CASE
    WHEN "provider" = 'ARVAN'
      AND "productKind" = 'CLOUD_SERVER'
      AND "code" LIKE 'CLOUD_ARVAN_V1_%'
      THEN 'DRAFT'::"InfrastructurePlanPublicationStatus"
    WHEN "active" THEN 'PUBLISHED'::"InfrastructurePlanPublicationStatus"
    ELSE 'PAUSED'::"InfrastructurePlanPublicationStatus"
  END,
  "active" = CASE
    WHEN "provider" = 'ARVAN'
      AND "productKind" = 'CLOUD_SERVER'
      AND "code" LIKE 'CLOUD_ARVAN_V1_%'
      THEN false
    ELSE "active"
  END;

CREATE INDEX "InfrastructurePlan_provider_productKind_publicationStatus_sortOrder_idx"
  ON "InfrastructurePlan"("provider", "productKind", "publicationStatus", "sortOrder");

CREATE TABLE "ProviderRegionConfig" (
  "id" TEXT NOT NULL,
  "provider" "InfrastructureProvider" NOT NULL,
  "apiVersion" TEXT NOT NULL DEFAULT 'v1',
  "regionCode" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "source" "ProviderRegionConfigSource" NOT NULL DEFAULT 'ADMIN',
  "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
  "saleEnabled" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "lastValidatedAt" TIMESTAMP(3),
  "lastValidationCode" TEXT,
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderRegionConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProviderRegionConfig_region_code_check"
    CHECK ("regionCode" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("regionCode") <= 64),
  CONSTRAINT "ProviderRegionConfig_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ProviderRegionConfig_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProviderRegionConfig_provider_apiVersion_regionCode_key"
  ON "ProviderRegionConfig"("provider", "apiVersion", "regionCode");
CREATE INDEX "ProviderRegionConfig_provider_apiVersion_syncEnabled_sortOrder_idx"
  ON "ProviderRegionConfig"("provider", "apiVersion", "syncEnabled", "sortOrder");
CREATE INDEX "ProviderRegionConfig_provider_apiVersion_saleEnabled_sortOrder_idx"
  ON "ProviderRegionConfig"("provider", "apiVersion", "saleEnabled", "sortOrder");

CREATE TABLE "OperationalIncident" (
  "id" TEXT NOT NULL,
  "provider" "InfrastructureProvider",
  "apiVersion" TEXT,
  "operation" TEXT NOT NULL,
  "safeCode" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "safeMessage" TEXT NOT NULL,
  "severity" "OperationalIncidentSeverity" NOT NULL,
  "status" "OperationalIncidentStatus" NOT NULL DEFAULT 'OPEN',
  "fingerprint" TEXT NOT NULL,
  "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
  "firstOccurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastOccurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolutionCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationalIncident_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OperationalIncident_occurrence_count_check" CHECK ("occurrenceCount" > 0)
);

CREATE INDEX "OperationalIncident_status_severity_lastOccurredAt_idx"
  ON "OperationalIncident"("status", "severity", "lastOccurredAt");
CREATE INDEX "OperationalIncident_provider_status_lastOccurredAt_idx"
  ON "OperationalIncident"("provider", "status", "lastOccurredAt");
CREATE INDEX "OperationalIncident_fingerprint_status_idx"
  ON "OperationalIncident"("fingerprint", "status");
CREATE UNIQUE INDEX "OperationalIncident_one_open_fingerprint_key"
  ON "OperationalIncident"("fingerprint") WHERE "status" = 'OPEN';

CREATE TABLE "OperationalAlertOutbox" (
  "id" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'SMS',
  "idempotencyKey" TEXT NOT NULL,
  "status" "OperationalAlertDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastErrorCode" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationalAlertOutbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OperationalAlertOutbox_attempt_count_check" CHECK ("attemptCount" >= 0),
  CONSTRAINT "OperationalAlertOutbox_incidentId_fkey"
    FOREIGN KEY ("incidentId") REFERENCES "OperationalIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OperationalAlertOutbox_idempotencyKey_key"
  ON "OperationalAlertOutbox"("idempotencyKey");
CREATE INDEX "OperationalAlertOutbox_status_nextAttemptAt_createdAt_idx"
  ON "OperationalAlertOutbox"("status", "nextAttemptAt", "createdAt");
CREATE INDEX "OperationalAlertOutbox_incidentId_createdAt_idx"
  ON "OperationalAlertOutbox"("incidentId", "createdAt");

CREATE TABLE "AdminAlertSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "smsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "criticalOnly" BOOLEAN NOT NULL DEFAULT true,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminAlertSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AdminAlertSubscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AdminAlertSubscription_userId_key"
  ON "AdminAlertSubscription"("userId");
CREATE INDEX "AdminAlertSubscription_active_smsEnabled_idx"
  ON "AdminAlertSubscription"("active", "smsEnabled");

-- Existing admins are opted into critical operational alerts. They can later
-- change this explicitly from Admin settings; customer rows are never added.
INSERT INTO "AdminAlertSubscription" (
  "id", "userId", "smsEnabled", "criticalOnly", "active", "createdAt", "updatedAt"
)
SELECT
  'alert-sub-' || md5("id"), "id", true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User"
WHERE "role" = 'ADMIN'
ON CONFLICT ("userId") DO NOTHING;
