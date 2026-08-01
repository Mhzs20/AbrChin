-- Separate catalog provenance from real, individually observed inventory.
-- Forward-only and additive: this migration never updates orders, payments,
-- wallets, ledgers, paidAt, quote/plan snapshots, provider snapshots or
-- previously delivered resources.

CREATE TYPE "InfrastructureOfferSource" AS ENUM (
  'API_CATALOG', 'MANUAL_API_BACKED', 'PREPROVISIONED_INVENTORY'
);

CREATE TYPE "PreprovisionedInventoryStatus" AS ENUM (
  'AVAILABLE', 'RESERVED', 'ASSIGNED', 'DELIVERED',
  'UNHEALTHY', 'STALE', 'DISABLED'
);
CREATE TYPE "PreprovisionedHealthStatus" AS ENUM (
  'HEALTHY', 'UNHEALTHY', 'UNKNOWN'
);

ALTER TABLE "InfrastructurePlan"
  ADD COLUMN "offerSource" "InfrastructureOfferSource" NOT NULL DEFAULT 'API_CATALOG',
  ADD COLUMN "offerPriceValidUntil" TIMESTAMP(3),
  ADD COLUMN "offerLastVerifiedAt" TIMESTAMP(3);

UPDATE "InfrastructurePlan" AS plan
SET
  "offerSource" = CASE item."source"::text
    WHEN 'ADMIN_MANAGED' THEN 'MANUAL_API_BACKED'::"InfrastructureOfferSource"
    ELSE 'API_CATALOG'::"InfrastructureOfferSource"
  END,
  "offerPriceValidUntil" = item."manualPriceValidUntil",
  "offerLastVerifiedAt" = item."manualLastVerifiedAt"
FROM "ProviderCatalogItem" AS item
WHERE plan."catalogItemId" = item."id";

ALTER TABLE "InfrastructurePlan"
  ADD CONSTRAINT "InfrastructurePlan_offer_contract_check"
  CHECK (
    "offerSource" = 'API_CATALOG' OR (
      "offerPriceValidUntil" IS NOT NULL AND
      "offerLastVerifiedAt" IS NOT NULL
    )
  );
CREATE INDEX "InfrastructurePlan_provider_productKind_offerSource_publicationStatus_idx"
  ON "InfrastructurePlan"("provider", "productKind", "offerSource", "publicationStatus");

ALTER TABLE "RecommendationQuote"
  ADD COLUMN "preprovisionedInventoryItemId" TEXT;

CREATE TABLE "PreprovisionedInventoryItem" (
  "id" TEXT NOT NULL,
  "catalogItemId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "provider" "InfrastructureProvider" NOT NULL,
  "apiVersion" TEXT NOT NULL DEFAULT 'v1',
  "providerResourceId" TEXT NOT NULL,
  "regionCode" TEXT NOT NULL,
  "externalPlanId" TEXT NOT NULL,
  "externalImageId" TEXT NOT NULL,
  "observedState" TEXT NOT NULL,
  "observedIpv4" TEXT,
  "observedNetworkId" TEXT,
  "observedSecurityId" TEXT,
  "lastObservedAt" TIMESTAMP(3) NOT NULL,
  "lastHealthCheckedAt" TIMESTAMP(3),
  "healthStatus" "PreprovisionedHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
  "inventoryStatus" "PreprovisionedInventoryStatus" NOT NULL DEFAULT 'STALE',
  "reservedByQuoteId" TEXT,
  "reservedByOrderId" TEXT,
  "reservedRevision" INTEGER,
  "reservedAt" TIMESTAMP(3),
  "reservationExpiresAt" TIMESTAMP(3),
  "assignedOrderId" TEXT,
  "assignedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "disabledAt" TIMESTAMP(3),
  "adminAudit" JSONB,
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PreprovisionedInventoryItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PreprovisionedInventoryItem_resource_id_check"
    CHECK (length(trim("providerResourceId")) > 0),
  CONSTRAINT "PreprovisionedInventoryItem_reservation_check"
    CHECK (
      ("inventoryStatus" <> 'RESERVED') OR
      (
        "reservedByQuoteId" IS NOT NULL AND
        "reservedAt" IS NOT NULL AND
        "reservationExpiresAt" IS NOT NULL AND
        "reservedRevision" IS NOT NULL
      )
    ),
  CONSTRAINT "PreprovisionedInventoryItem_assignment_check"
    CHECK (
      ("inventoryStatus" NOT IN ('ASSIGNED', 'DELIVERED')) OR
      ("assignedOrderId" IS NOT NULL AND "assignedAt" IS NOT NULL)
    ),
  CONSTRAINT "PreprovisionedInventoryItem_catalogItemId_fkey"
    FOREIGN KEY ("catalogItemId") REFERENCES "ProviderCatalogItem"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PreprovisionedInventoryItem_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "InfrastructurePlan"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PreprovisionedInventoryItem_reservedByQuoteId_fkey"
    FOREIGN KEY ("reservedByQuoteId") REFERENCES "RecommendationQuote"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PreprovisionedInventoryItem_reservedByOrderId_fkey"
    FOREIGN KEY ("reservedByOrderId") REFERENCES "ServiceOrder"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PreprovisionedInventoryItem_assignedOrderId_fkey"
    FOREIGN KEY ("assignedOrderId") REFERENCES "ServiceOrder"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PreprovisionedInventoryItem_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PreprovisionedInventoryItem_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PreprovisionedInventoryItem_provider_apiVersion_providerResourceId_key"
  ON "PreprovisionedInventoryItem"("provider", "apiVersion", "providerResourceId");
CREATE UNIQUE INDEX "PreprovisionedInventoryItem_reservedByQuoteId_key"
  ON "PreprovisionedInventoryItem"("reservedByQuoteId");
CREATE UNIQUE INDEX "PreprovisionedInventoryItem_reservedByOrderId_key"
  ON "PreprovisionedInventoryItem"("reservedByOrderId");
CREATE UNIQUE INDEX "PreprovisionedInventoryItem_assignedOrderId_key"
  ON "PreprovisionedInventoryItem"("assignedOrderId");
CREATE INDEX "PreprovisionedInventoryItem_planId_inventoryStatus_healthStatus_idx"
  ON "PreprovisionedInventoryItem"("planId", "inventoryStatus", "healthStatus");
CREATE INDEX "PreprovisionedInventoryItem_catalogItemId_inventoryStatus_idx"
  ON "PreprovisionedInventoryItem"("catalogItemId", "inventoryStatus");
CREATE INDEX "PreprovisionedInventoryItem_reservationExpiresAt_idx"
  ON "PreprovisionedInventoryItem"("reservationExpiresAt");
CREATE INDEX "PreprovisionedInventoryItem_assignedOrderId_idx"
  ON "PreprovisionedInventoryItem"("assignedOrderId");

ALTER TABLE "RecommendationQuote"
  ADD CONSTRAINT "RecommendationQuote_preprovisionedInventoryItemId_fkey"
  FOREIGN KEY ("preprovisionedInventoryItemId")
  REFERENCES "PreprovisionedInventoryItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "RecommendationQuote_preprovisionedInventoryItemId_idx"
  ON "RecommendationQuote"("preprovisionedInventoryItemId");

ALTER TABLE "InfrastructureOrder"
  ADD COLUMN "preprovisionedInventoryItemId" TEXT;
CREATE UNIQUE INDEX "InfrastructureOrder_preprovisionedInventoryItemId_key"
  ON "InfrastructureOrder"("preprovisionedInventoryItemId");
ALTER TABLE "InfrastructureOrder"
  ADD CONSTRAINT "InfrastructureOrder_preprovisionedInventoryItemId_fkey"
  FOREIGN KEY ("preprovisionedInventoryItemId")
  REFERENCES "PreprovisionedInventoryItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
