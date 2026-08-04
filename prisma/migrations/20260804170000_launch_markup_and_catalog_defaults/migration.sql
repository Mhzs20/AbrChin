-- Launch default markup: ~30% provider cost / ~70% AbrChin profit on infrastructure.
-- Historical Quote/Order snapshots are unchanged by this UPDATE.

ALTER TABLE "ProviderPricingConfig"
  ALTER COLUMN "markupBasisPoints" SET DEFAULT 23333;

ALTER TABLE "ProductPricingConfig"
  ALTER COLUMN "markupBasisPoints" SET DEFAULT 0;

UPDATE "ProviderPricingConfig"
SET "markupBasisPoints" = 23333
WHERE "markupBasisPoints" = 0;

UPDATE "ProductPricingConfig"
SET "markupBasisPoints" = 0
WHERE "markupBasisPoints" = 0;
