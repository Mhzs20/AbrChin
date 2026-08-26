-- MessageGo V2 wallet authority and customer connection metadata.
-- Reuses Wallet + WalletLedgerEntry. Does not create a parallel AI wallet.

ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'MESSAGEGO_RESERVE_HOLD';
ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'MESSAGEGO_SETTLEMENT';
ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'MESSAGEGO_HOLD_RELEASE';

CREATE TYPE "MessageGoReservationStatus" AS ENUM (
  'RESERVED',
  'SETTLED',
  'RELEASED',
  'UNCERTAIN',
  'RECONCILED'
);

CREATE TYPE "MessageGoSettlementOpKind" AS ENUM (
  'RESERVE',
  'SETTLE',
  'RELEASE',
  'RECONCILE'
);

CREATE TYPE "MessageGoConnectionOwnership" AS ENUM (
  'PLATFORM_MANAGED',
  'ACCOUNT_BYOK',
  'PROJECT_BYOK'
);

CREATE TYPE "MessageGoCustomerConnectionStatus" AS ENUM (
  'UNCONFIGURED',
  'HANDOFF_REQUIRED',
  'CONNECTED',
  'CONTROL_PLANE_UNAVAILABLE',
  'HANDOFF_FAILED'
);

CREATE TABLE "MessageGoAuthorityReservation" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "usageReservationId" TEXT NOT NULL,
  "callerServiceId" TEXT NOT NULL,
  "holdAmountRial" BIGINT NOT NULL,
  "remainingHoldRial" BIGINT NOT NULL,
  "settledAmountRial" BIGINT NOT NULL DEFAULT 0,
  "status" "MessageGoReservationStatus" NOT NULL,
  "pricingFingerprint" TEXT NOT NULL,
  "pricingVersion" TEXT NOT NULL,
  "reserveOperationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MessageGoAuthorityReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageGoAuthorityReservation_usageReservationId_key"
  ON "MessageGoAuthorityReservation"("usageReservationId");
CREATE UNIQUE INDEX "MessageGoAuthorityReservation_reserveOperationId_key"
  ON "MessageGoAuthorityReservation"("reserveOperationId");
CREATE INDEX "MessageGoAuthorityReservation_accountId_createdAt_idx"
  ON "MessageGoAuthorityReservation"("accountId", "createdAt");
CREATE INDEX "MessageGoAuthorityReservation_walletId_idx"
  ON "MessageGoAuthorityReservation"("walletId");
CREATE INDEX "MessageGoAuthorityReservation_productId_workspaceId_idx"
  ON "MessageGoAuthorityReservation"("productId", "workspaceId");
CREATE INDEX "MessageGoAuthorityReservation_runId_idx"
  ON "MessageGoAuthorityReservation"("runId");
CREATE INDEX "MessageGoAuthorityReservation_status_createdAt_idx"
  ON "MessageGoAuthorityReservation"("status", "createdAt");

ALTER TABLE "MessageGoAuthorityReservation"
  ADD CONSTRAINT "MessageGoAuthorityReservation_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MessageGoAuthorityReservation"
  ADD CONSTRAINT "MessageGoAuthorityReservation_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "Wallet"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "MessageGoSettlementOperation" (
  "id" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "kind" "MessageGoSettlementOpKind" NOT NULL,
  "bodyFingerprint" TEXT NOT NULL,
  "reservationId" TEXT,
  "accountId" TEXT NOT NULL,
  "outcomeJson" JSONB NOT NULL,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MessageGoSettlementOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageGoSettlementOperation_operationId_key"
  ON "MessageGoSettlementOperation"("operationId");
CREATE INDEX "MessageGoSettlementOperation_reservationId_idx"
  ON "MessageGoSettlementOperation"("reservationId");
CREATE INDEX "MessageGoSettlementOperation_accountId_createdAt_idx"
  ON "MessageGoSettlementOperation"("accountId", "createdAt");
CREATE INDEX "MessageGoSettlementOperation_kind_createdAt_idx"
  ON "MessageGoSettlementOperation"("kind", "createdAt");

ALTER TABLE "MessageGoSettlementOperation"
  ADD CONSTRAINT "MessageGoSettlementOperation_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "MessageGoAuthorityReservation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MessageGoSettlementOperation"
  ADD CONSTRAINT "MessageGoSettlementOperation_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MessageGoReservationEvent" (
  "id" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "payloadJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MessageGoReservationEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MessageGoReservationEvent_reservationId_createdAt_idx"
  ON "MessageGoReservationEvent"("reservationId", "createdAt");
CREATE INDEX "MessageGoReservationEvent_operationId_idx"
  ON "MessageGoReservationEvent"("operationId");

ALTER TABLE "MessageGoReservationEvent"
  ADD CONSTRAINT "MessageGoReservationEvent_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "MessageGoAuthorityReservation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MessageGoCustomerConnection" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "alias" TEXT NOT NULL,
  "ownershipMode" "MessageGoConnectionOwnership" NOT NULL,
  "familyAlias" TEXT,
  "status" "MessageGoCustomerConnectionStatus" NOT NULL,
  "secretRef" TEXT,
  "lastHandoffAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MessageGoCustomerConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageGoCustomerConnection_userId_productId_workspaceId_alias_key"
  ON "MessageGoCustomerConnection"("userId", "productId", "workspaceId", "alias");
CREATE INDEX "MessageGoCustomerConnection_userId_createdAt_idx"
  ON "MessageGoCustomerConnection"("userId", "createdAt");
CREATE INDEX "MessageGoCustomerConnection_status_idx"
  ON "MessageGoCustomerConnection"("status");

ALTER TABLE "MessageGoCustomerConnection"
  ADD CONSTRAINT "MessageGoCustomerConnection_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
