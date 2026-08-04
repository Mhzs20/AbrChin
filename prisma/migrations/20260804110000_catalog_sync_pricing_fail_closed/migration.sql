-- Catalog synchronization must never opt a provider or product into pricing.
-- Existing Admin choices are preserved; only future row defaults change.
ALTER TABLE "ProviderPricingConfig"
  ALTER COLUMN "enabled" SET DEFAULT false;

ALTER TABLE "ProductPricingConfig"
  ALTER COLUMN "enabled" SET DEFAULT false;

-- Rows never confirmed by an Admin came from historical bootstrap/sync code.
-- Preserve explicit Admin choices while closing legacy automatic enablement.
UPDATE "ProviderPricingConfig"
SET "enabled" = false
WHERE "updatedById" IS NULL;

UPDATE "ProductPricingConfig"
SET "enabled" = false
WHERE "updatedById" IS NULL;
