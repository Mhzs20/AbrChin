-- Cross-process OTP / abuse rate-limit buckets (restart-safe, multi-replica).
CREATE TABLE IF NOT EXISTS "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowStartAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

CREATE INDEX IF NOT EXISTS "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");

-- One-time forward repair: published API-catalog PAYG leftovers → prepaid term.
-- Must not be re-done from customer GET/page rendering.
UPDATE "InfrastructurePlan"
SET
  "billingModel" = 'PREPAID_TERM',
  "billingPolicyVersionId" = NULL
WHERE
  "billingModel" = 'PAYG_WALLET'
  AND "offerSource" = 'API_CATALOG'
  AND "active" = true
  AND "publicationStatus" = 'PUBLISHED';
