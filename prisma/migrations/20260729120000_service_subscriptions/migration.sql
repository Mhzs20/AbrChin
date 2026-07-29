ALTER TYPE "LedgerType" ADD VALUE 'SERVICE_RENEWAL';

ALTER TYPE "AdminNotificationType" ADD VALUE 'RENEWAL_PAID';
ALTER TYPE "AdminNotificationType" ADD VALUE 'RENEWAL_DUE';

CREATE TYPE "SubscriptionStatus" AS ENUM (
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'CANCELED',
  'TERMINATED'
);

CREATE TABLE "ServiceSubscription" (
  "id" TEXT NOT NULL,
  "cloudInstanceId" TEXT NOT NULL,
  "sourceOrderId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "renewalPriceRial" BIGINT NOT NULL,
  "currentPeriodStart" TIMESTAMP(3) NOT NULL,
  "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
  "nextRenewalAt" TIMESTAMP(3) NOT NULL,
  "graceEndsAt" TIMESTAMP(3) NOT NULL,
  "autoRenew" BOOLEAN NOT NULL DEFAULT false,
  "canceledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceSubscription_cloudInstanceId_key"
ON "ServiceSubscription"("cloudInstanceId");

CREATE UNIQUE INDEX "ServiceSubscription_sourceOrderId_key"
ON "ServiceSubscription"("sourceOrderId");

CREATE INDEX "ServiceSubscription_userId_status_nextRenewalAt_idx"
ON "ServiceSubscription"("userId", "status", "nextRenewalAt");

CREATE INDEX "ServiceSubscription_status_nextRenewalAt_idx"
ON "ServiceSubscription"("status", "nextRenewalAt");

ALTER TABLE "ServiceSubscription"
ADD CONSTRAINT "ServiceSubscription_cloudInstanceId_fkey"
FOREIGN KEY ("cloudInstanceId") REFERENCES "CloudInstance"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServiceSubscription"
ADD CONSTRAINT "ServiceSubscription_sourceOrderId_fkey"
FOREIGN KEY ("sourceOrderId") REFERENCES "ServiceOrder"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ServiceSubscription"
ADD CONSTRAINT "ServiceSubscription_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServiceSubscription"
ADD CONSTRAINT "ServiceSubscription_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "InfrastructurePlan"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing active instances receive a full period from this migration instead
-- of being charged or suspended retroactively.
INSERT INTO "ServiceSubscription" (
  "id",
  "cloudInstanceId",
  "sourceOrderId",
  "userId",
  "planId",
  "status",
  "renewalPriceRial",
  "currentPeriodStart",
  "currentPeriodEnd",
  "nextRenewalAt",
  "graceEndsAt",
  "autoRenew",
  "createdAt",
  "updatedAt"
)
SELECT
  'sub_' || md5(random()::text || clock_timestamp()::text || instance."id"),
  instance."id",
  infrastructure_order."serviceOrderId",
  instance."userId",
  infrastructure_order."planId",
  'ACTIVE'::"SubscriptionStatus",
  COALESCE(plan."renewalPriceRial", plan."salePriceRial"),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP + INTERVAL '1 month',
  CURRENT_TIMESTAMP + INTERVAL '1 month',
  CURRENT_TIMESTAMP + INTERVAL '1 month 7 days',
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "CloudInstance" AS instance
JOIN "InfrastructureOrder" AS infrastructure_order
  ON infrastructure_order."id" = instance."infrastructureOrderId"
JOIN "InfrastructurePlan" AS plan
  ON plan."id" = infrastructure_order."planId"
WHERE instance."status" = 'ACTIVE'
ON CONFLICT ("cloudInstanceId") DO NOTHING;
