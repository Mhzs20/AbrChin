ALTER TABLE "InfrastructurePlan"
ADD COLUMN IF NOT EXISTS "skuMarkupBasisPoints" INTEGER;

UPDATE "InfrastructurePlan"
SET "active" = false,
    "publicationStatus" = 'PAUSED'
WHERE "code" LIKE 'READY_PARSPACK_%'
  AND "publicationStatus" = 'PUBLISHED';
