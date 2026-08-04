-- Term months, coupons, wallet bonus ledger, subscription lifecycle markers.

ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'TOP_UP_BONUS';
ALTER TYPE "QuoteLineItemType" ADD VALUE IF NOT EXISTS 'TERM_DISCOUNT';
ALTER TYPE "QuoteLineItemType" ADD VALUE IF NOT EXISTS 'COUPON_DISCOUNT';

DO $$ BEGIN
  CREATE TYPE "CouponType" AS ENUM ('SERVER_PURCHASE', 'WALLET_BONUS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CouponScope" AS ENUM ('PUBLIC', 'USER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "RecommendationQuote"
  ADD COLUMN IF NOT EXISTS "termMonths" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "termDiscountBps" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "couponCodeSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "couponDiscountBpsSnapshot" INTEGER;

ALTER TABLE "ServiceOrder"
  ADD COLUMN IF NOT EXISTS "termMonths" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "termDiscountBps" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "couponCodeSnapshot" TEXT;

ALTER TABLE "WalletTopUp"
  ADD COLUMN IF NOT EXISTS "couponCode" TEXT,
  ADD COLUMN IF NOT EXISTS "bonusRialSnapshot" BIGINT;

ALTER TABLE "ServiceSubscription"
  ADD COLUMN IF NOT EXISTS "termMonths" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "lastReminderSentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deleteReviewAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "Coupon" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "type" "CouponType" NOT NULL,
  "scope" "CouponScope" NOT NULL DEFAULT 'PUBLIC',
  "userId" TEXT,
  "discountBps" INTEGER,
  "termMonths" INTEGER,
  "minDepositRial" BIGINT,
  "bonusRial" BIGINT,
  "expiresAt" TIMESTAMP(3),
  "maxRedemptions" INTEGER,
  "redemptionCount" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Coupon_code_key" ON "Coupon"("code");
CREATE INDEX IF NOT EXISTS "Coupon_type_active_expiresAt_idx" ON "Coupon"("type", "active", "expiresAt");
CREATE INDEX IF NOT EXISTS "Coupon_userId_active_idx" ON "Coupon"("userId", "active");

CREATE TABLE IF NOT EXISTS "CouponRedemption" (
  "id" TEXT NOT NULL,
  "couponId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "serviceOrderId" TEXT,
  "walletTopUpId" TEXT,
  "amountRial" BIGINT NOT NULL DEFAULT 0,
  "bonusRial" BIGINT NOT NULL DEFAULT 0,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CouponRedemption_idempotencyKey_key" ON "CouponRedemption"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "CouponRedemption_couponId_userId_idx" ON "CouponRedemption"("couponId", "userId");
CREATE INDEX IF NOT EXISTS "CouponRedemption_walletTopUpId_idx" ON "CouponRedemption"("walletTopUpId");
CREATE INDEX IF NOT EXISTS "CouponRedemption_serviceOrderId_idx" ON "CouponRedemption"("serviceOrderId");

DO $$ BEGIN
  ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_couponId_fkey"
    FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
