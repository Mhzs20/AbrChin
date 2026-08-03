CREATE TYPE "BillingResourceUnit" AS ENUM (
  'INSTANCE',
  'VCPU',
  'GB_RAM',
  'GB_DISK',
  'IP',
  'BACKUP',
  'GB_TRAFFIC',
  'SNAPSHOT',
  'ADDON'
);

ALTER TABLE "RateCardVersion"
ADD COLUMN "resourceUnit" "BillingResourceUnit" NOT NULL DEFAULT 'INSTANCE';

ALTER TABLE "ResourceVersion"
ADD COLUMN "planId" TEXT;

UPDATE "ResourceVersion" AS resource_version
SET "planId" = infrastructure_order."planId"
FROM "CloudInstance" AS instance
JOIN "InfrastructureOrder" AS infrastructure_order
  ON infrastructure_order."id" = instance."infrastructureOrderId"
WHERE resource_version."cloudInstanceId" = instance."id";

ALTER TABLE "ResourceVersion"
ALTER COLUMN "planId" SET NOT NULL;

CREATE INDEX "ResourceVersion_planId_effectiveFrom_idx"
ON "ResourceVersion"("planId", "effectiveFrom");

ALTER TABLE "ResourceVersion"
ADD CONSTRAINT "ResourceVersion_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "InfrastructurePlan"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "BillingAdjustment" (
  "id" TEXT NOT NULL,
  "billingReconciliationId" TEXT NOT NULL,
  "billingInvoiceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "cloudInstanceId" TEXT NOT NULL,
  "amountRial" BIGINT NOT NULL,
  "settledAmountRial" BIGINT NOT NULL,
  "outstandingAmountRial" BIGINT NOT NULL,
  "reason" TEXT NOT NULL,
  "ledgerEntryId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingAdjustment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingAdjustment_amount_check" CHECK ("amountRial" <> 0),
  CONSTRAINT "BillingAdjustment_settlement_check" CHECK (
    "settledAmountRial" >= 0
    AND "outstandingAmountRial" >= 0
    AND (
      ("amountRial" > 0 AND "settledAmountRial" + "outstandingAmountRial" = "amountRial")
      OR
      ("amountRial" < 0 AND "outstandingAmountRial" = 0 AND "settledAmountRial" = -"amountRial")
    )
  )
);

CREATE UNIQUE INDEX "BillingAdjustment_billingReconciliationId_key"
ON "BillingAdjustment"("billingReconciliationId");

CREATE UNIQUE INDEX "BillingAdjustment_ledgerEntryId_key"
ON "BillingAdjustment"("ledgerEntryId");

CREATE UNIQUE INDEX "BillingAdjustment_idempotencyKey_key"
ON "BillingAdjustment"("idempotencyKey");

CREATE INDEX "BillingAdjustment_cloudInstanceId_createdAt_idx"
ON "BillingAdjustment"("cloudInstanceId", "createdAt");

CREATE INDEX "BillingAdjustment_userId_createdAt_idx"
ON "BillingAdjustment"("userId", "createdAt");

CREATE INDEX "BillingAdjustment_billingInvoiceId_createdAt_idx"
ON "BillingAdjustment"("billingInvoiceId", "createdAt");

ALTER TABLE "BillingAdjustment"
ADD CONSTRAINT "BillingAdjustment_billingReconciliationId_fkey"
FOREIGN KEY ("billingReconciliationId") REFERENCES "BillingReconciliation"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BillingAdjustment"
ADD CONSTRAINT "BillingAdjustment_billingInvoiceId_fkey"
FOREIGN KEY ("billingInvoiceId") REFERENCES "BillingInvoice"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BillingAdjustment"
ADD CONSTRAINT "BillingAdjustment_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BillingAdjustment"
ADD CONSTRAINT "BillingAdjustment_walletId_fkey"
FOREIGN KEY ("walletId") REFERENCES "Wallet"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BillingAdjustment"
ADD CONSTRAINT "BillingAdjustment_cloudInstanceId_fkey"
FOREIGN KEY ("cloudInstanceId") REFERENCES "CloudInstance"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BillingAdjustment"
ADD CONSTRAINT "BillingAdjustment_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
