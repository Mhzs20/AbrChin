-- Forward-only Wallet PAYG billing core.
-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('CREATED', 'PENDING', 'SUCCEEDED', 'REVIEW', 'FAILED', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentReviewStatus" AS ENUM ('OPEN', 'RECONCILING', 'RESOLVED', 'DEFINITIVELY_FAILED', 'REFUND_REVIEW');

-- CreateEnum
CREATE TYPE "ControlledRefundStatus" AS ENUM ('REQUESTED', 'REVIEW_REQUIRED', 'APPROVED', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProductBillingModel" AS ENUM ('PAYG_WALLET', 'PREPAID_TERM');

-- CreateEnum
CREATE TYPE "BillingAvailability" AS ENUM ('HOURLY_ONLY', 'DAILY_ONLY', 'HOURLY_AND_DAILY');

-- CreateEnum
CREATE TYPE "BillingCadence" AS ENUM ('HOURLY', 'DAILY');

-- CreateEnum
CREATE TYPE "BillingPriceDisplayMode" AS ENUM ('HOURLY', 'DAILY', 'BOTH');

-- CreateEnum
CREATE TYPE "BillingPolicyScope" AS ENUM ('GLOBAL', 'PLAN');

-- CreateEnum
CREATE TYPE "BillingCalculationUnit" AS ENUM ('SECOND', 'MINUTE', 'HOUR', 'DAY');

-- CreateEnum
CREATE TYPE "BillingRoundingPolicy" AS ENUM ('EXACT', 'CEIL_UNIT', 'FLOOR_UNIT', 'NEAREST_UNIT');

-- CreateEnum
CREATE TYPE "ActivationRequestStatus" AS ENUM ('CREDIT_REQUIRED', 'WAITING_ADMIN_APPROVAL', 'APPROVED', 'PROVISIONING', 'PROVIDER_CONFIRMED', 'WAITING_DELIVERY_APPROVAL', 'ACTIVE', 'HELD', 'CANCELED');

-- CreateEnum
CREATE TYPE "ResourceChangeStatus" AS ENUM ('REQUESTED', 'CREDIT_REQUIRED', 'WAITING_ADMIN_APPROVAL', 'APPROVED', 'PROVIDER_MUTATION_PENDING', 'PROVIDER_CONFIRMED', 'APPLIED', 'REVIEW', 'CANCELED');

-- CreateEnum
CREATE TYPE "ResourceVersionState" AS ENUM ('ACTIVE', 'STOPPED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "UsageIntervalStatus" AS ENUM ('OPEN', 'COMPLETE', 'INCOMPLETE', 'REVIEW');

-- CreateEnum
CREATE TYPE "BillingRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "BillingInvoiceStatus" AS ENUM ('CALCULATING', 'PAID', 'PARTIALLY_PAID', 'UNPAID', 'UNDER_REVIEW', 'VOID');

-- CreateEnum
CREATE TYPE "BillingComponentType" AS ENUM ('COMPUTE', 'DISK', 'IP', 'BACKUP', 'TRAFFIC', 'SNAPSHOT', 'ADDON', 'ONE_TIME', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "OutstandingBalanceStatus" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'PAID', 'WAIVED');

-- CreateEnum
CREATE TYPE "BillingReconciliationKind" AS ENUM ('RATE_CARD', 'RESOURCE_STATE', 'PROVIDER_USAGE', 'PROVIDER_INVOICE', 'PROVIDER_ACCOUNT_BALANCE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "BillingReconciliationStatus" AS ENUM ('PENDING', 'MATCHED', 'MISMATCH', 'REVIEW', 'ADJUSTED', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "DunningCaseType" AS ENUM ('LOW_BALANCE', 'OUTSTANDING_INVOICE', 'SUSPENSION_REVIEW');

-- CreateEnum
CREATE TYPE "DunningCaseStatus" AS ENUM ('OPEN', 'NOTIFIED', 'GRACE', 'ADMIN_REVIEW', 'RESOLVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminNotificationType" ADD VALUE 'ACTIVATION_WAITING_APPROVAL';
ALTER TYPE "AdminNotificationType" ADD VALUE 'RESOURCE_CHANGE_WAITING_APPROVAL';
ALTER TYPE "AdminNotificationType" ADD VALUE 'WALLET_PAYMENT_REVIEW';
ALTER TYPE "AdminNotificationType" ADD VALUE 'WALLET_CREDIT_RECONCILIATION';
ALTER TYPE "AdminNotificationType" ADD VALUE 'CONTROLLED_REFUND_REVIEW';
ALTER TYPE "AdminNotificationType" ADD VALUE 'LOW_BALANCE';
ALTER TYPE "AdminNotificationType" ADD VALUE 'OUTSTANDING_INVOICE';
ALTER TYPE "AdminNotificationType" ADD VALUE 'SUSPENSION_REVIEW';
ALTER TYPE "AdminNotificationType" ADD VALUE 'PROVIDER_BILLING_RECONCILIATION';
ALTER TYPE "AdminNotificationType" ADD VALUE 'CONNECTION_CHECK_FAILED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerType" ADD VALUE 'TOP_UP_REFUND';
ALTER TYPE "LedgerType" ADD VALUE 'USAGE_SETTLEMENT';
ALTER TYPE "LedgerType" ADD VALUE 'BILLING_ADJUSTMENT';

-- AlterTable
ALTER TABLE "InfrastructurePlan" ADD COLUMN     "billingModel" "ProductBillingModel" NOT NULL DEFAULT 'PREPAID_TERM',
ADD COLUMN     "billingPolicyVersionId" TEXT;

-- AlterTable
ALTER TABLE "ProvisioningJob" ALTER COLUMN "attempt" SET DEFAULT 1;

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "walletTopUpId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IRR',
    "gateway" "PaymentGatewayProvider" NOT NULL,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATED',
    "authority" TEXT,
    "gatewayReference" TEXT,
    "gatewayConfigSnapshot" JSONB,
    "callbackTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3),
    "nextReconcileAt" TIMESTAMPTZ(3),
    "verificationAttempts" INTEGER NOT NULL DEFAULT 0,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "redirectUrl" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRecoveryCase" (
    "id" TEXT NOT NULL,
    "walletTopUpId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "status" "PaymentReviewStatus" NOT NULL DEFAULT 'OPEN',
    "reasonCode" TEXT NOT NULL,
    "safeMessage" TEXT NOT NULL,
    "expectedAmount" BIGINT NOT NULL,
    "observedAmount" BIGINT,
    "expectedCurrency" TEXT NOT NULL DEFAULT 'IRR',
    "observedCurrency" TEXT,
    "nextAttemptAt" TIMESTAMPTZ(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PaymentRecoveryCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRecoveryAction" (
    "id" TEXT NOT NULL,
    "recoveryCaseId" TEXT NOT NULL,
    "paymentAttemptId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resultCode" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRecoveryAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTopUpRefund" (
    "id" TEXT NOT NULL,
    "walletTopUpId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IRR',
    "status" "ControlledRefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "reviewReason" TEXT,
    "ledgerEntryId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "WalletTopUpRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingPolicyVersion" (
    "id" TEXT NOT NULL,
    "policyKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "scope" "BillingPolicyScope" NOT NULL,
    "planId" TEXT,
    "availability" "BillingAvailability" NOT NULL,
    "defaultCadence" "BillingCadence" NOT NULL,
    "displayMode" "BillingPriceDisplayMode" NOT NULL,
    "hourlyMinimumCreditHours" INTEGER NOT NULL DEFAULT 24,
    "dailyMinimumCreditDays" INTEGER NOT NULL DEFAULT 1,
    "hourlyGracePeriods" INTEGER NOT NULL DEFAULT 24,
    "dailyGracePeriods" INTEGER NOT NULL DEFAULT 3,
    "lowBalanceThresholdPeriods" INTEGER NOT NULL DEFAULT 3,
    "calculationUnit" "BillingCalculationUnit" NOT NULL,
    "minimumChargeSeconds" INTEGER NOT NULL DEFAULT 0,
    "roundingPolicy" "BillingRoundingPolicy" NOT NULL,
    "prorationSupported" BOOLEAN NOT NULL DEFAULT true,
    "stopStateComponentPolicy" JSONB NOT NULL,
    "enabledCadences" JSONB NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(3),
    "createdById" TEXT,
    "changeReason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingPolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivationRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serviceOrderId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "billingPolicyVersionId" TEXT NOT NULL,
    "infrastructureOrderId" TEXT,
    "selectedCadence" "BillingCadence" NOT NULL,
    "status" "ActivationRequestStatus" NOT NULL DEFAULT 'WAITING_ADMIN_APPROVAL',
    "estimatedHourlyRial" BIGINT,
    "estimatedDailyRial" BIGINT,
    "oneTimeChargesRial" BIGINT NOT NULL DEFAULT 0,
    "minimumCreditRequiredRial" BIGINT NOT NULL,
    "estimateSnapshot" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstApprovedAt" TIMESTAMPTZ(3),
    "firstApprovedById" TEXT,
    "providerConfirmedAt" TIMESTAMPTZ(3),
    "activeAt" TIMESTAMPTZ(3),
    "canceledAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ActivationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceBillingPolicySnapshot" (
    "id" TEXT NOT NULL,
    "cloudInstanceId" TEXT NOT NULL,
    "billingPolicyVersionId" TEXT NOT NULL,
    "activationRequestId" TEXT,
    "cadence" "BillingCadence" NOT NULL,
    "displayMode" "BillingPriceDisplayMode" NOT NULL,
    "calculationUnit" "BillingCalculationUnit" NOT NULL,
    "minimumChargeSeconds" INTEGER NOT NULL,
    "roundingPolicy" "BillingRoundingPolicy" NOT NULL,
    "prorationSupported" BOOLEAN NOT NULL,
    "hourlyEstimateRial" BIGINT,
    "dailyEstimateRial" BIGINT,
    "minimumCreditRial" BIGINT NOT NULL,
    "gracePeriods" INTEGER NOT NULL,
    "lowBalanceThresholdPeriods" INTEGER NOT NULL,
    "stopStateComponentPolicy" JSONB NOT NULL,
    "providerPolicySnapshot" JSONB NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(3),
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceBillingPolicySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceChangeRequest" (
    "id" TEXT NOT NULL,
    "cloudInstanceId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "sourceResourceVersionId" TEXT,
    "targetBillingPolicyVersionId" TEXT,
    "targetCadence" "BillingCadence",
    "requestedResources" JSONB NOT NULL,
    "estimateSnapshot" JSONB NOT NULL,
    "incrementalBufferRial" BIGINT NOT NULL DEFAULT 0,
    "status" "ResourceChangeStatus" NOT NULL DEFAULT 'REQUESTED',
    "idempotencyKey" TEXT NOT NULL,
    "providerMutationId" TEXT,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMPTZ(3),
    "providerConfirmedAt" TIMESTAMPTZ(3),
    "effectiveFrom" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ResourceChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceVersion" (
    "id" TEXT NOT NULL,
    "cloudInstanceId" TEXT NOT NULL,
    "provider" "InfrastructureProvider" NOT NULL,
    "providerInstanceId" TEXT NOT NULL,
    "sourceChangeRequestId" TEXT,
    "state" "ResourceVersionState" NOT NULL,
    "vcpu" INTEGER NOT NULL,
    "ramMb" INTEGER NOT NULL,
    "diskGb" INTEGER NOT NULL,
    "ipv4Count" INTEGER NOT NULL DEFAULT 1,
    "backupEnabled" BOOLEAN NOT NULL DEFAULT false,
    "snapshotCount" INTEGER NOT NULL DEFAULT 0,
    "resourceSnapshot" JSONB NOT NULL,
    "providerEventId" TEXT,
    "providerConfirmedAt" TIMESTAMPTZ(3) NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(3),
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResourceVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateCardVersion" (
    "id" TEXT NOT NULL,
    "planId" TEXT,
    "provider" "InfrastructureProvider" NOT NULL,
    "providerApiVersion" TEXT NOT NULL DEFAULT 'v1',
    "productKind" "InfrastructureProductKind" NOT NULL,
    "externalPlanId" TEXT NOT NULL,
    "regionCode" TEXT NOT NULL,
    "component" "BillingComponentType" NOT NULL,
    "rateCadence" "BillingCadence",
    "calculationUnit" "BillingCalculationUnit" NOT NULL,
    "minimumChargeSeconds" INTEGER NOT NULL DEFAULT 0,
    "roundingPolicy" "BillingRoundingPolicy" NOT NULL,
    "prorationSupported" BOOLEAN NOT NULL,
    "providerAmount" BIGINT NOT NULL,
    "providerCurrency" TEXT NOT NULL,
    "providerAmountUnit" TEXT NOT NULL,
    "normalizedProviderRial" BIGINT NOT NULL,
    "markupBasisPoints" INTEGER NOT NULL,
    "customerRateRial" BIGINT NOT NULL,
    "sourceRevision" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(3),
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateCardVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageInterval" (
    "id" TEXT NOT NULL,
    "cloudInstanceId" TEXT NOT NULL,
    "resourceVersionId" TEXT NOT NULL,
    "billingPolicySnapshotId" TEXT NOT NULL,
    "status" "UsageIntervalStatus" NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "endedAt" TIMESTAMPTZ(3),
    "providerEventStartId" TEXT,
    "providerEventEndId" TEXT,
    "completenessReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UsageInterval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingRun" (
    "id" TEXT NOT NULL,
    "cadence" "BillingCadence" NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "status" "BillingRunStatus" NOT NULL DEFAULT 'RUNNING',
    "workerId" TEXT NOT NULL,
    "invoiceCount" INTEGER NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "failureCode" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "BillingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingInvoice" (
    "id" TEXT NOT NULL,
    "billingRunId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "cloudInstanceId" TEXT NOT NULL,
    "billingPolicySnapshotId" TEXT NOT NULL,
    "cadence" "BillingCadence" NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "status" "BillingInvoiceStatus" NOT NULL DEFAULT 'CALCULATING',
    "totalAmountRial" BIGINT NOT NULL DEFAULT 0,
    "paidAmountRial" BIGINT NOT NULL DEFAULT 0,
    "outstandingAmountRial" BIGINT NOT NULL DEFAULT 0,
    "finalizedAt" TIMESTAMPTZ(3),
    "settledAt" TIMESTAMPTZ(3),
    "reviewReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BillingInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingLine" (
    "id" TEXT NOT NULL,
    "billingInvoiceId" TEXT NOT NULL,
    "usageIntervalId" TEXT,
    "resourceVersionId" TEXT NOT NULL,
    "rateCardVersionId" TEXT NOT NULL,
    "component" "BillingComponentType" NOT NULL,
    "intervalStart" TIMESTAMPTZ(3) NOT NULL,
    "intervalEnd" TIMESTAMPTZ(3) NOT NULL,
    "quantityNumerator" BIGINT NOT NULL,
    "quantityDenominator" BIGINT NOT NULL,
    "providerCostRial" BIGINT NOT NULL,
    "markupBasisPoints" INTEGER NOT NULL,
    "markupAmountRial" BIGINT NOT NULL,
    "amountRial" BIGINT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutstandingBalance" (
    "id" TEXT NOT NULL,
    "billingInvoiceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originalAmountRial" BIGINT NOT NULL,
    "paidAmountRial" BIGINT NOT NULL DEFAULT 0,
    "remainingAmountRial" BIGINT NOT NULL,
    "status" "OutstandingBalanceStatus" NOT NULL DEFAULT 'OPEN',
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OutstandingBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingReconciliation" (
    "id" TEXT NOT NULL,
    "provider" "InfrastructureProvider" NOT NULL,
    "kind" "BillingReconciliationKind" NOT NULL,
    "status" "BillingReconciliationStatus" NOT NULL DEFAULT 'PENDING',
    "cloudInstanceId" TEXT,
    "billingInvoiceId" TEXT,
    "internalAmountRial" BIGINT,
    "providerAmount" BIGINT,
    "providerCurrency" TEXT,
    "providerAmountUnit" TEXT,
    "normalizedProviderRial" BIGINT,
    "differenceRial" BIGINT,
    "reason" TEXT,
    "evidence" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "detectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "BillingReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DunningCase" (
    "id" TEXT NOT NULL,
    "cloudInstanceId" TEXT NOT NULL,
    "billingInvoiceId" TEXT,
    "type" "DunningCaseType" NOT NULL,
    "status" "DunningCaseStatus" NOT NULL DEFAULT 'OPEN',
    "thresholdRial" BIGINT NOT NULL,
    "observedBalanceRial" BIGINT NOT NULL,
    "runwaySeconds" BIGINT,
    "graceEndsAt" TIMESTAMPTZ(3),
    "notificationSentAt" TIMESTAMPTZ(3),
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "DunningCase_pkey" PRIMARY KEY ("id")
);

-- Preserve every historical WalletTopUp as the first immutable attempt.
-- New runtime writes use PaymentAttempt as the gateway-facing aggregate.
INSERT INTO "PaymentAttempt" (
    "id", "walletTopUpId", "attemptNumber", "amount", "currency",
    "gateway", "status", "authority", "gatewayReference",
    "gatewayConfigSnapshot", "callbackTokenHash", "expiresAt",
    "verifiedAt", "verificationAttempts", "failureCode", "failureMessage",
    "idempotencyKey", "redirectUrl", "createdAt", "updatedAt"
)
SELECT
    'legacy-payment-attempt-' || md5(topup."id"),
    topup."id",
    1,
    topup."amount",
    'IRR',
    topup."gateway",
    topup."status"::text::"PaymentAttemptStatus",
    topup."authority",
    topup."gatewayReference",
    topup."gatewayConfigSnapshot",
    topup."callbackTokenHash",
    topup."expiresAt" AT TIME ZONE 'UTC',
    topup."verifiedAt" AT TIME ZONE 'UTC',
    CASE WHEN topup."verifiedAt" IS NULL THEN 0 ELSE 1 END,
    topup."failureCode",
    topup."failureMessage",
    'legacy-wallet-topup-attempt:' || topup."id",
    topup."redirectUrl",
    topup."createdAt" AT TIME ZONE 'UTC',
    topup."updatedAt" AT TIME ZONE 'UTC'
FROM "WalletTopUp" AS topup;

-- Global defaults apply only to future Cloud activations. Existing active
-- services receive a separate DAILY legacy snapshot below, so this migration
-- never silently changes their cadence or bills historical usage.
INSERT INTO "BillingPolicyVersion" (
    "id", "policyKey", "version", "scope", "planId",
    "availability", "defaultCadence", "displayMode",
    "hourlyMinimumCreditHours", "dailyMinimumCreditDays",
    "hourlyGracePeriods", "dailyGracePeriods",
    "lowBalanceThresholdPeriods", "calculationUnit",
    "minimumChargeSeconds", "roundingPolicy", "prorationSupported",
    "stopStateComponentPolicy", "enabledCadences",
    "effectiveFrom", "effectiveTo", "createdById", "changeReason"
)
VALUES (
    'billing-policy-global-v1',
    'global',
    1,
    'GLOBAL',
    NULL,
    'HOURLY_ONLY',
    'HOURLY',
    'BOTH',
    24,
    1,
    24,
    3,
    3,
    'SECOND',
    0,
    'EXACT',
    true,
    '{"COMPUTE":true,"DISK":true,"IP":true,"BACKUP":true,"TRAFFIC":false,"SNAPSHOT":true}'::jsonb,
    '["HOURLY"]'::jsonb,
    CURRENT_TIMESTAMP,
    NULL::timestamptz,
    NULL::text,
    'wallet_payg_hourly_default'
);

UPDATE "InfrastructurePlan"
SET
    "billingModel" = 'PAYG_WALLET',
    "billingPolicyVersionId" = 'billing-policy-global-v1'
WHERE "productKind" = 'CLOUD_SERVER';

INSERT INTO "BillingPolicyVersion" (
    "id", "policyKey", "version", "scope", "planId",
    "availability", "defaultCadence", "displayMode",
    "hourlyMinimumCreditHours", "dailyMinimumCreditDays",
    "hourlyGracePeriods", "dailyGracePeriods",
    "lowBalanceThresholdPeriods", "calculationUnit",
    "minimumChargeSeconds", "roundingPolicy", "prorationSupported",
    "stopStateComponentPolicy", "enabledCadences",
    "effectiveFrom", "effectiveTo", "createdById", "changeReason"
)
SELECT DISTINCT
    'legacy-daily-policy-' || md5(plan."id"),
    'plan:' || plan."id" || ':legacy-active-daily',
    1,
    'PLAN'::"BillingPolicyScope",
    plan."id",
    'DAILY_ONLY'::"BillingAvailability",
    'DAILY'::"BillingCadence",
    'BOTH'::"BillingPriceDisplayMode",
    24,
    1,
    24,
    3,
    3,
    'SECOND'::"BillingCalculationUnit",
    0,
    'EXACT'::"BillingRoundingPolicy",
    true,
    '{"COMPUTE":true,"DISK":true,"IP":true,"BACKUP":true,"TRAFFIC":false,"SNAPSHOT":true}'::jsonb,
    '["DAILY"]'::jsonb,
    CURRENT_TIMESTAMP,
    NULL::timestamptz,
    NULL::text,
    'legacy_active_service_non_retroactive_daily_snapshot'
FROM "CloudInstance" AS instance
JOIN "InfrastructureOrder" AS infrastructure_order
    ON infrastructure_order."id" = instance."infrastructureOrderId"
JOIN "InfrastructurePlan" AS plan
    ON plan."id" = infrastructure_order."planId"
WHERE instance."status" = 'ACTIVE'
  AND plan."productKind" = 'CLOUD_SERVER';

INSERT INTO "ServiceBillingPolicySnapshot" (
    "id", "cloudInstanceId", "billingPolicyVersionId",
    "activationRequestId", "cadence", "displayMode",
    "calculationUnit", "minimumChargeSeconds", "roundingPolicy",
    "prorationSupported", "hourlyEstimateRial", "dailyEstimateRial",
    "minimumCreditRial", "gracePeriods", "lowBalanceThresholdPeriods",
    "stopStateComponentPolicy", "providerPolicySnapshot",
    "effectiveFrom", "effectiveTo", "idempotencyKey"
)
SELECT
    'legacy-billing-snapshot-' || md5(instance."id"),
    instance."id",
    'legacy-daily-policy-' || md5(plan."id"),
    NULL,
    'DAILY'::"BillingCadence",
    'BOTH'::"BillingPriceDisplayMode",
    'SECOND'::"BillingCalculationUnit",
    0,
    'EXACT'::"BillingRoundingPolicy",
    true,
    NULL::bigint,
    NULL::bigint,
    0,
    3,
    3,
    '{"COMPUTE":true,"DISK":true,"IP":true,"BACKUP":true,"TRAFFIC":false,"SNAPSHOT":true}'::jsonb,
    jsonb_build_object(
      'migration', '20260803150000',
      'rateContract', 'REQUIRES_ADMIN_CONFIRMATION',
      'retroactiveBilling', false
    ),
    CURRENT_TIMESTAMP,
    NULL::timestamptz,
    'legacy-active-service-policy:' || instance."id"
FROM "CloudInstance" AS instance
JOIN "InfrastructureOrder" AS infrastructure_order
    ON infrastructure_order."id" = instance."infrastructureOrderId"
JOIN "InfrastructurePlan" AS plan
    ON plan."id" = infrastructure_order."planId"
WHERE instance."status" = 'ACTIVE'
  AND plan."productKind" = 'CLOUD_SERVER';

INSERT INTO "ResourceVersion" (
    "id", "cloudInstanceId", "provider", "providerInstanceId",
    "sourceChangeRequestId", "state", "vcpu", "ramMb", "diskGb",
    "ipv4Count", "backupEnabled", "snapshotCount", "resourceSnapshot",
    "providerEventId", "providerConfirmedAt", "effectiveFrom",
    "effectiveTo", "idempotencyKey"
)
SELECT
    'legacy-resource-version-' || md5(instance."id"),
    instance."id",
    instance."provider",
    instance."providerInstanceId",
    NULL::text,
    CASE
      WHEN lower(coalesce(instance."providerState", 'active')) = 'shutoff'
        THEN 'STOPPED'::"ResourceVersionState"
      ELSE 'ACTIVE'::"ResourceVersionState"
    END,
    plan."vcpu",
    plan."ramGb" * 1024,
    plan."storageGb",
    CASE WHEN instance."ipv4" IS NULL THEN 0 ELSE 1 END,
    false,
    0,
    jsonb_build_object(
      'migration', '20260803150000',
      'provider', instance."provider"::text,
      'providerInstanceId', instance."providerInstanceId",
      'region', instance."region",
      'size', instance."size",
      'image', instance."image",
      'retroactiveBilling', false
    ),
    NULL::text,
    coalesce(
      instance."providerObservedAt",
      instance."provisionedAt",
      instance."createdAt"
    ) AT TIME ZONE 'UTC',
    CURRENT_TIMESTAMP,
    NULL::timestamptz,
    'legacy-resource-version:' || instance."id"
FROM "CloudInstance" AS instance
JOIN "InfrastructureOrder" AS infrastructure_order
    ON infrastructure_order."id" = instance."infrastructureOrderId"
JOIN "InfrastructurePlan" AS plan
    ON plan."id" = infrastructure_order."planId"
WHERE instance."status" = 'ACTIVE'
  AND plan."productKind" = 'CLOUD_SERVER'
  AND plan."vcpu" IS NOT NULL
  AND plan."ramGb" IS NOT NULL
  AND plan."storageGb" IS NOT NULL;

INSERT INTO "UsageInterval" (
    "id", "cloudInstanceId", "resourceVersionId",
    "billingPolicySnapshotId", "status", "startedAt", "endedAt",
    "providerEventStartId", "providerEventEndId", "completenessReason",
    "idempotencyKey", "createdAt", "updatedAt"
)
SELECT
    'legacy-usage-interval-' || md5(instance."id"),
    instance."id",
    resource_version."id",
    policy_snapshot."id",
    'OPEN'::"UsageIntervalStatus",
    CURRENT_TIMESTAMP,
    NULL,
    NULL,
    NULL,
    NULL,
    'legacy-open-usage:' || instance."id",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "CloudInstance" AS instance
JOIN "ResourceVersion" AS resource_version
    ON resource_version."cloudInstanceId" = instance."id"
   AND resource_version."effectiveTo" IS NULL
JOIN "ServiceBillingPolicySnapshot" AS policy_snapshot
    ON policy_snapshot."cloudInstanceId" = instance."id"
   AND policy_snapshot."effectiveTo" IS NULL
WHERE instance."status" = 'ACTIVE';

INSERT INTO "BillingReconciliation" (
    "id", "provider", "kind", "status", "cloudInstanceId",
    "billingInvoiceId", "internalAmountRial", "providerAmount",
    "providerCurrency", "providerAmountUnit", "normalizedProviderRial",
    "differenceRial", "reason", "evidence", "idempotencyKey"
)
SELECT
    'legacy-provider-usage-capability-' || md5(instance."id"),
    instance."provider",
    'PROVIDER_USAGE'::"BillingReconciliationKind",
    'UNSUPPORTED'::"BillingReconciliationStatus",
    instance."id",
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'provider_usage_invoice_api_not_confirmed',
    jsonb_build_object(
      'migration', '20260803150000',
      'syntheticUsageCreated', false
    ),
    'legacy-provider-usage-capability:' || instance."id"
FROM "CloudInstance" AS instance
JOIN "InfrastructureOrder" AS infrastructure_order
    ON infrastructure_order."id" = instance."infrastructureOrderId"
JOIN "InfrastructurePlan" AS plan
    ON plan."id" = infrastructure_order."planId"
WHERE instance."status" = 'ACTIVE'
  AND plan."productKind" = 'CLOUD_SERVER';

INSERT INTO "BillingReconciliation" (
    "id", "provider", "kind", "status", "cloudInstanceId",
    "reason", "evidence", "idempotencyKey"
)
SELECT
    'legacy-resource-contract-review-' || md5(instance."id"),
    instance."provider",
    'RESOURCE_STATE'::"BillingReconciliationKind",
    'REVIEW'::"BillingReconciliationStatus",
    instance."id",
    'legacy_resource_dimensions_incomplete',
    jsonb_build_object(
      'migration', '20260803150000',
      'syntheticAmountCreated', false
    ),
    'legacy-resource-contract-review:' || instance."id"
FROM "CloudInstance" AS instance
JOIN "InfrastructureOrder" AS infrastructure_order
    ON infrastructure_order."id" = instance."infrastructureOrderId"
JOIN "InfrastructurePlan" AS plan
    ON plan."id" = infrastructure_order."planId"
WHERE instance."status" = 'ACTIVE'
  AND plan."productKind" = 'CLOUD_SERVER'
  AND (
    plan."vcpu" IS NULL OR
    plan."ramGb" IS NULL OR
    plan."storageGb" IS NULL
  );

ALTER TABLE "PaymentAttempt"
  ADD CONSTRAINT "PaymentAttempt_amount_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "PaymentAttempt_attempt_number_check" CHECK ("attemptNumber" > 0),
  ADD CONSTRAINT "PaymentAttempt_currency_check" CHECK ("currency" = 'IRR'),
  ADD CONSTRAINT "PaymentAttempt_verification_attempts_check"
    CHECK ("verificationAttempts" >= 0);

ALTER TABLE "PaymentRecoveryCase"
  ADD CONSTRAINT "PaymentRecoveryCase_amounts_check"
    CHECK (
      "expectedAmount" > 0 AND
      ("observedAmount" IS NULL OR "observedAmount" >= 0)
    ),
  ADD CONSTRAINT "PaymentRecoveryCase_attempt_count_check"
    CHECK ("attemptCount" >= 0);

ALTER TABLE "WalletTopUpRefund"
  ADD CONSTRAINT "WalletTopUpRefund_amount_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "WalletTopUpRefund_currency_check" CHECK ("currency" = 'IRR');

ALTER TABLE "BillingPolicyVersion"
  ADD CONSTRAINT "BillingPolicyVersion_scope_check"
    CHECK (
      ("scope" = 'GLOBAL' AND "planId" IS NULL) OR
      ("scope" = 'PLAN' AND "planId" IS NOT NULL)
    ),
  ADD CONSTRAINT "BillingPolicyVersion_cadence_check"
    CHECK (
      ("availability" = 'HOURLY_ONLY' AND "defaultCadence" = 'HOURLY') OR
      ("availability" = 'DAILY_ONLY' AND "defaultCadence" = 'DAILY') OR
      "availability" = 'HOURLY_AND_DAILY'
    ),
  ADD CONSTRAINT "BillingPolicyVersion_periods_check"
    CHECK (
      "hourlyMinimumCreditHours" > 0 AND
      "dailyMinimumCreditDays" > 0 AND
      "hourlyGracePeriods" >= 0 AND
      "dailyGracePeriods" >= 0 AND
      "lowBalanceThresholdPeriods" > 0 AND
      "minimumChargeSeconds" >= 0
    ),
  ADD CONSTRAINT "BillingPolicyVersion_effective_range_check"
    CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");

ALTER TABLE "ActivationRequest"
  ADD CONSTRAINT "ActivationRequest_money_check"
    CHECK (
      "minimumCreditRequiredRial" >= 0 AND
      "oneTimeChargesRial" >= 0 AND
      ("estimatedHourlyRial" IS NULL OR "estimatedHourlyRial" >= 0) AND
      ("estimatedDailyRial" IS NULL OR "estimatedDailyRial" >= 0)
    );

ALTER TABLE "ServiceBillingPolicySnapshot"
  ADD CONSTRAINT "ServiceBillingPolicySnapshot_money_check"
    CHECK (
      "minimumCreditRial" >= 0 AND
      ("hourlyEstimateRial" IS NULL OR "hourlyEstimateRial" >= 0) AND
      ("dailyEstimateRial" IS NULL OR "dailyEstimateRial" >= 0)
    ),
  ADD CONSTRAINT "ServiceBillingPolicySnapshot_effective_range_check"
    CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");

ALTER TABLE "ResourceChangeRequest"
  ADD CONSTRAINT "ResourceChangeRequest_buffer_check"
    CHECK ("incrementalBufferRial" >= 0);

ALTER TABLE "ResourceVersion"
  ADD CONSTRAINT "ResourceVersion_resources_check"
    CHECK (
      "vcpu" > 0 AND "ramMb" > 0 AND "diskGb" >= 0 AND
      "ipv4Count" >= 0 AND "snapshotCount" >= 0
    ),
  ADD CONSTRAINT "ResourceVersion_effective_range_check"
    CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");

ALTER TABLE "RateCardVersion"
  ADD CONSTRAINT "RateCardVersion_money_check"
    CHECK (
      "providerAmount" >= 0 AND
      "normalizedProviderRial" >= 0 AND
      "customerRateRial" >= 0 AND
      "markupBasisPoints" >= 0 AND
      "markupBasisPoints" <= 100000
    ),
  ADD CONSTRAINT "RateCardVersion_unit_contract_check"
    CHECK (
      length(trim("providerCurrency")) > 0 AND
      length(trim("providerAmountUnit")) > 0 AND
      "minimumChargeSeconds" >= 0
    ),
  ADD CONSTRAINT "RateCardVersion_effective_range_check"
    CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");

ALTER TABLE "UsageInterval"
  ADD CONSTRAINT "UsageInterval_range_check"
    CHECK ("endedAt" IS NULL OR "endedAt" > "startedAt");

ALTER TABLE "BillingRun"
  ADD CONSTRAINT "BillingRun_period_check" CHECK ("periodEnd" > "periodStart"),
  ADD CONSTRAINT "BillingRun_counts_check"
    CHECK ("invoiceCount" >= 0 AND "reviewCount" >= 0);

ALTER TABLE "BillingInvoice"
  ADD CONSTRAINT "BillingInvoice_period_check" CHECK ("periodEnd" > "periodStart"),
  ADD CONSTRAINT "BillingInvoice_amounts_check"
    CHECK (
      "totalAmountRial" >= 0 AND
      "paidAmountRial" >= 0 AND
      "outstandingAmountRial" >= 0 AND
      "paidAmountRial" + "outstandingAmountRial" = "totalAmountRial"
    );

ALTER TABLE "BillingLine"
  ADD CONSTRAINT "BillingLine_period_check" CHECK ("intervalEnd" > "intervalStart"),
  ADD CONSTRAINT "BillingLine_quantity_check"
    CHECK ("quantityNumerator" >= 0 AND "quantityDenominator" > 0),
  ADD CONSTRAINT "BillingLine_amounts_check"
    CHECK (
      "providerCostRial" >= 0 AND
      "markupBasisPoints" >= 0 AND
      "markupBasisPoints" <= 100000 AND
      "markupAmountRial" >= 0 AND
      "amountRial" = "providerCostRial" + "markupAmountRial"
    );

ALTER TABLE "OutstandingBalance"
  ADD CONSTRAINT "OutstandingBalance_amounts_check"
    CHECK (
      "originalAmountRial" > 0 AND
      "paidAmountRial" >= 0 AND
      "remainingAmountRial" >= 0 AND
      "paidAmountRial" + "remainingAmountRial" = "originalAmountRial"
    );

ALTER TABLE "BillingReconciliation"
  ADD CONSTRAINT "BillingReconciliation_provider_money_contract_check"
    CHECK (
      "providerAmount" IS NULL OR (
        "providerAmount" >= 0 AND
        "providerCurrency" IS NOT NULL AND
        length(trim("providerCurrency")) > 0 AND
        "providerAmountUnit" IS NOT NULL AND
        length(trim("providerAmountUnit")) > 0
      )
    );

ALTER TABLE "DunningCase"
  ADD CONSTRAINT "DunningCase_amounts_check"
    CHECK (
      "thresholdRial" >= 0 AND
      "observedBalanceRial" >= 0 AND
      ("runwaySeconds" IS NULL OR "runwaySeconds" >= 0)
    );

CREATE UNIQUE INDEX "PaymentAttempt_one_success_per_topup"
  ON "PaymentAttempt"("walletTopUpId")
  WHERE "status" = 'SUCCEEDED';

CREATE UNIQUE INDEX "BillingPolicyVersion_one_current_per_key"
  ON "BillingPolicyVersion"("policyKey")
  WHERE "effectiveTo" IS NULL;

CREATE UNIQUE INDEX "ServiceBillingPolicySnapshot_one_current_per_instance"
  ON "ServiceBillingPolicySnapshot"("cloudInstanceId")
  WHERE "effectiveTo" IS NULL;

CREATE UNIQUE INDEX "ResourceVersion_one_current_per_instance"
  ON "ResourceVersion"("cloudInstanceId")
  WHERE "effectiveTo" IS NULL;

CREATE UNIQUE INDEX "UsageInterval_one_open_per_instance"
  ON "UsageInterval"("cloudInstanceId")
  WHERE "endedAt" IS NULL;

CREATE UNIQUE INDEX "DunningCase_one_open_type_per_instance"
  ON "DunningCase"("cloudInstanceId", "type")
  WHERE "status" <> 'RESOLVED';

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_authority_key" ON "PaymentAttempt"("authority");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_gatewayReference_key" ON "PaymentAttempt"("gatewayReference");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_idempotencyKey_key" ON "PaymentAttempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentAttempt_walletTopUpId_createdAt_idx" ON "PaymentAttempt"("walletTopUpId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentAttempt_status_nextReconcileAt_idx" ON "PaymentAttempt"("status", "nextReconcileAt");

-- CreateIndex
CREATE INDEX "PaymentAttempt_gateway_status_idx" ON "PaymentAttempt"("gateway", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_walletTopUpId_attemptNumber_key" ON "PaymentAttempt"("walletTopUpId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRecoveryCase_attemptId_key" ON "PaymentRecoveryCase"("attemptId");

-- CreateIndex
CREATE INDEX "PaymentRecoveryCase_status_nextAttemptAt_createdAt_idx" ON "PaymentRecoveryCase"("status", "nextAttemptAt", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentRecoveryCase_walletTopUpId_createdAt_idx" ON "PaymentRecoveryCase"("walletTopUpId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRecoveryAction_idempotencyKey_key" ON "PaymentRecoveryAction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentRecoveryAction_recoveryCaseId_createdAt_idx" ON "PaymentRecoveryAction"("recoveryCaseId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentRecoveryAction_paymentAttemptId_createdAt_idx" ON "PaymentRecoveryAction"("paymentAttemptId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentRecoveryAction_actorUserId_createdAt_idx" ON "PaymentRecoveryAction"("actorUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTopUpRefund_ledgerEntryId_key" ON "WalletTopUpRefund"("ledgerEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTopUpRefund_idempotencyKey_key" ON "WalletTopUpRefund"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WalletTopUpRefund_status_requestedAt_idx" ON "WalletTopUpRefund"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "WalletTopUpRefund_walletTopUpId_requestedAt_idx" ON "WalletTopUpRefund"("walletTopUpId", "requestedAt");

-- CreateIndex
CREATE INDEX "BillingPolicyVersion_scope_effectiveFrom_idx" ON "BillingPolicyVersion"("scope", "effectiveFrom");

-- CreateIndex
CREATE INDEX "BillingPolicyVersion_planId_effectiveFrom_idx" ON "BillingPolicyVersion"("planId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPolicyVersion_policyKey_version_key" ON "BillingPolicyVersion"("policyKey", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ActivationRequest_serviceOrderId_key" ON "ActivationRequest"("serviceOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivationRequest_infrastructureOrderId_key" ON "ActivationRequest"("infrastructureOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivationRequest_idempotencyKey_key" ON "ActivationRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ActivationRequest_status_requestedAt_idx" ON "ActivationRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "ActivationRequest_userId_requestedAt_idx" ON "ActivationRequest"("userId", "requestedAt");

-- CreateIndex
CREATE INDEX "ActivationRequest_planId_requestedAt_idx" ON "ActivationRequest"("planId", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceBillingPolicySnapshot_activationRequestId_key" ON "ServiceBillingPolicySnapshot"("activationRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceBillingPolicySnapshot_idempotencyKey_key" ON "ServiceBillingPolicySnapshot"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ServiceBillingPolicySnapshot_cloudInstanceId_effectiveFrom_idx" ON "ServiceBillingPolicySnapshot"("cloudInstanceId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ServiceBillingPolicySnapshot_billingPolicyVersionId_effecti_idx" ON "ServiceBillingPolicySnapshot"("billingPolicyVersionId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceChangeRequest_idempotencyKey_key" ON "ResourceChangeRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ResourceChangeRequest_cloudInstanceId_status_requestedAt_idx" ON "ResourceChangeRequest"("cloudInstanceId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "ResourceChangeRequest_status_requestedAt_idx" ON "ResourceChangeRequest"("status", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceVersion_sourceChangeRequestId_key" ON "ResourceVersion"("sourceChangeRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceVersion_idempotencyKey_key" ON "ResourceVersion"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ResourceVersion_cloudInstanceId_effectiveFrom_idx" ON "ResourceVersion"("cloudInstanceId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ResourceVersion_provider_providerInstanceId_effectiveFrom_idx" ON "ResourceVersion"("provider", "providerInstanceId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ResourceVersion_state_effectiveFrom_idx" ON "ResourceVersion"("state", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "RateCardVersion_idempotencyKey_key" ON "RateCardVersion"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RateCardVersion_provider_productKind_externalPlanId_effecti_idx" ON "RateCardVersion"("provider", "productKind", "externalPlanId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "RateCardVersion_planId_component_effectiveFrom_idx" ON "RateCardVersion"("planId", "component", "effectiveFrom");

-- CreateIndex
CREATE INDEX "RateCardVersion_rateCadence_effectiveFrom_idx" ON "RateCardVersion"("rateCadence", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "UsageInterval_idempotencyKey_key" ON "UsageInterval"("idempotencyKey");

-- CreateIndex
CREATE INDEX "UsageInterval_cloudInstanceId_startedAt_endedAt_idx" ON "UsageInterval"("cloudInstanceId", "startedAt", "endedAt");

-- CreateIndex
CREATE INDEX "UsageInterval_status_startedAt_idx" ON "UsageInterval"("status", "startedAt");

-- CreateIndex
CREATE INDEX "UsageInterval_billingPolicySnapshotId_startedAt_idx" ON "UsageInterval"("billingPolicySnapshotId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingRun_idempotencyKey_key" ON "BillingRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BillingRun_cadence_periodStart_periodEnd_idx" ON "BillingRun"("cadence", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "BillingRun_status_startedAt_idx" ON "BillingRun"("status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingInvoice_idempotencyKey_key" ON "BillingInvoice"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BillingInvoice_userId_periodEnd_idx" ON "BillingInvoice"("userId", "periodEnd");

-- CreateIndex
CREATE INDEX "BillingInvoice_status_periodEnd_idx" ON "BillingInvoice"("status", "periodEnd");

-- CreateIndex
CREATE INDEX "BillingInvoice_cadence_periodStart_periodEnd_idx" ON "BillingInvoice"("cadence", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "BillingInvoice_cloudInstanceId_periodStart_periodEnd_billin_key" ON "BillingInvoice"("cloudInstanceId", "periodStart", "periodEnd", "billingPolicySnapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingLine_idempotencyKey_key" ON "BillingLine"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BillingLine_billingInvoiceId_component_idx" ON "BillingLine"("billingInvoiceId", "component");

-- CreateIndex
CREATE INDEX "BillingLine_resourceVersionId_intervalStart_idx" ON "BillingLine"("resourceVersionId", "intervalStart");

-- CreateIndex
CREATE INDEX "BillingLine_rateCardVersionId_intervalStart_idx" ON "BillingLine"("rateCardVersionId", "intervalStart");

-- CreateIndex
CREATE UNIQUE INDEX "OutstandingBalance_billingInvoiceId_key" ON "OutstandingBalance"("billingInvoiceId");

-- CreateIndex
CREATE INDEX "OutstandingBalance_userId_status_dueAt_idx" ON "OutstandingBalance"("userId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "OutstandingBalance_status_dueAt_idx" ON "OutstandingBalance"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingReconciliation_idempotencyKey_key" ON "BillingReconciliation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BillingReconciliation_status_detectedAt_idx" ON "BillingReconciliation"("status", "detectedAt");

-- CreateIndex
CREATE INDEX "BillingReconciliation_provider_kind_status_idx" ON "BillingReconciliation"("provider", "kind", "status");

-- CreateIndex
CREATE INDEX "BillingReconciliation_cloudInstanceId_detectedAt_idx" ON "BillingReconciliation"("cloudInstanceId", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DunningCase_idempotencyKey_key" ON "DunningCase"("idempotencyKey");

-- CreateIndex
CREATE INDEX "DunningCase_status_type_createdAt_idx" ON "DunningCase"("status", "type", "createdAt");

-- CreateIndex
CREATE INDEX "DunningCase_cloudInstanceId_status_idx" ON "DunningCase"("cloudInstanceId", "status");

-- CreateIndex
CREATE INDEX "InfrastructurePlan_billingModel_publicationStatus_idx" ON "InfrastructurePlan"("billingModel", "publicationStatus");

-- CreateIndex
CREATE INDEX "InfrastructurePlan_billingPolicyVersionId_idx" ON "InfrastructurePlan"("billingPolicyVersionId");

-- RenameForeignKey
ALTER TABLE "InfrastructureHealthCheck" RENAME CONSTRAINT "InfrastructureHealthCheck_instance_fkey" TO "InfrastructureHealthCheck_cloudInstanceId_fkey";

-- RenameForeignKey
ALTER TABLE "InfrastructureHealthCheck" RENAME CONSTRAINT "InfrastructureHealthCheck_order_fkey" TO "InfrastructureHealthCheck_infrastructureOrderId_fkey";

-- RenameForeignKey
ALTER TABLE "SecureDeliveryEvent" RENAME CONSTRAINT "SecureDeliveryEvent_instance_fkey" TO "SecureDeliveryEvent_cloudInstanceId_fkey";

-- RenameForeignKey
ALTER TABLE "SecureDeliveryEvent" RENAME CONSTRAINT "SecureDeliveryEvent_order_fkey" TO "SecureDeliveryEvent_infrastructureOrderId_fkey";

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_walletTopUpId_fkey" FOREIGN KEY ("walletTopUpId") REFERENCES "WalletTopUp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRecoveryCase" ADD CONSTRAINT "PaymentRecoveryCase_walletTopUpId_fkey" FOREIGN KEY ("walletTopUpId") REFERENCES "WalletTopUp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRecoveryCase" ADD CONSTRAINT "PaymentRecoveryCase_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "PaymentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRecoveryAction" ADD CONSTRAINT "PaymentRecoveryAction_recoveryCaseId_fkey" FOREIGN KEY ("recoveryCaseId") REFERENCES "PaymentRecoveryCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRecoveryAction" ADD CONSTRAINT "PaymentRecoveryAction_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRecoveryAction" ADD CONSTRAINT "PaymentRecoveryAction_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTopUpRefund" ADD CONSTRAINT "WalletTopUpRefund_walletTopUpId_fkey" FOREIGN KEY ("walletTopUpId") REFERENCES "WalletTopUp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTopUpRefund" ADD CONSTRAINT "WalletTopUpRefund_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTopUpRefund" ADD CONSTRAINT "WalletTopUpRefund_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfrastructurePlan" ADD CONSTRAINT "InfrastructurePlan_billingPolicyVersionId_fkey" FOREIGN KEY ("billingPolicyVersionId") REFERENCES "BillingPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingPolicyVersion" ADD CONSTRAINT "BillingPolicyVersion_planId_fkey" FOREIGN KEY ("planId") REFERENCES "InfrastructurePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingPolicyVersion" ADD CONSTRAINT "BillingPolicyVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationRequest" ADD CONSTRAINT "ActivationRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationRequest" ADD CONSTRAINT "ActivationRequest_serviceOrderId_fkey" FOREIGN KEY ("serviceOrderId") REFERENCES "ServiceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationRequest" ADD CONSTRAINT "ActivationRequest_planId_fkey" FOREIGN KEY ("planId") REFERENCES "InfrastructurePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationRequest" ADD CONSTRAINT "ActivationRequest_billingPolicyVersionId_fkey" FOREIGN KEY ("billingPolicyVersionId") REFERENCES "BillingPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationRequest" ADD CONSTRAINT "ActivationRequest_infrastructureOrderId_fkey" FOREIGN KEY ("infrastructureOrderId") REFERENCES "InfrastructureOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationRequest" ADD CONSTRAINT "ActivationRequest_firstApprovedById_fkey" FOREIGN KEY ("firstApprovedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceBillingPolicySnapshot" ADD CONSTRAINT "ServiceBillingPolicySnapshot_cloudInstanceId_fkey" FOREIGN KEY ("cloudInstanceId") REFERENCES "CloudInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceBillingPolicySnapshot" ADD CONSTRAINT "ServiceBillingPolicySnapshot_billingPolicyVersionId_fkey" FOREIGN KEY ("billingPolicyVersionId") REFERENCES "BillingPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceBillingPolicySnapshot" ADD CONSTRAINT "ServiceBillingPolicySnapshot_activationRequestId_fkey" FOREIGN KEY ("activationRequestId") REFERENCES "ActivationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceChangeRequest" ADD CONSTRAINT "ResourceChangeRequest_cloudInstanceId_fkey" FOREIGN KEY ("cloudInstanceId") REFERENCES "CloudInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceChangeRequest" ADD CONSTRAINT "ResourceChangeRequest_planId_fkey" FOREIGN KEY ("planId") REFERENCES "InfrastructurePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceChangeRequest" ADD CONSTRAINT "ResourceChangeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceChangeRequest" ADD CONSTRAINT "ResourceChangeRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceChangeRequest" ADD CONSTRAINT "ResourceChangeRequest_sourceResourceVersionId_fkey" FOREIGN KEY ("sourceResourceVersionId") REFERENCES "ResourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceVersion" ADD CONSTRAINT "ResourceVersion_cloudInstanceId_fkey" FOREIGN KEY ("cloudInstanceId") REFERENCES "CloudInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceVersion" ADD CONSTRAINT "ResourceVersion_sourceChangeRequestId_fkey" FOREIGN KEY ("sourceChangeRequestId") REFERENCES "ResourceChangeRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCardVersion" ADD CONSTRAINT "RateCardVersion_planId_fkey" FOREIGN KEY ("planId") REFERENCES "InfrastructurePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageInterval" ADD CONSTRAINT "UsageInterval_cloudInstanceId_fkey" FOREIGN KEY ("cloudInstanceId") REFERENCES "CloudInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageInterval" ADD CONSTRAINT "UsageInterval_resourceVersionId_fkey" FOREIGN KEY ("resourceVersionId") REFERENCES "ResourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageInterval" ADD CONSTRAINT "UsageInterval_billingPolicySnapshotId_fkey" FOREIGN KEY ("billingPolicySnapshotId") REFERENCES "ServiceBillingPolicySnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_billingRunId_fkey" FOREIGN KEY ("billingRunId") REFERENCES "BillingRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_cloudInstanceId_fkey" FOREIGN KEY ("cloudInstanceId") REFERENCES "CloudInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_billingPolicySnapshotId_fkey" FOREIGN KEY ("billingPolicySnapshotId") REFERENCES "ServiceBillingPolicySnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingLine" ADD CONSTRAINT "BillingLine_billingInvoiceId_fkey" FOREIGN KEY ("billingInvoiceId") REFERENCES "BillingInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingLine" ADD CONSTRAINT "BillingLine_usageIntervalId_fkey" FOREIGN KEY ("usageIntervalId") REFERENCES "UsageInterval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingLine" ADD CONSTRAINT "BillingLine_resourceVersionId_fkey" FOREIGN KEY ("resourceVersionId") REFERENCES "ResourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingLine" ADD CONSTRAINT "BillingLine_rateCardVersionId_fkey" FOREIGN KEY ("rateCardVersionId") REFERENCES "RateCardVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutstandingBalance" ADD CONSTRAINT "OutstandingBalance_billingInvoiceId_fkey" FOREIGN KEY ("billingInvoiceId") REFERENCES "BillingInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutstandingBalance" ADD CONSTRAINT "OutstandingBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingReconciliation" ADD CONSTRAINT "BillingReconciliation_cloudInstanceId_fkey" FOREIGN KEY ("cloudInstanceId") REFERENCES "CloudInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingReconciliation" ADD CONSTRAINT "BillingReconciliation_billingInvoiceId_fkey" FOREIGN KEY ("billingInvoiceId") REFERENCES "BillingInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DunningCase" ADD CONSTRAINT "DunningCase_cloudInstanceId_fkey" FOREIGN KEY ("cloudInstanceId") REFERENCES "CloudInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DunningCase" ADD CONSTRAINT "DunningCase_billingInvoiceId_fkey" FOREIGN KEY ("billingInvoiceId") REFERENCES "BillingInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "AdminCommandReceipt_infrastructureOrderId_operation_createdAt_i" RENAME TO "AdminCommandReceipt_infrastructureOrderId_operation_created_idx";

-- RenameIndex
ALTER INDEX "HealthRetryDispatch_infrastructureOrderId_sourceHealthCheckId_k" RENAME TO "HealthRetryDispatch_infrastructureOrderId_sourceHealthCheck_key";

-- RenameIndex
ALTER INDEX "InfrastructureHealthCheck_instance_checked_idx" RENAME TO "InfrastructureHealthCheck_cloudInstanceId_checkedAt_idx";

-- RenameIndex
ALTER INDEX "InfrastructureHealthCheck_order_attempt_key" RENAME TO "InfrastructureHealthCheck_infrastructureOrderId_attempt_key";

-- RenameIndex
ALTER INDEX "InfrastructureHealthCheck_order_status_checked_idx" RENAME TO "InfrastructureHealthCheck_infrastructureOrderId_status_chec_idx";

-- RenameIndex
ALTER INDEX "InfrastructurePlan_provider_productKind_offerSource_publication" RENAME TO "InfrastructurePlan_provider_productKind_offerSource_publica_idx";

-- RenameIndex
ALTER INDEX "InfrastructurePlan_provider_productKind_publicationStatus_sortO" RENAME TO "InfrastructurePlan_provider_productKind_publicationStatus_s_idx";

-- RenameIndex
ALTER INDEX "PreprovisionedInventoryItem_planId_inventoryStatus_healthStatus" RENAME TO "PreprovisionedInventoryItem_planId_inventoryStatus_healthSt_idx";

-- RenameIndex
ALTER INDEX "PreprovisionedInventoryItem_provider_apiVersion_providerResourc" RENAME TO "PreprovisionedInventoryItem_provider_apiVersion_providerRes_key";

-- RenameIndex
ALTER INDEX "ProductFlowRemediationCase_recommendationSessionId_createdAt_id" RENAME TO "ProductFlowRemediationCase_recommendationSessionId_createdA_idx";

-- RenameIndex
ALTER INDEX "ProductFlowTransition_infrastructure_idx" RENAME TO "ProductFlowTransition_infrastructureOrderId_createdAt_idx";

-- RenameIndex
ALTER INDEX "ProductFlowTransition_order_idx" RENAME TO "ProductFlowTransition_serviceOrderId_createdAt_idx";

-- RenameIndex
ALTER INDEX "ProductFlowTransition_session_idx" RENAME TO "ProductFlowTransition_recommendationSessionId_createdAt_idx";

-- RenameIndex
ALTER INDEX "ProviderCatalogAsset_identity_key" RENAME TO "ProviderCatalogAsset_provider_apiVersion_regionCode_kind_ex_key";

-- RenameIndex
ALTER INDEX "ProviderCatalogAsset_listing_idx" RENAME TO "ProviderCatalogAsset_provider_apiVersion_regionCode_kind_st_idx";

-- RenameIndex
ALTER INDEX "ProviderCatalogItem_provider_apiVersion_regionCode_externalPlan" RENAME TO "ProviderCatalogItem_provider_apiVersion_regionCode_external_key";

-- RenameIndex
ALTER INDEX "ProviderCatalogRegionState_identity_key" RENAME TO "ProviderCatalogRegionState_provider_apiVersion_regionCode_key";

-- RenameIndex
ALTER INDEX "ProviderCatalogRegionState_status_idx" RENAME TO "ProviderCatalogRegionState_provider_apiVersion_status_idx";

-- RenameIndex
ALTER INDEX "ProviderCatalogSyncRun_provider_startedAt_idx" RENAME TO "ProviderCatalogSyncRun_provider_apiVersion_startedAt_idx";

-- RenameIndex
ALTER INDEX "ProviderFundingConfirmation_infrastructureOrderId_confirmedAt_i" RENAME TO "ProviderFundingConfirmation_infrastructureOrderId_confirmed_idx";

-- RenameIndex
ALTER INDEX "ProviderRegionConfig_provider_apiVersion_saleEnabled_sortOrder_" RENAME TO "ProviderRegionConfig_provider_apiVersion_saleEnabled_sortOr_idx";

-- RenameIndex
ALTER INDEX "ProviderRegionConfig_provider_apiVersion_syncEnabled_sortOrder_" RENAME TO "ProviderRegionConfig_provider_apiVersion_syncEnabled_sortOr_idx";

-- RenameIndex
ALTER INDEX "ProvisioningNotificationOutbox_infrastructureOrderId_createdAt_" RENAME TO "ProvisioningNotificationOutbox_infrastructureOrderId_create_idx";

-- RenameIndex
ALTER INDEX "SecureDeliveryEvent_instance_created_idx" RENAME TO "SecureDeliveryEvent_cloudInstanceId_createdAt_idx";

-- RenameIndex
ALTER INDEX "SecureDeliveryEvent_order_status_created_idx" RENAME TO "SecureDeliveryEvent_infrastructureOrderId_status_createdAt_idx";
