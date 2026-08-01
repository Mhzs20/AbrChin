-- Forward-only launch completion. Existing financial rows and snapshots are not updated.
ALTER TYPE "ProviderCatalogItemSource" ADD VALUE IF NOT EXISTS 'MANUAL_ADMIN';
ALTER TYPE "InfrastructureOfferSource" ADD VALUE IF NOT EXISTS 'MANUAL_ADMIN';

-- Arvan fixed ready offers use the existing provider markup. The product-level
-- row is an explicit, zero-bps gate so Admin can configure it independently.
INSERT INTO "ProductPricingConfig" (
  "id",
  "provider",
  "apiVersion",
  "productKind",
  "markupBasisPoints",
  "enabled",
  "updatedAt"
)
VALUES (
  'arvan-v1-ready',
  'ARVAN',
  'v1',
  'READY_INSTANT_SERVER',
  0,
  true,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("provider", "apiVersion", "productKind") DO NOTHING;

ALTER TABLE "WalletTopUp"
  ADD COLUMN IF NOT EXISTS "purchaseOrderId" TEXT,
  ADD COLUMN IF NOT EXISTS "requestFingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "redirectUrl" TEXT;

CREATE INDEX IF NOT EXISTS "WalletTopUp_purchaseOrderId_status_idx"
  ON "WalletTopUp"("purchaseOrderId", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'WalletTopUp_purchaseOrderId_fkey'
  ) THEN
    ALTER TABLE "WalletTopUp"
      ADD CONSTRAINT "WalletTopUp_purchaseOrderId_fkey"
      FOREIGN KEY ("purchaseOrderId") REFERENCES "ServiceOrder"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
