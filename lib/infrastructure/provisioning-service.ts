import {
  AdminNotificationStatus,
  AdminNotificationType,
  CloudInstanceStatus,
  InfrastructureOrderStatus,
  InfrastructureProvider,
  ProvisioningJobStatus,
  ServiceOrderStatus,
  type Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  customerSafeProviderMessage,
  InfrastructureError,
  isAmbiguousProviderError,
  isInsufficientBalanceError,
} from "@/lib/infrastructure/errors";
import { createCloudProviderAdapter } from "@/lib/infrastructure/provider-factory";
import {
  runInfrastructureHealthCheck,
  type ConnectivityProbe,
} from "@/lib/infrastructure/health-check-service";
import { assertProviderRoute } from "@/lib/infrastructure/provider-routing";
import type {
  CloudProviderAdapter,
  CreateServerInput,
} from "@/lib/infrastructure/cloud-provider-adapter";
import { submitProvisioningOnce } from "@/lib/infrastructure/provisioning-orchestrator";
import {
  transitionProductFlow,
  transitionProductFlowTx,
} from "@/lib/product-flow/service";
import { getWorkerConfig } from "@/lib/worker/config";

const POLL_ATTEMPTS = 8;
const POLL_DELAY_MS = 2000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildDesiredInstanceName(infrastructureOrderId: string) {
  return `abrchin-${infrastructureOrderId.slice(-12)}-1`;
}

async function logProviderOperation(input: {
  provider: InfrastructureProvider;
  operation: string;
  infrastructureOrderId?: string;
  provisioningJobId?: string;
  status: string;
  requestSummary?: Prisma.InputJsonValue;
  responseSummary?: Prisma.InputJsonValue;
  errorCode?: string;
}) {
  await prisma.providerOperationLog.create({
    data: {
      provider: input.provider,
      operation: input.operation,
      infrastructureOrderId: input.infrastructureOrderId ?? null,
      provisioningJobId: input.provisioningJobId ?? null,
      status: input.status,
      requestSummary: input.requestSummary,
      responseSummary: input.responseSummary,
      errorCode: input.errorCode ?? null,
    },
  });
}

async function createAdminNotification(input: {
  type: AdminNotificationType;
  infrastructureOrderId?: string;
  title: string;
  message: string;
}) {
  await prisma.adminNotification.create({
    data: {
      type: input.type,
      infrastructureOrderId: input.infrastructureOrderId ?? null,
      title: input.title,
      message: input.message,
      status: AdminNotificationStatus.UNREAD,
    },
  });
}

type ClaimedJobRow = { id: string };

export async function recoverExpiredProvisioningJobs() {
  const now = new Date();

  const expired = await prisma.provisioningJob.findMany({
    where: {
      status: ProvisioningJobStatus.RUNNING,
      leaseExpiresAt: { lt: now },
    },
    include: {
      infrastructureOrder: { include: { cloudInstance: true } },
    },
  });

  for (const job of expired) {
    const hasProviderId = Boolean(
      job.providerResourceId ||
        job.infrastructureOrder.cloudInstance?.providerInstanceId,
    );
    const afterCreate = Boolean(job.createSentAt);

    if (!afterCreate && !hasProviderId) {
      await prisma.provisioningJob.update({
        where: { id: job.id },
        data: {
          status: ProvisioningJobStatus.QUEUED,
          workerId: null,
          lockedAt: null,
          leaseExpiresAt: null,
          startedAt: null,
        },
      });
      continue;
    }

    if (afterCreate && !hasProviderId) {
      await prisma.$transaction([
        prisma.provisioningJob.update({
          where: { id: job.id },
          data: {
            status: ProvisioningJobStatus.NEEDS_RECONCILIATION,
            finishedAt: now,
            workerId: null,
            lockedAt: null,
            leaseExpiresAt: null,
            lastErrorCode: "provider_ambiguous",
            lastErrorMessage: customerSafeProviderMessage(),
          },
        }),
        prisma.infrastructureOrder.update({
          where: { id: job.infrastructureOrderId },
          data: { status: InfrastructureOrderStatus.NEEDS_RECONCILIATION },
        }),
      ]);
      continue;
    }

    if (hasProviderId) {
      await prisma.provisioningJob.update({
        where: { id: job.id },
        data: {
          status: ProvisioningJobStatus.QUEUED,
          workerId: null,
          lockedAt: null,
          leaseExpiresAt: null,
          startedAt: null,
        },
      });
    }
  }

  return expired.length;
}

export async function claimNextProvisioningJob(workerId?: string) {
  const config = getWorkerConfig();
  const id = workerId ?? config.workerId;
  const leaseUntil = new Date(Date.now() + config.leaseMs);

  await recoverExpiredProvisioningJobs();

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<ClaimedJobRow[]>`
      SELECT id
      FROM "ProvisioningJob"
      WHERE status = 'QUEUED'
        AND "availableAt" <= CURRENT_TIMESTAMP
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    const row = rows[0];
    if (!row) return null;

    const claimed = await tx.provisioningJob.updateMany({
      where: { id: row.id, status: ProvisioningJobStatus.QUEUED },
      data: {
        status: ProvisioningJobStatus.RUNNING,
        workerId: id,
        lockedAt: new Date(),
        leaseExpiresAt: leaseUntil,
        startedAt: new Date(),
        claimCount: { increment: 1 },
        runCount: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return null;

    const job = await tx.provisioningJob.findUniqueOrThrow({
      where: { id: row.id },
      include: {
        infrastructureOrder: {
          include: {
            serviceOrder: { include: { recommendationQuote: true } },
          },
        },
      },
    });
    await tx.infrastructureOrder.updateMany({
      where: { id: job.infrastructureOrderId, status: InfrastructureOrderStatus.QUEUED },
      data: { status: InfrastructureOrderStatus.PROVISIONING },
    });
    if (
      job.infrastructureOrder.productFlowState ===
      "PROVISIONING_SUBMITTED"
    ) {
      await transitionProductFlowTx(tx, {
        owner: {
          recommendationSessionId:
            job.infrastructureOrder.serviceOrder.recommendationQuote
              ?.sessionId ?? null,
          serviceOrderId: job.infrastructureOrder.serviceOrderId,
          infrastructureOrderId: job.infrastructureOrderId,
        },
        from: "PROVISIONING_SUBMITTED",
        to: "PROVISIONING",
        reason: "provisioning_job_claimed",
        idempotencyKey: `provisioning-start:${job.id}`,
      });
    }

    return tx.provisioningJob.findUniqueOrThrow({
      where: { id: row.id },
      include: {
        infrastructureOrder: {
          include: { plan: true, serviceOrder: true, cloudInstance: true, provisioningJobs: true },
        },
      },
    });
  });
}

type LockedProvisioningSelection = {
  provider: InfrastructureProvider;
  providerApiVersion: string;
  productKind: CreateServerInput["productKind"];
  region: string;
  externalPlanId: string;
  externalImageId: string;
  externalNetworkId: string | null;
  externalSecurityId: string | null;
  topologyVerificationMode:
    | "STRICT_OBSERVED"
    | "PROVIDER_MANAGED";
  accessMethod: CreateServerInput["accessMethod"];
  sshKeyName: string | null;
  initScript: string | null;
};

function record(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function parseLockedProvisioningSelection(input: {
  snapshot: Prisma.JsonValue | null;
  provider: InfrastructureProvider;
  providerApiVersion: string;
  productKind: CreateServerInput["productKind"];
}): LockedProvisioningSelection {
  const snapshot = record(input.snapshot);
  const delivery = record(
    (snapshot.deliveryConfiguration ?? null) as Prisma.JsonValue | null,
  );
  const string = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  const provider = snapshot.provider;
  const providerApiVersion = string(snapshot.providerApiVersion);
  const productKind = snapshot.productKind;
  const region = string(snapshot.region);
  const externalPlanId = string(snapshot.externalPlanId);
  const externalImageId = string(snapshot.externalImageId);
  const externalNetworkId = string(snapshot.externalNetworkId);
  const externalSecurityId = string(snapshot.externalSecurityId);
  const explicitTopologyMode =
    string(snapshot.topologyVerificationMode) ??
    string(delivery.topologyVerificationMode);
  const expectedTopologyMode =
    input.provider === InfrastructureProvider.ARVAN
      ? "STRICT_OBSERVED"
      : "PROVIDER_MANAGED";
  const topologyVerificationMode =
    explicitTopologyMode ??
    (input.provider === InfrastructureProvider.PARSPACK &&
    externalNetworkId === "provider-default" &&
    externalSecurityId === "provider-default"
      ? "PROVIDER_MANAGED"
      : null);
  const accessMethod = string(delivery.accessMethod);
  if (
    provider !== input.provider ||
    providerApiVersion !== input.providerApiVersion ||
    productKind !== input.productKind ||
    !region ||
    !externalPlanId ||
    !externalImageId ||
    topologyVerificationMode !== expectedTopologyMode ||
    (topologyVerificationMode === "STRICT_OBSERVED" &&
      (!externalNetworkId || !externalSecurityId)) ||
    !["SSH_KEY", "ONE_TIME_PASSWORD", "WINDOWS_PASSWORD"].includes(
      accessMethod ?? "",
    ) ||
    delivery.provider !== provider ||
    delivery.providerApiVersion !== providerApiVersion ||
    delivery.productKind !== productKind ||
    delivery.region !== region ||
    delivery.externalPlanId !== externalPlanId ||
    delivery.externalImageId !== externalImageId ||
    (topologyVerificationMode === "STRICT_OBSERVED" &&
      (delivery.externalNetworkId !== externalNetworkId ||
        delivery.externalSecurityId !== externalSecurityId)) ||
    (explicitTopologyMode != null &&
      delivery.topologyVerificationMode !== topologyVerificationMode)
  ) {
    throw new InfrastructureError(
      "provider_lock_incomplete",
      "Paid provider selection snapshot is incomplete",
    );
  }
  const sshKeyName = string(delivery.sshKeyName);
  if (accessMethod === "SSH_KEY" && !sshKeyName) {
    throw new InfrastructureError(
      "provider_lock_incomplete",
      "Paid SSH selection is incomplete",
    );
  }
  return {
    provider: input.provider,
    providerApiVersion,
    productKind: input.productKind,
    region,
    externalPlanId,
    externalImageId,
    externalNetworkId:
      topologyVerificationMode === "PROVIDER_MANAGED"
        ? null
        : externalNetworkId,
    externalSecurityId:
      topologyVerificationMode === "PROVIDER_MANAGED"
        ? null
        : externalSecurityId,
    topologyVerificationMode,
    accessMethod: accessMethod as CreateServerInput["accessMethod"],
    sshKeyName,
    initScript: string(delivery.initScript) ?? null,
  };
}

export async function touchWorkerHeartbeat(input?: {
  cycleOk?: boolean;
  status?: "healthy" | "stale" | "down";
}) {
  const config = getWorkerConfig();
  const now = new Date();
  const status = input?.status ?? (input?.cycleOk ? "healthy" : "stale");

  await prisma.workerHeartbeat.upsert({
    where: { id: "provisioning" },
    create: {
      workerId: config.workerId,
      lastSeenAt: now,
      lastCycleAt: input?.cycleOk ? now : null,
      cyclesTotal: input?.cycleOk ? 1 : 0,
      status,
    },
    update: {
      workerId: config.workerId,
      lastSeenAt: now,
      ...(input?.cycleOk ? { lastCycleAt: now, cyclesTotal: { increment: 1 } } : {}),
      status,
    },
  });
}

export async function getWorkerHealthStatus() {
  const config = getWorkerConfig();
  const row = await prisma.workerHeartbeat.findUnique({ where: { id: "provisioning" } });
  if (!row) {
    return { status: "down" as const, workerId: null, lastSeenAt: null, lastCycleAt: null };
  }
  const ageMs = Date.now() - row.lastSeenAt.getTime();
  let status: "healthy" | "stale" | "down" = row.status as "healthy" | "stale" | "down";
  if (ageMs > config.staleAfterMs * 2) status = "down";
  else if (ageMs > config.staleAfterMs) status = "stale";
  else if (row.status === "down") status = "down";
  else if (row.status === "stale" || !row.lastCycleAt) status = "stale";
  else status = "healthy";
  return {
    status,
    workerId: row.workerId,
    lastSeenAt: row.lastSeenAt.toISOString(),
    lastCycleAt: row.lastCycleAt?.toISOString() ?? null,
    cyclesTotal: row.cyclesTotal,
  };
}

export async function processProvisioningJob(
  jobId: string,
  providerOverride?: CloudProviderAdapter,
  options?: { healthProbe?: ConnectivityProbe },
) {
  const job = await prisma.provisioningJob.findUnique({
    where: { id: jobId },
    include: {
      infrastructureOrder: {
        include: {
          serviceOrder: { include: { recommendationQuote: true } },
          cloudInstance: true,
          provisioningJobs: true,
        },
      },
    },
  });
  if (!job || job.status !== ProvisioningJobStatus.RUNNING) return;
  if (
    job.operation === "health_check_retry" ||
    job.operation === "health_check_manual_recovery"
  ) {
    const { processHealthCheckRetryJob } = await import(
      "@/lib/infrastructure/health-retry-service"
    );
    await processHealthCheckRetryJob(job.id, providerOverride, {
      healthProbe: options?.healthProbe,
    });
    return;
  }

  const order = job.infrastructureOrder;
  if (order.cloudInstance?.status === CloudInstanceStatus.ACTIVE) {
    await prisma.provisioningJob.update({
      where: { id: job.id },
      data: { status: ProvisioningJobStatus.SUCCEEDED, finishedAt: new Date() },
    });
    return;
  }

  assertProviderRoute({
    productKind: order.productKind,
    provider: order.provider,
    apiVersion: order.providerApiVersion,
  });
  if (
    order.serviceOrder.status !== ServiceOrderStatus.PAID ||
    (providerOverride &&
      (providerOverride.provider !== order.provider ||
        providerOverride.apiVersion !== order.providerApiVersion))
  ) {
    throw new InfrastructureError(
      "provider_route_mismatch",
      "Provisioning requires the exact paid provider route",
    );
  }
  const provider =
    providerOverride ??
    createCloudProviderAdapter(
      order.provider,
      order.providerApiVersion,
    );

  if (!order.desiredInstanceName) {
    const desiredName = buildDesiredInstanceName(order.id);
    await prisma.infrastructureOrder.update({
      where: { id: order.id },
      data: { desiredInstanceName: desiredName },
    });
    order.desiredInstanceName = desiredName;
  }

  try {
    const locked = parseLockedProvisioningSelection({
      snapshot: order.providerSelectionSnapshot,
      provider: order.provider,
      providerApiVersion: order.providerApiVersion,
      productKind: order.productKind,
    });
    const createInput: CreateServerInput = {
      productKind: locked.productKind,
      region: locked.region,
      externalPlanId: locked.externalPlanId,
      externalImageId: locked.externalImageId,
      externalNetworkId: locked.externalNetworkId,
      externalSecurityId: locked.externalSecurityId,
      accessMethod: locked.accessMethod,
      sshKeyEnabled: locked.accessMethod === "SSH_KEY",
      sshKeyName: locked.sshKeyName,
      initScript: locked.initScript,
      name: order.desiredInstanceName,
      orderPublicId: order.id,
      idempotencyKey: job.idempotencyKey,
    };
    const aboutToCreate =
      !job.providerResourceId &&
      !order.cloudInstance?.providerInstanceId &&
      !job.providerTaskId &&
      (!job.createSentAt || order.reconcileNoResourceConfirmedAt != null);
    if (aboutToCreate) {
      await prisma.provisioningJob.update({
        where: { id: job.id },
        data: { createSentAt: new Date() },
      });
    }
    const submission = await submitProvisioningOnce({
      adapter: provider,
      attempt: {
        paid: true,
        providerLocked: true,
        createSentAt: job.createSentAt,
        providerTaskId: job.providerTaskId,
        providerResourceId:
          job.providerResourceId ??
          order.cloudInstance?.providerInstanceId ??
          null,
        noResourceConfirmedAt: order.reconcileNoResourceConfirmedAt,
      },
      create: createInput,
    });
    if (submission.state === "RECONCILING") {
      await prisma.$transaction([
        prisma.provisioningJob.update({
          where: { id: job.id },
          data: {
            status: ProvisioningJobStatus.NEEDS_RECONCILIATION,
            lastErrorCode: "provider_ambiguous",
            lastErrorMessage: customerSafeProviderMessage(),
            finishedAt: new Date(),
            workerId: null,
            lockedAt: null,
            leaseExpiresAt: null,
          },
        }),
        prisma.infrastructureOrder.update({
          where: { id: order.id },
          data: { status: InfrastructureOrderStatus.NEEDS_RECONCILIATION },
        }),
      ]);
      await transitionProductFlow({
        owner: {
          recommendationSessionId:
            order.serviceOrder.recommendationQuote?.sessionId ?? null,
          serviceOrderId: order.serviceOrderId,
          infrastructureOrderId: order.id,
        },
        from: "PROVISIONING",
        to: "PROVISIONING_RECONCILING",
        reason: "provider_create_requires_reconciliation",
        idempotencyKey: `provider-reconciling:${job.id}`,
      });
      return;
    }
    const providerResourceId =
      submission.resourceId ?? submission.task?.resourceId ?? null;
    if (submission.task) {
      await prisma.provisioningJob.update({
        where: { id: job.id },
        data: {
          providerTaskId: submission.task.taskId,
          providerActionId: submission.task.actionId,
          providerRequestId: submission.task.requestId,
          providerResourceId,
          lastPolledAt: new Date(),
        },
      });
    }
    if (!providerResourceId) {
      throw new InfrastructureError(
        "provider_ambiguous",
        "Provider did not return a resource id",
      );
    }
    let taskStatus = await provider.getTaskStatus({
      region: locked.region,
      taskId: submission.task?.taskId ?? job.providerTaskId,
      resourceId: providerResourceId,
    });
    for (let poll = 0; poll < POLL_ATTEMPTS; poll += 1) {
      if (taskStatus.state === "SUCCEEDED" || taskStatus.state === "FAILED") {
        break;
      }
      await sleep(POLL_DELAY_MS);
      taskStatus = await provider.getTaskStatus({
        region: locked.region,
        taskId: taskStatus.taskId,
        resourceId: providerResourceId,
      });
    }
    if (taskStatus.state !== "SUCCEEDED") {
      throw new InfrastructureError(
        taskStatus.state === "FAILED"
          ? "provider_unavailable"
          : "provider_ambiguous",
        "Provider task did not reach success",
      );
    }
    const observed = await provider.findExistingResource({
      region: locked.region,
      orderPublicId: order.id,
      expectedName: order.desiredInstanceName,
      providerResourceId,
    });
    if (!observed) {
      throw new InfrastructureError(
        "provider_ambiguous",
        "Provider resource could not be observed",
      );
    }
    const observedNetworkId =
      locked.topologyVerificationMode === "STRICT_OBSERVED" &&
      locked.externalNetworkId &&
      observed.networkIds?.includes(locked.externalNetworkId)
        ? locked.externalNetworkId
        : locked.topologyVerificationMode === "STRICT_OBSERVED"
          ? observed.networkIds?.[0] ?? null
          : null;
    const observedSecurityId =
      locked.topologyVerificationMode === "STRICT_OBSERVED" &&
      locked.externalSecurityId &&
      observed.securityIds?.includes(locked.externalSecurityId)
        ? locked.externalSecurityId
        : locked.topologyVerificationMode === "STRICT_OBSERVED"
          ? observed.securityIds?.[0] ?? null
          : null;
    await prisma.$transaction([
      prisma.cloudInstance.upsert({
        where: { infrastructureOrderId: order.id },
        create: {
          infrastructureOrderId: order.id,
          userId: order.userId,
          provider: order.provider,
          providerApiVersion: order.providerApiVersion,
          providerInstanceId: observed.id,
          name: observed.name,
          region: observed.region,
          size: locked.externalPlanId,
          image: locked.externalImageId,
          deliveryMode: order.deliveryMode,
          ipv4: observed.ipv4,
          providerState: observed.state,
          networkId: observedNetworkId,
          securityId: observedSecurityId,
          providerObservedAt: observed.observedAt,
          status: CloudInstanceStatus.PENDING,
        },
        update: {
          ipv4: observed.ipv4,
          providerState: observed.state,
          networkId: observedNetworkId,
          securityId: observedSecurityId,
          providerObservedAt: observed.observedAt,
          status: CloudInstanceStatus.PENDING,
        },
      }),
      prisma.provisioningJob.update({
        where: { id: job.id },
        data: {
          status: ProvisioningJobStatus.SUCCEEDED,
          finishedAt: new Date(),
          workerId: null,
          lockedAt: null,
          leaseExpiresAt: null,
          providerResourceId: observed.id,
          lastPolledAt: taskStatus.checkedAt,
        },
      }),
    ]);
    const health = await runInfrastructureHealthCheck({
      infrastructureOrderId: order.id,
      probe: options?.healthProbe,
    });
    if (!health.healthy) {
      const { scheduleAutomaticHealthRetry } = await import(
        "@/lib/infrastructure/health-retry-service"
      );
      await scheduleAutomaticHealthRetry({
        infrastructureOrderId: order.id,
        sourceCheckId: job.id,
      });
    }
    if (health.delivered) {
      await createAdminNotification({
        type: AdminNotificationType.INSTANCE_ACTIVE,
        infrastructureOrderId: order.id,
        title: "سرور فعال شد",
        message: `سرور سفارش ${order.serviceOrder.title} آماده است.`,
      });
    }
  } catch (error) {
    const errorCode =
      error instanceof InfrastructureError
        ? error.code
        : "provider_unavailable";
    const errorMessage = customerSafeProviderMessage();

    if (isInsufficientBalanceError(error)) {
      await prisma.$transaction([
        prisma.provisioningJob.update({
          where: { id: job.id },
          data: {
            status: ProvisioningJobStatus.BLOCKED_PROVIDER_BALANCE,
            lastErrorCode: errorCode,
            lastErrorMessage: errorMessage,
            finishedAt: new Date(),
            workerId: null,
            lockedAt: null,
            leaseExpiresAt: null,
          },
        }),
        prisma.infrastructureOrder.update({
          where: { id: order.id },
          data: { status: InfrastructureOrderStatus.WAITING_ADMIN_FUNDING },
        }),
      ]);
      await createAdminNotification({
        type: AdminNotificationType.PROVIDER_BALANCE_BLOCKED,
        infrastructureOrderId: order.id,
        title: "کمبود اعتبار پارس‌پک",
        message: "شارژ پارس‌پک کافی نبود. پس از شارژ مجدد، تأیید Attempt جدید ثبت کنید.",
      });
      await transitionProductFlow({
        owner: {
          recommendationSessionId:
            order.serviceOrder.recommendationQuote?.sessionId ?? null,
          serviceOrderId: order.serviceOrderId,
          infrastructureOrderId: order.id,
        },
        from: "PROVISIONING",
        to: "PROVISIONING_MANUAL_REVIEW",
        reason: "provider_funding_blocked",
        idempotencyKey: `provider-funding-blocked:${job.id}`,
      });
      return;
    }

    if (
      isAmbiguousProviderError(error) ||
      errorCode === "provider_lock_incomplete" ||
      job.createSentAt
    ) {
      const manualSnapshotReview =
        errorCode === "provider_lock_incomplete";
      await prisma.$transaction([
        prisma.provisioningJob.update({
          where: { id: job.id },
          data: {
            status: manualSnapshotReview
              ? ProvisioningJobStatus.FAILED
              : ProvisioningJobStatus.NEEDS_RECONCILIATION,
            lastErrorCode: errorCode,
            lastErrorMessage: errorMessage,
            finishedAt: new Date(),
            workerId: null,
            lockedAt: null,
            leaseExpiresAt: null,
          },
        }),
        prisma.infrastructureOrder.update({
          where: { id: order.id },
          data: {
            status: manualSnapshotReview
              ? InfrastructureOrderStatus.FAILED
              : InfrastructureOrderStatus.NEEDS_RECONCILIATION,
          },
        }),
      ]);
      await createAdminNotification({
        type: AdminNotificationType.NEEDS_RECONCILIATION,
        infrastructureOrderId: order.id,
        title:
          errorCode === "provider_lock_incomplete"
            ? "Snapshot پرداخت ناقص است"
            : "نیاز به تطبیق",
        message:
          errorCode === "provider_lock_incomplete"
            ? "هیچ Createای اجرا نشد؛ Snapshot قفل‌شده نیاز به بررسی دستی دارد."
            : "وضعیت ساخت سرور مبهم است و نیاز به بررسی دستی دارد.",
      });
      await transitionProductFlow({
        owner: {
          recommendationSessionId:
            order.serviceOrder.recommendationQuote?.sessionId ?? null,
          serviceOrderId: order.serviceOrderId,
          infrastructureOrderId: order.id,
        },
        from: "PROVISIONING",
        to: manualSnapshotReview
          ? "PROVISIONING_MANUAL_REVIEW"
          : "PROVISIONING_RECONCILING",
        reason:
          errorCode === "provider_lock_incomplete"
            ? "paid_provider_snapshot_incomplete"
            : "provider_result_ambiguous",
        idempotencyKey: `provider-reconciling:${job.id}`,
      });
      return;
    }

    await prisma.$transaction([
      prisma.provisioningJob.update({
        where: { id: job.id },
        data: {
          status: ProvisioningJobStatus.FAILED,
          lastErrorCode: errorCode,
          lastErrorMessage: errorMessage,
          finishedAt: new Date(),
          workerId: null,
          lockedAt: null,
          leaseExpiresAt: null,
        },
      }),
      prisma.infrastructureOrder.update({
        where: { id: order.id },
        data: { status: InfrastructureOrderStatus.FAILED },
      }),
    ]);
    await createAdminNotification({
      type: AdminNotificationType.PROVISIONING_FAILED,
      infrastructureOrderId: order.id,
      title: "خطای آماده‌سازی",
      message: "آماده‌سازی سرور با خطا مواجه شد.",
    });
    await transitionProductFlow({
      owner: {
        recommendationSessionId:
          order.serviceOrder.recommendationQuote?.sessionId ?? null,
        serviceOrderId: order.serviceOrderId,
        infrastructureOrderId: order.id,
      },
      from: "PROVISIONING",
      to: "PROVISIONING_RETRYABLE",
      reason: "provider_create_failed",
      idempotencyKey: `provider-retryable:${job.id}`,
    });

    await logProviderOperation({
      provider: order.provider,
      operation: job.operation,
      infrastructureOrderId: order.id,
      provisioningJobId: job.id,
      status: "failed",
      errorCode,
    });
  }
}

export async function runProvisioningWorkerCycle(
  providerOverride?: CloudProviderAdapter,
  workerId?: string,
) {
  const job = await claimNextProvisioningJob(workerId);
  if (!job) return false;
  await processProvisioningJob(job.id, providerOverride);
  return true;
}
