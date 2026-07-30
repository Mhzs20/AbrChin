import {
  CloudInstanceStatus,
  ProvisioningJobStatus,
} from "@prisma/client";

type ProviderAttempt = {
  id: string;
  operation: string;
  attempt: number;
  status: ProvisioningJobStatus;
  createSentAt: Date | null;
  providerTaskId: string | null;
  providerResourceId: string | null;
  lastErrorCode: string | null;
  createdAt: Date;
};

export function providerAttemptMayHaveResource(job: ProviderAttempt) {
  return Boolean(
    job.createSentAt ||
      job.providerTaskId ||
      job.providerResourceId ||
      job.status === ProvisioningJobStatus.NEEDS_RECONCILIATION ||
      job.lastErrorCode === "provider_ambiguous" ||
      job.lastErrorCode === "provider_timeout",
  );
}

export function latestCreateAttempt(jobs: ProviderAttempt[]) {
  return jobs
    .filter((job) => job.operation === "create_instance")
    .sort(
      (left, right) =>
        right.attempt - left.attempt ||
        right.createdAt.getTime() - left.createdAt.getTime() ||
        right.id.localeCompare(left.id),
    )[0] ?? null;
}

export function assessRefundResourceSafety(input: {
  jobs: ProviderAttempt[];
  cloudInstance: {
    status: CloudInstanceStatus;
    terminatedAt: Date | null;
  } | null;
  reconcileNoResourceConfirmedAt: Date | null;
  reconcileNoResourceConfirmedJobId: string | null;
  reconcileNoResourceConfirmedAttempt: number | null;
  absenceAuditMatches: boolean;
}) {
  if (input.cloudInstance) {
    return input.cloudInstance.status ===
      CloudInstanceStatus.TERMINATED &&
      input.cloudInstance.terminatedAt != null
      ? {
          safe: true as const,
          reason: "RESOURCE_TERMINATED" as const,
        }
      : {
          safe: false as const,
          reason: "RESOURCE_NOT_TERMINATED" as const,
        };
  }

  const riskyJobs = input.jobs.filter(providerAttemptMayHaveResource);
  if (riskyJobs.length === 0) {
    return {
      safe: true as const,
      reason: "CREATE_NEVER_SENT" as const,
    };
  }

  const latest = latestCreateAttempt(input.jobs);
  if (
    !latest ||
    input.reconcileNoResourceConfirmedAt == null ||
    input.reconcileNoResourceConfirmedJobId !== latest.id ||
    input.reconcileNoResourceConfirmedAttempt !== latest.attempt ||
    !input.absenceAuditMatches
  ) {
    return {
      safe: false as const,
      reason: "RECONCILIATION_REQUIRED" as const,
    };
  }

  const newerRisk = riskyJobs.some(
    (job) =>
      job.id !== latest.id &&
      (job.attempt > latest.attempt ||
        job.createdAt > input.reconcileNoResourceConfirmedAt!),
  );
  if (newerRisk) {
    return {
      safe: false as const,
      reason: "RECONCILIATION_STALE" as const,
    };
  }

  return {
    safe: true as const,
    reason: "LATEST_ATTEMPT_CONFIRMED_ABSENT" as const,
  };
}
