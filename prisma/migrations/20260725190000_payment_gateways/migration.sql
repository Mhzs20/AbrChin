-- AlterEnum
CREATE TYPE "PaymentGatewayProvider" AS ENUM ('ZIBAL', 'ZARINPAL', 'MOCK');

-- AlterEnum
CREATE TYPE "PaymentGatewayEnvironment" AS ENUM ('DEVELOPMENT', 'SANDBOX', 'PRODUCTION');

-- Normalize legacy gateway strings before type conversion
UPDATE "WalletTopUp"
SET "gateway" = CASE
  WHEN lower("gateway") IN ('zibal') THEN 'ZIBAL'
  WHEN lower("gateway") IN ('zarinpal', 'zarin_pal') THEN 'ZARINPAL'
  WHEN lower("gateway") IN ('mock') THEN 'MOCK'
  ELSE 'MOCK'
END;

-- AlterTable WalletTopUp
ALTER TABLE "WalletTopUp"
  ALTER COLUMN "gateway" TYPE "PaymentGatewayProvider"
  USING ("gateway"::"PaymentGatewayProvider");

ALTER TABLE "WalletTopUp"
  ADD COLUMN "gatewayConfigSnapshot" JSONB;

CREATE INDEX "WalletTopUp_gateway_status_idx" ON "WalletTopUp"("gateway", "status");

-- CreateTable
CREATE TABLE "PaymentGatewayConfig" (
    "id" TEXT NOT NULL,
    "provider" "PaymentGatewayProvider" NOT NULL,
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL,
    "environment" "PaymentGatewayEnvironment" NOT NULL,
    "minAmountRial" BIGINT,
    "maxAmountRial" BIGINT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "PaymentGatewayConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentGatewayConfig_provider_key" ON "PaymentGatewayConfig"("provider");
CREATE INDEX "PaymentGatewayConfig_enabled_isDefault_idx" ON "PaymentGatewayConfig"("enabled", "isDefault");
CREATE INDEX "PaymentGatewayConfig_priority_idx" ON "PaymentGatewayConfig"("priority");

ALTER TABLE "PaymentGatewayConfig"
  ADD CONSTRAINT "PaymentGatewayConfig_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "PaymentGatewayAuditLog" (
    "id" TEXT NOT NULL,
    "gatewayConfigId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeData" JSONB,
    "afterData" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentGatewayAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentGatewayAuditLog_gatewayConfigId_createdAt_idx"
  ON "PaymentGatewayAuditLog"("gatewayConfigId", "createdAt");
CREATE INDEX "PaymentGatewayAuditLog_actorUserId_createdAt_idx"
  ON "PaymentGatewayAuditLog"("actorUserId", "createdAt");

ALTER TABLE "PaymentGatewayAuditLog"
  ADD CONSTRAINT "PaymentGatewayAuditLog_gatewayConfigId_fkey"
  FOREIGN KEY ("gatewayConfigId") REFERENCES "PaymentGatewayConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentGatewayAuditLog"
  ADD CONSTRAINT "PaymentGatewayAuditLog_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed gateway configs: Zibal default (priority 10), ZarinPal (20), Mock disabled in seed
INSERT INTO "PaymentGatewayConfig" (
  "id", "provider", "displayName", "enabled", "isDefault", "priority", "environment", "description", "createdAt", "updatedAt"
) VALUES
  (
    'pgw_zibal_bootstrap',
    'ZIBAL',
    'زیبال',
    true,
    true,
    10,
    'PRODUCTION',
    'درگاه پیش‌فرض Production ابرچین',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'pgw_zarinpal_bootstrap',
    'ZARINPAL',
    'زرین‌پال',
    false,
    false,
    20,
    'PRODUCTION',
    'درگاه جایگزین Production',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'pgw_mock_bootstrap',
    'MOCK',
    'آزمایشی',
    false,
    false,
    100,
    'DEVELOPMENT',
    'فقط Development/Test',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );
