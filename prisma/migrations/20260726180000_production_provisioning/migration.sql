-- AlterTable InfrastructureOrder
ALTER TABLE "InfrastructureOrder" ADD COLUMN "desiredInstanceName" TEXT;
ALTER TABLE "InfrastructureOrder" ADD COLUMN "reconcileNoResourceConfirmedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "InfrastructureOrder_desiredInstanceName_key" ON "InfrastructureOrder"("desiredInstanceName");

-- AlterTable ProvisioningJob
ALTER TABLE "ProvisioningJob" ADD COLUMN "runCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProvisioningJob" ADD COLUMN "claimCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProvisioningJob" ADD COLUMN "workerId" TEXT;
ALTER TABLE "ProvisioningJob" ADD COLUMN "lockedAt" TIMESTAMP(3);
ALTER TABLE "ProvisioningJob" ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);
ALTER TABLE "ProvisioningJob" ADD COLUMN "createSentAt" TIMESTAMP(3);

UPDATE "ProvisioningJob" SET "attempt" = 1 WHERE "attempt" = 0;

-- WorkerHeartbeat
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL DEFAULT 'provisioning',
    "workerId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "lastCycleAt" TIMESTAMP(3),
    "cyclesTotal" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'down',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- One successful reverse entry per original ledger entry
CREATE UNIQUE INDEX "WalletLedgerEntry_one_reverse_per_original"
ON "WalletLedgerEntry" ("reversedEntryId")
WHERE "status" = 'COMPLETED' AND "reversedEntryId" IS NOT NULL;
