import { ProvisioningJobStatus, type Prisma } from "@prisma/client";

export type ProvisioningJobFence = {
  jobId: string;
  claimToken: string;
};

export class WorkerLeaseLostError extends Error {
  readonly code = "worker_lease_lost";

  constructor() {
    super("worker_lease_lost");
    this.name = "WorkerLeaseLostError";
  }
}

export async function assertProvisioningJobFenceTx(
  tx: Prisma.TransactionClient,
  fence: ProvisioningJobFence,
) {
  const owned = await tx.provisioningJob.findFirst({
    where: {
      id: fence.jobId,
      status: ProvisioningJobStatus.RUNNING,
      claimToken: fence.claimToken,
      leaseExpiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (!owned) throw new WorkerLeaseLostError();
}

export async function proveProvisioningJobFenceTx(
  tx: Prisma.TransactionClient,
  fence: ProvisioningJobFence,
) {
  const proved = await tx.provisioningJob.updateMany({
    where: {
      id: fence.jobId,
      status: ProvisioningJobStatus.RUNNING,
      claimToken: fence.claimToken,
      leaseExpiresAt: { gt: new Date() },
    },
    data: { updatedAt: new Date() },
  });
  if (proved.count !== 1) throw new WorkerLeaseLostError();
}

export function isWorkerLeaseLostError(
  error: unknown,
): error is WorkerLeaseLostError {
  return error instanceof WorkerLeaseLostError;
}
