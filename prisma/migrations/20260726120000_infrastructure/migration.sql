-- CreateEnum
CREATE TYPE "InfrastructureProvider" AS ENUM ('PARSPACK');

-- CreateEnum
CREATE TYPE "DeliveryMode" AS ENUM ('RAW', 'MANAGED');

-- CreateEnum
CREATE TYPE "InfrastructureOrderStatus" AS ENUM (
  'WAITING_ADMIN_FUNDING',
  'FUNDING_CONFIRMED',
  'QUEUED',
  'PROVISIONING',
  'ACTIVE',
  'BLOCKED_PROVIDER_BALANCE',
  'NEEDS_RECONCILIATION',
  'FAILED',
  'CANCELED',
  'REFUNDED'
);

-- CreateEnum
CREATE TYPE "ProvisioningJobStatus" AS ENUM (
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'BLOCKED_PROVIDER_BALANCE',
  'NEEDS_RECONCILIATION'
);

-- CreateEnum
CREATE TYPE "AdminNotificationType" AS ENUM (
  'ORDER_WAITING_PROVIDER_FUNDING',
  'PROVIDER_BALANCE_BLOCKED',
  'PROVISIONING_FAILED',
  'NEEDS_RECONCILIATION',
  'INSTANCE_ACTIVE',
  'PAYMENT_FAILED',
  'PROVIDER_UNAVAILABLE'
);

-- CreateEnum
CREATE TYPE "AdminNotificationStatus" AS ENUM ('UNREAD', 'READ', 'RESOLVED');

-- CreateEnum
CREATE TYPE "CloudInstanceStatus" AS ENUM ('PENDING', 'ACTIVE', 'FAILED', 'TERMINATED');

-- AlterTable
ALTER TABLE "ServiceOrder" ADD COLUMN "planId" TEXT;
ALTER TABLE "ServiceOrder" ADD COLUMN "planSnapshot" JSONB;

-- CreateTable
CREATE TABLE "InfrastructurePlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "provider" "InfrastructureProvider" NOT NULL,
    "regionCode" TEXT NOT NULL,
    "sizeCode" TEXT NOT NULL,
    "imageCode" TEXT NOT NULL,
    "deliveryMode" "DeliveryMode" NOT NULL,
    "salePriceRial" BIGINT NOT NULL,
    "estimatedProviderCostRial" BIGINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "InfrastructurePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InfrastructureOrder" (
    "id" TEXT NOT NULL,
    "serviceOrderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "provider" "InfrastructureProvider" NOT NULL,
    "deliveryMode" "DeliveryMode" NOT NULL,
    "status" "InfrastructureOrderStatus" NOT NULL DEFAULT 'WAITING_ADMIN_FUNDING',
    "requiredFundingRial" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InfrastructureOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderFundingConfirmation" (
    "id" TEXT NOT NULL,
    "infrastructureOrderId" TEXT NOT NULL,
    "provider" "InfrastructureProvider" NOT NULL,
    "requiredAmountRial" BIGINT NOT NULL,
    "fundedAmountRial" BIGINT NOT NULL,
    "receiptReference" TEXT,
    "note" TEXT,
    "confirmedById" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "ProviderFundingConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProvisioningJob" (
    "id" TEXT NOT NULL,
    "infrastructureOrderId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "status" "ProvisioningJobStatus" NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "providerRequestId" TEXT,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProvisioningJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloudInstance" (
    "id" TEXT NOT NULL,
    "infrastructureOrderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "InfrastructureProvider" NOT NULL,
    "providerInstanceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "deliveryMode" "DeliveryMode" NOT NULL,
    "ipv4" TEXT,
    "status" "CloudInstanceStatus" NOT NULL DEFAULT 'PENDING',
    "provisionedAt" TIMESTAMP(3),
    "terminatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloudInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminNotification" (
    "id" TEXT NOT NULL,
    "type" "AdminNotificationType" NOT NULL,
    "infrastructureOrderId" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "AdminNotificationStatus" NOT NULL DEFAULT 'UNREAD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "AdminNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderOperationLog" (
    "id" TEXT NOT NULL,
    "provider" "InfrastructureProvider" NOT NULL,
    "operation" TEXT NOT NULL,
    "infrastructureOrderId" TEXT,
    "provisioningJobId" TEXT,
    "status" TEXT NOT NULL,
    "requestSummary" JSONB,
    "responseSummary" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderOperationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "beforeData" JSONB,
    "afterData" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCatalogState" (
    "id" TEXT NOT NULL,
    "provider" "InfrastructureProvider" NOT NULL,
    "lastHealthCheck" TIMESTAMP(3),
    "lastCatalogSync" TIMESTAMP(3),
    "regionCount" INTEGER NOT NULL DEFAULT 0,
    "sizeCount" INTEGER NOT NULL DEFAULT 0,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderCatalogState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InfrastructurePlan_code_key" ON "InfrastructurePlan"("code");
CREATE INDEX "InfrastructurePlan_active_sortOrder_idx" ON "InfrastructurePlan"("active", "sortOrder");
CREATE INDEX "InfrastructurePlan_provider_active_idx" ON "InfrastructurePlan"("provider", "active");

CREATE UNIQUE INDEX "InfrastructureOrder_serviceOrderId_key" ON "InfrastructureOrder"("serviceOrderId");
CREATE INDEX "InfrastructureOrder_userId_createdAt_idx" ON "InfrastructureOrder"("userId", "createdAt");
CREATE INDEX "InfrastructureOrder_status_createdAt_idx" ON "InfrastructureOrder"("status", "createdAt");
CREATE INDEX "InfrastructureOrder_planId_idx" ON "InfrastructureOrder"("planId");

CREATE UNIQUE INDEX "ProviderFundingConfirmation_infrastructureOrderId_key" ON "ProviderFundingConfirmation"("infrastructureOrderId");
CREATE INDEX "ProviderFundingConfirmation_confirmedById_confirmedAt_idx" ON "ProviderFundingConfirmation"("confirmedById", "confirmedAt");

CREATE UNIQUE INDEX "ProvisioningJob_idempotencyKey_key" ON "ProvisioningJob"("idempotencyKey");
CREATE INDEX "ProvisioningJob_infrastructureOrderId_createdAt_idx" ON "ProvisioningJob"("infrastructureOrderId", "createdAt");
CREATE INDEX "ProvisioningJob_status_createdAt_idx" ON "ProvisioningJob"("status", "createdAt");

CREATE UNIQUE INDEX "CloudInstance_infrastructureOrderId_key" ON "CloudInstance"("infrastructureOrderId");
CREATE UNIQUE INDEX "CloudInstance_providerInstanceId_key" ON "CloudInstance"("providerInstanceId");
CREATE INDEX "CloudInstance_userId_createdAt_idx" ON "CloudInstance"("userId", "createdAt");
CREATE INDEX "CloudInstance_status_idx" ON "CloudInstance"("status");

CREATE INDEX "AdminNotification_status_createdAt_idx" ON "AdminNotification"("status", "createdAt");
CREATE INDEX "AdminNotification_type_createdAt_idx" ON "AdminNotification"("type", "createdAt");
CREATE INDEX "AdminNotification_infrastructureOrderId_idx" ON "AdminNotification"("infrastructureOrderId");

CREATE INDEX "ProviderOperationLog_provider_createdAt_idx" ON "ProviderOperationLog"("provider", "createdAt");
CREATE INDEX "ProviderOperationLog_infrastructureOrderId_createdAt_idx" ON "ProviderOperationLog"("infrastructureOrderId", "createdAt");
CREATE INDEX "ProviderOperationLog_provisioningJobId_idx" ON "ProviderOperationLog"("provisioningJobId");

CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

CREATE UNIQUE INDEX "ProviderCatalogState_provider_key" ON "ProviderCatalogState"("provider");

CREATE INDEX "ServiceOrder_planId_idx" ON "ServiceOrder"("planId");

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_planId_fkey" FOREIGN KEY ("planId") REFERENCES "InfrastructurePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InfrastructurePlan" ADD CONSTRAINT "InfrastructurePlan_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InfrastructureOrder" ADD CONSTRAINT "InfrastructureOrder_serviceOrderId_fkey" FOREIGN KEY ("serviceOrderId") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InfrastructureOrder" ADD CONSTRAINT "InfrastructureOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InfrastructureOrder" ADD CONSTRAINT "InfrastructureOrder_planId_fkey" FOREIGN KEY ("planId") REFERENCES "InfrastructurePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProviderFundingConfirmation" ADD CONSTRAINT "ProviderFundingConfirmation_infrastructureOrderId_fkey" FOREIGN KEY ("infrastructureOrderId") REFERENCES "InfrastructureOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderFundingConfirmation" ADD CONSTRAINT "ProviderFundingConfirmation_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProvisioningJob" ADD CONSTRAINT "ProvisioningJob_infrastructureOrderId_fkey" FOREIGN KEY ("infrastructureOrderId") REFERENCES "InfrastructureOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CloudInstance" ADD CONSTRAINT "CloudInstance_infrastructureOrderId_fkey" FOREIGN KEY ("infrastructureOrderId") REFERENCES "InfrastructureOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CloudInstance" ADD CONSTRAINT "CloudInstance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdminNotification" ADD CONSTRAINT "AdminNotification_infrastructureOrderId_fkey" FOREIGN KEY ("infrastructureOrderId") REFERENCES "InfrastructureOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProviderOperationLog" ADD CONSTRAINT "ProviderOperationLog_infrastructureOrderId_fkey" FOREIGN KEY ("infrastructureOrderId") REFERENCES "InfrastructureOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProviderOperationLog" ADD CONSTRAINT "ProviderOperationLog_provisioningJobId_fkey" FOREIGN KEY ("provisioningJobId") REFERENCES "ProvisioningJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
