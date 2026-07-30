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

type AbsenceAudit = {
  action: string;
  entityType: string;
  entityId: string | null;
  afterData: unknown;
} | null;

export type InfrastructureRecoveryAction =
  | "reconcile"
  | "retry"
  | "health-retry"
  | "health-observe"
  | "health-recovery"
  | "refund"
  | "confirm-no-resource";

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

export function absenceAuditMatchesAttempt(input: {
  audit: AbsenceAudit;
  infrastructureOrderId: string;
  provisioningJobId: string | null;
  attempt: number | null;
}) {
  const data =
    input.audit?.afterData &&
    typeof input.audit.afterData === "object" &&
    !Array.isArray(input.audit.afterData)
      ? (input.audit.afterData as Record<string, unknown>)
      : {};
  return Boolean(
    input.audit &&
      input.audit.action === "reconciliation" &&
      input.audit.entityType === "infrastructure_order" &&
      input.audit.entityId === input.infrastructureOrderId &&
      data.noResourceConfirmed === true &&
      data.provisioningJobId === input.provisioningJobId &&
      data.attempt === input.attempt,
  );
}

export function assessInfrastructureRecoveryActions(input: {
  id: string;
  status: string;
  productFlowState: string | null;
  provisioningJobs: ProviderAttempt[];
  cloudInstance: {
    status: CloudInstanceStatus;
    terminatedAt: Date | null;
  } | null;
  reconcileNoResourceConfirmedAt: Date | null;
  reconcileNoResourceConfirmedJobId: string | null;
  reconcileNoResourceConfirmedAttempt: number | null;
  absenceAudit: AbsenceAudit;
}) {
  const absenceAuditMatches = absenceAuditMatchesAttempt({
    audit: input.absenceAudit,
    infrastructureOrderId: input.id,
    provisioningJobId:
      input.reconcileNoResourceConfirmedJobId,
    attempt: input.reconcileNoResourceConfirmedAttempt,
  });
  const disposition = assessRefundResourceSafety({
    jobs: input.provisioningJobs,
    cloudInstance: input.cloudInstance,
    reconcileNoResourceConfirmedAt:
      input.reconcileNoResourceConfirmedAt,
    reconcileNoResourceConfirmedJobId:
      input.reconcileNoResourceConfirmedJobId,
    reconcileNoResourceConfirmedAttempt:
      input.reconcileNoResourceConfirmedAttempt,
    absenceAuditMatches,
  });
  const actions: InfrastructureRecoveryAction[] = [];
  const hasCloudInstance = Boolean(input.cloudInstance);
  const latest = latestCreateAttempt(input.provisioningJobs);
  const latestSnapshotInvalid =
    latest?.lastErrorCode === "provider_lock_incomplete";

  if (
    input.status === "NEEDS_RECONCILIATION" &&
    !hasCloudInstance
  ) {
    actions.push("reconcile", "confirm-no-resource");
  } else if (
    (input.status === "FAILED" ||
      input.status === "MANUAL_REVIEW") &&
    !hasCloudInstance &&
    input.productFlowState === "PROVISIONING_MANUAL_REVIEW"
  ) {
    if (!disposition.safe) {
      actions.push("reconcile", "confirm-no-resource");
    } else if (latestSnapshotInvalid) {
      actions.push("refund");
    } else {
      actions.push("retry", "refund");
    }
  } else if (
    input.status === "FAILED" &&
    !hasCloudInstance &&
    input.productFlowState === "PROVISIONING_RETRYABLE" &&
    disposition.safe
  ) {
    actions.push("retry", "refund");
  }

  if (
    input.productFlowState === "HEALTH_CHECK_FAILED" &&
    hasCloudInstance
  ) {
    actions.push("health-retry");
  }
  if (
    input.status === "MANUAL_REVIEW" &&
    input.productFlowState === "PROVISIONING_MANUAL_REVIEW" &&
    hasCloudInstance
  ) {
    actions.push("health-observe", "health-recovery");
    if (disposition.safe) actions.push("refund");
  }

  return {
    resourceDispositionSafe: disposition.safe,
    resourceDispositionReason: disposition.reason,
    absenceAuditMatches,
    allowedActions: actions,
  };
}
