import { randomUUID } from "node:crypto";

import {
  AdminNotificationStatus,
  AdminNotificationType,
  CloudInstanceStatus,
  InfrastructureOrderStatus,
  InfrastructureProvider,
  ProvisioningJobStatus,
  type Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { startInitialUsageBillingTx } from "@/lib/billing/start";
import { evaluateProvisioningBillingContractGate } from "@/lib/billing/provisioning-contract-gate";
import {
  customerSafeProviderMessage,
  InfrastructureError,
  isAmbiguousProviderError,
  isInsufficientBalanceError,
} from "@/lib/infrastructure/errors";
import { createCloudProviderAdapter } from "@/lib/infrastructure/provider-factory";
import {
  parseDurableHealthResult,
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
  transitionProductFlowTx,
} from "@/lib/product-flow/service";
import { isServiceReadyForProvision } from "@/lib/orders/service-lifecycle";
import { getWorkerConfig } from "@/lib/worker/config";
import {
  assertProvisioningJobFenceTx,
  isWorkerLeaseLostError,
  type ProvisioningJobFence,
  WorkerLeaseLostError,
  proveProvisioningJobFenceTx,
} from "@/lib/infrastructure/worker-fence";

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

async function queueProvisioningNotification(input: {
  idempotencyKey: string;
  type: AdminNotificationType;
  infrastructureOrderId: string;
  title: string;
  message: string;
}) {
  await prisma.provisioningNotificationOutbox.createMany({
    data: {
      idempotencyKey: input.idempotencyKey,
      type: input.type,
      infrastructureOrderId: input.infrastructureOrderId,
      title: input.title,
      message: input.message,
    },
    skipDuplicates: true,
  });
  return prisma.provisioningNotificationOutbox.findUniqueOrThrow({
    where: { idempotencyKey: input.idempotencyKey },
  });
}

async function deliverProvisioningNotification(
  outboxId: string,
  beforeDelivery?: () => void | Promise<void>,
) {
  const outbox =
    await prisma.provisioningNotificationOutbox.findUnique({
      where: { id: outboxId },
    });
  if (!outbox || outbox.status === "SENT") return;
  try {
    await beforeDelivery?.();
    await prisma.$transaction([
      prisma.adminNotification.upsert({
        where: { id: `outbox:${outbox.id}` },
        update: {},
        create: {
          id: `outbox:${outbox.id}`,
          type: outbox.type,
          infrastructureOrderId: outbox.infrastructureOrderId,
          title: outbox.title,
          message: outbox.message,
          status: AdminNotificationStatus.UNREAD,
        },
      }),
      prisma.provisioningNotificationOutbox.update({
        where: { id: outbox.id },
        data: {
          status: "SENT",
          attemptCount: { increment: 1 },
          lastError: null,
          processedAt: new Date(),
        },
      }),
    ]);
  } catch {
    await prisma.provisioningNotificationOutbox.updateMany({
      where: { id: outbox.id, status: "PENDING" },
      data: {
        attemptCount: { increment: 1 },
        lastError: "notification_delivery_failed",
      },
    });
    throw new Error("notification_delivery_failed");
  }
}

export async function processPendingProvisioningNotifications(
  limit = 10,
) {
  const pending =
    await prisma.provisioningNotificationOutbox.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: { id: true },
    });
  for (const item of pending) {
    try {
      await deliverProvisioningNotification(item.id);
    } catch {
      // The durable outbox remains PENDING for the next bounded worker cycle.
    }
  }
  return pending.length;
}

export async function reconcileProvisioningDispatches(limit = 50) {
  const batchSize = Math.max(0, Math.min(limit, 200));
  if (batchSize === 0) {
    return {
      activeNotifications: 0,
      failureNotifications: 0,
      healthRetryDispatches: 0,
    };
  }
  const [activeCandidates, failureCandidates] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT infrastructure_order.id
      FROM "InfrastructureOrder" infrastructure_order
      JOIN "CloudInstance" cloud_instance
        ON cloud_instance."infrastructureOrderId" =
          infrastructure_order.id
      WHERE infrastructure_order.status =
        'ACTIVE'::"InfrastructureOrderStatus"
        AND cloud_instance.status = 'ACTIVE'::"CloudInstanceStatus"
        AND NOT EXISTS (
          SELECT 1
          FROM "ProvisioningNotificationOutbox" outbox
          WHERE outbox."idempotencyKey" =
            'instance-active:' || infrastructure_order.id
        )
      ORDER BY infrastructure_order."updatedAt" ASC,
        infrastructure_order.id ASC
      LIMIT ${batchSize}
    `,
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT job.id
      FROM "ProvisioningJob" job
      WHERE job.phase = 'PROVIDER_FAILED'
        AND job.status IN (
          'FAILED'::"ProvisioningJobStatus",
          'NEEDS_RECONCILIATION'::"ProvisioningJobStatus",
          'BLOCKED_PROVIDER_BALANCE'::"ProvisioningJobStatus"
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "ProvisioningNotificationOutbox" outbox
          WHERE outbox."idempotencyKey" =
            'provider-failure:' || job.id
        )
      ORDER BY job."updatedAt" ASC, job.id ASC
      LIMIT ${batchSize}
    `,
  ]);
  const [activeOrders, failedJobs] = await Promise.all([
    activeCandidates.length
      ? prisma.infrastructureOrder.findMany({
          where: {
            id: { in: activeCandidates.map((item) => item.id) },
            status: InfrastructureOrderStatus.ACTIVE,
            cloudInstance: { status: CloudInstanceStatus.ACTIVE },
          },
          include: { serviceOrder: true },
        })
      : [],
    failureCandidates.length
      ? prisma.provisioningJob.findMany({
          where: {
            id: { in: failureCandidates.map((item) => item.id) },
            phase: "PROVIDER_FAILED",
            status: {
              in: [
                ProvisioningJobStatus.FAILED,
                ProvisioningJobStatus.NEEDS_RECONCILIATION,
                ProvisioningJobStatus.BLOCKED_PROVIDER_BALANCE,
              ],
            },
          },
        })
      : [],
  ]);

  for (const order of activeOrders) {
    await queueProvisioningNotification({
      idempotencyKey: `instance-active:${order.id}`,
      type: AdminNotificationType.INSTANCE_ACTIVE,
      infrastructureOrderId: order.id,
      title: "سرور فعال شد",
      message: `سرور سفارش ${order.serviceOrder.title} آماده است.`,
    });
  }
  for (const job of failedJobs) {
    const insufficientBalance =
      job.status === ProvisioningJobStatus.BLOCKED_PROVIDER_BALANCE;
    const needsReconciliation =
      job.status === ProvisioningJobStatus.NEEDS_RECONCILIATION;
    await queueProvisioningNotification({
      idempotencyKey: `provider-failure:${job.id}`,
      type: insufficientBalance
        ? AdminNotificationType.PROVIDER_BALANCE_BLOCKED
        : needsReconciliation
          ? AdminNotificationType.NEEDS_RECONCILIATION
          : AdminNotificationType.PROVISIONING_FAILED,
      infrastructureOrderId: job.infrastructureOrderId,
      title: insufficientBalance
        ? "کمبود اعتبار Provider"
        : needsReconciliation
          ? "نیاز به تطبیق"
          : "خطای آماده‌سازی",
      message: insufficientBalance
        ? "اعتبار Provider کافی نیست و نیاز به بررسی دستی دارد."
        : needsReconciliation
          ? "وضعیت ساخت سرور مبهم است و نیاز به تطبیق دارد."
          : "آماده‌سازی سرور با خطا مواجه شد.",
    });
  }
  const { processPendingHealthRetryDispatches } = await import(
    "@/lib/infrastructure/health-retry-service"
  );
  const healthRetryDispatches =
    await processPendingHealthRetryDispatches(limit);
  return {
    activeNotifications: activeOrders.length,
    failureNotifications: failedJobs.length,
    healthRetryDispatches,
  };
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
      await prisma.provisioningJob.updateMany({
        where: {
          id: job.id,
          status: ProvisioningJobStatus.RUNNING,
          claimToken: job.claimToken,
          leaseExpiresAt: { lt: now },
        },
        data: {
          status: ProvisioningJobStatus.QUEUED,
          workerId: null,
          claimToken: null,
          lockedAt: null,
          leaseExpiresAt: null,
          startedAt: null,
        },
      });
      continue;
    }

    if (afterCreate && !hasProviderId) {
      await prisma.provisioningJob.updateMany({
        where: {
          id: job.id,
          status: ProvisioningJobStatus.RUNNING,
          claimToken: job.claimToken,
          leaseExpiresAt: { lt: now },
        },
        data: {
          status: ProvisioningJobStatus.QUEUED,
          phase: "RECONCILE_REQUIRED",
          workerId: null,
          claimToken: null,
          lockedAt: null,
          leaseExpiresAt: null,
          startedAt: null,
          lastErrorCode: "provider_ambiguous",
          lastErrorMessage: customerSafeProviderMessage(),
        },
      });
      continue;
    }

    if (hasProviderId) {
      await prisma.provisioningJob.updateMany({
        where: {
          id: job.id,
          status: ProvisioningJobStatus.RUNNING,
          claimToken: job.claimToken,
          leaseExpiresAt: { lt: now },
        },
        data: {
          status: ProvisioningJobStatus.QUEUED,
          workerId: null,
          claimToken: null,
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
  const claimToken = randomUUID();

  await recoverExpiredProvisioningJobs();

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<ClaimedJobRow[]>`
      SELECT job.id
      FROM "ProvisioningJob" job
      JOIN "InfrastructureOrder" infrastructure_order
        ON infrastructure_order.id = job."infrastructureOrderId"
      WHERE job.status = 'QUEUED'
        AND job."availableAt" <= CURRENT_TIMESTAMP
        AND (
          infrastructure_order."productFlowState" IN (
            'PROVISIONING_SUBMITTED',
            'PROVISIONING'
          )
          OR (
            (
              job.operation IN (
                'health_check_retry',
                'health_check_manual_recovery'
              )
              OR job.phase = 'HEALTH_RESULT_PERSISTED'
            )
            AND infrastructure_order."productFlowState" IN (
              'HEALTH_CHECK_FAILED',
              'PROVISIONING_MANUAL_REVIEW',
              'WAITING_ADMIN_DELIVERY_APPROVAL'
            )
          )
        )
        AND EXISTS (
          SELECT 1
          FROM "AdminCommandReceipt" approval
          WHERE approval."infrastructureOrderId" = infrastructure_order.id
            AND approval.operation = 'APPROVE_PROVISION'
        )
      ORDER BY job."createdAt" ASC
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
        claimToken,
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
  const topologyVerificationMode =
    explicitTopologyMode === "PROVIDER_MANAGED" ||
    explicitTopologyMode === "STRICT_OBSERVED"
      ? explicitTopologyMode
      : null;
  const accessMethod = string(delivery.accessMethod);
  const strictObserved = topologyVerificationMode === "STRICT_OBSERVED";
  if (
    provider !== input.provider ||
    providerApiVersion !== input.providerApiVersion ||
    productKind !== input.productKind ||
    !region ||
    !externalPlanId ||
    !externalImageId ||
    !topologyVerificationMode ||
    (strictObserved && (!externalNetworkId || !externalSecurityId)) ||
    !["SSH_KEY", "ONE_TIME_PASSWORD", "WINDOWS_PASSWORD"].includes(
      accessMethod ?? "",
    ) ||
    delivery.provider !== provider ||
    delivery.providerApiVersion !== providerApiVersion ||
    delivery.productKind !== productKind ||
    delivery.region !== region ||
    delivery.externalPlanId !== externalPlanId ||
    delivery.externalImageId !== externalImageId ||
    (strictObserved &&
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
    externalNetworkId,
    externalSecurityId,
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

type ProvisioningProcessOptions = {
  healthProbe?: ConnectivityProbe;
  claimToken: string;
  /** Internal test seam: executes after the initial contract guard and before
   * the final guard immediately preceding the provider mutation. */
  beforeProviderMutationBillingGuard?: () => void | Promise<void>;
  beforeFinalizeJob?: () => void | Promise<void>;
  beforeNotificationDelivery?: () => void | Promise<void>;
  beforeHealthRetrySchedule?: () => void | Promise<void>;
  afterHealthTransition?: () => void | Promise<void>;
  beforeReconcilingPersist?: () => void | Promise<void>;
  beforeDesiredNamePersist?: () => void | Promise<void>;
};

function productFlowOwner(order: {
  id: string;
  serviceOrderId: string;
  serviceOrder: {
    recommendationQuote: { sessionId: string } | null;
  };
}) {
  return {
    recommendationSessionId:
      order.serviceOrder.recommendationQuote?.sessionId ?? null,
    serviceOrderId: order.serviceOrderId,
    infrastructureOrderId: order.id,
  };
}

async function assertFence(fence: ProvisioningJobFence) {
  await prisma.$transaction((tx) =>
    assertProvisioningJobFenceTx(tx, fence),
  );
}

async function finalizeCreateJob(
  fence: ProvisioningJobFence,
  beforeFinalize?: () => void | Promise<void>,
) {
  await beforeFinalize?.();
  return prisma.$transaction(async (tx) => {
    await assertProvisioningJobFenceTx(tx, fence);
    const finalized = await tx.provisioningJob.updateMany({
      where: {
        id: fence.jobId,
        status: ProvisioningJobStatus.RUNNING,
        claimToken: fence.claimToken,
        leaseExpiresAt: { gt: new Date() },
      },
      data: {
        status: ProvisioningJobStatus.SUCCEEDED,
        phase: "FINALIZED",
        finishedAt: new Date(),
        workerId: null,
        claimToken: null,
        lockedAt: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    if (finalized.count !== 1) throw new WorkerLeaseLostError();
  });
}

export async function processProvisioningJob(
  jobId: string,
  providerOverride?: CloudProviderAdapter,
  options?: ProvisioningProcessOptions,
) {
  if (!options?.claimToken) return null;
  const job = await prisma.provisioningJob.findUnique({
    where: { id: jobId },
    include: {
      infrastructureOrder: {
        include: {
          serviceOrder: { include: { recommendationQuote: true } },
          activationRequest: { include: { billingPolicyVersion: true } },
          plan: true,
          cloudInstance: true,
          provisioningJobs: true,
        },
      },
    },
  });
  if (
    !job ||
    job.status !== ProvisioningJobStatus.RUNNING ||
    job.claimToken !== options.claimToken
  ) {
    return null;
  }
  const workerFence = {
    jobId: job.id,
    claimToken: options.claimToken,
  };
  try {
    await assertFence(workerFence);
  } catch (error) {
    if (isWorkerLeaseLostError(error)) return null;
    throw error;
  }

  if (
    job.operation === "health_check_retry" ||
    job.operation === "health_check_manual_recovery"
  ) {
    const { processHealthCheckRetryJob } = await import(
      "@/lib/infrastructure/health-retry-service"
    );
    return processHealthCheckRetryJob(job.id, providerOverride, {
      healthProbe: options.healthProbe,
      claimToken: options.claimToken,
      beforeFinalizeJob: options.beforeFinalizeJob,
      beforeSuccessNotification:
        options.beforeNotificationDelivery,
      afterHealthTransition: options.afterHealthTransition,
    });
  }

  const order = job.infrastructureOrder;
  const provisionApproval = await prisma.adminCommandReceipt.findFirst({
    where: {
      infrastructureOrderId: order.id,
      operation: "APPROVE_PROVISION",
    },
    orderBy: { createdAt: "desc" },
    select: { resultSnapshot: true },
  });
  const approvalResult =
    provisionApproval?.resultSnapshot &&
    typeof provisionApproval.resultSnapshot === "object" &&
    !Array.isArray(provisionApproval.resultSnapshot)
      ? (provisionApproval.resultSnapshot as Record<string, unknown>)
      : null;
  if (approvalResult?.approved !== true) {
    throw new InfrastructureError(
      "provider_lock_incomplete",
      "Provisioning requires a recorded Admin approval",
    );
  }
  assertProviderRoute({
    productKind: order.productKind,
    provider: order.provider,
    apiVersion: order.providerApiVersion,
  });
  if (
    !isServiceReadyForProvision(order.serviceOrder.status) ||
    (providerOverride &&
      (providerOverride.provider !== order.provider ||
        providerOverride.apiVersion !== order.providerApiVersion))
  ) {
    throw new InfrastructureError(
      "provider_route_mismatch",
      "Provisioning requires the exact paid provider route",
    );
  }
  if (job.operation === "adopt_preprovisioned_inventory") {
    const inventory = order.preprovisionedInventoryItemId
      ? await prisma.preprovisionedInventoryItem.findUnique({
          where: { id: order.preprovisionedInventoryItemId },
        })
      : null;
    if (
      !inventory ||
      inventory.assignedOrderId !== order.serviceOrderId ||
      inventory.provider !== order.provider ||
      inventory.apiVersion !== order.providerApiVersion ||
      inventory.providerResourceId !==
        order.cloudInstance?.providerInstanceId ||
      job.providerResourceId !== inventory.providerResourceId ||
      job.createSentAt != null
    ) {
      throw new InfrastructureError(
        "provider_lock_incomplete",
        "Preprovisioned inventory assignment is incomplete",
      );
    }
    let healthResult = parseDurableHealthResult(
      job.healthResultSnapshot,
    );
    if (!healthResult) {
      const result = await runInfrastructureHealthCheck({
        infrastructureOrderId: order.id,
        probe: options.healthProbe,
        workerFence,
        durableJob: { jobId: job.id, workerFence },
        afterTransition: options.afterHealthTransition,
      });
      const durable = await prisma.provisioningJob.findUniqueOrThrow({
        where: { id: job.id },
        select: { healthResultSnapshot: true },
      });
      healthResult =
        parseDurableHealthResult(durable.healthResultSnapshot) ?? {
          healthCheckId: `inventory:${job.id}`,
          healthy: result.healthy,
          delivered: result.delivered,
          resultCode: result.healthy
            ? "service_active"
            : "health_check_failed",
        };
    }
    try {
      await finalizeCreateJob(workerFence, options.beforeFinalizeJob);
    } catch (error) {
      if (isWorkerLeaseLostError(error)) return null;
      return { ...healthResult, finalizePending: true as const };
    }
    if (!healthResult.healthy) {
      const { processPendingHealthRetryDispatches } = await import(
        "@/lib/infrastructure/health-retry-service"
      );
      await processPendingHealthRetryDispatches(1, {
        beforeSchedule: options.beforeHealthRetrySchedule
          ? async () => options.beforeHealthRetrySchedule?.()
          : undefined,
      });
    }
    return healthResult;
  }

  const persistedHealth = parseDurableHealthResult(
    job.healthResultSnapshot,
  );
  if (
    persistedHealth ||
    order.cloudInstance?.status === CloudInstanceStatus.ACTIVE
  ) {
    try {
      await finalizeCreateJob(
        workerFence,
        options.beforeFinalizeJob,
      );
    } catch (error) {
      if (isWorkerLeaseLostError(error)) return null;
      return {
        ...(persistedHealth ?? {
          healthy: true,
          delivered: true,
        }),
        finalizePending: true as const,
      };
    }
    if (persistedHealth && !persistedHealth.healthy) {
      try {
        const { processPendingHealthRetryDispatches } = await import(
          "@/lib/infrastructure/health-retry-service"
        );
        await processPendingHealthRetryDispatches(1, {
          beforeSchedule: options.beforeHealthRetrySchedule
            ? async () => options.beforeHealthRetrySchedule?.()
            : undefined,
        });
      } catch {
        console.error(
          "[health-retry-schedule]",
          "schedule_pending",
        );
      }
    }
    return {
      ...(persistedHealth ?? {
        healthy: true,
        delivered: true,
      }),
      finalizeOnly: true as const,
    };
  }

  const provider =
    providerOverride ??
    createCloudProviderAdapter(
      order.provider,
      order.providerApiVersion,
    );
  if (!order.desiredInstanceName) {
    const desiredName = buildDesiredInstanceName(order.id);
    await options.beforeDesiredNamePersist?.();
    try {
      await prisma.$transaction(async (tx) => {
        await proveProvisioningJobFenceTx(tx, workerFence);
        const named = await tx.infrastructureOrder.updateMany({
          where: {
            id: order.id,
            desiredInstanceName: null,
          },
          data: { desiredInstanceName: desiredName },
        });
        if (named.count !== 1) throw new WorkerLeaseLostError();
        await proveProvisioningJobFenceTx(tx, workerFence);
      });
    } catch (error) {
      if (isWorkerLeaseLostError(error)) return null;
      throw error;
    }
    order.desiredInstanceName = desiredName;
  }

  let locked: LockedProvisioningSelection;
  let taskCheckedAt = new Date();
  let createWasSent = Boolean(job.createSentAt);
  try {
    locked = parseLockedProvisioningSelection({
      snapshot: order.providerSelectionSnapshot,
      provider: order.provider,
      providerApiVersion: order.providerApiVersion,
      productKind: order.productKind,
    });
    if (order.plan.billingModel === "PAYG_WALLET") {
      const lockedBillingGate = await evaluateProvisioningBillingContractGate(
        {
          pendingService: order.activationRequest,
          provider: order.provider,
          providerApiVersion: order.providerApiVersion,
          productKind: order.productKind,
          externalPlanId: locked.externalPlanId,
        },
        prisma,
      );
      if (!lockedBillingGate.allowed) {
        throw new InfrastructureError(
          "billing_contract_blocked",
          `Billing contract snapshot is blocked: ${lockedBillingGate.blockingReasons.join(", ")}`,
        );
      }
    }
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
      name: order.desiredInstanceName!,
      orderPublicId: order.id,
      idempotencyKey: job.idempotencyKey,
    };
    const aboutToCreate =
      !job.providerResourceId &&
      !order.cloudInstance?.providerInstanceId &&
      !job.providerTaskId &&
      !job.createSentAt;
    let effectiveCreateSentAt = job.createSentAt;
    if (aboutToCreate) {
      const sentAt = new Date();
      await prisma.$transaction(async (tx) => {
        await assertProvisioningJobFenceTx(tx, workerFence);
        const marked = await tx.provisioningJob.updateMany({
          where: {
            id: job.id,
            status: ProvisioningJobStatus.RUNNING,
            claimToken: workerFence.claimToken,
            leaseExpiresAt: { gt: new Date() },
            createSentAt: null,
          },
          data: {
            createSentAt: sentAt,
            phase: "PROVIDER_SUBMITTING",
          },
        });
        if (marked.count !== 1) throw new WorkerLeaseLostError();
      });
      effectiveCreateSentAt = sentAt;
      createWasSent = true;
    }

    // Re-read the exact approved contract immediately before the first
    // provider mutation. A newer contract is never substituted for the
    // pending service snapshot.
    if (aboutToCreate && order.plan.billingModel === "PAYG_WALLET") {
      if (process.env.ABRCHIN_ISOLATED_TEST === "1") {
        await options.beforeProviderMutationBillingGuard?.();
      }
      const preMutationBillingGate =
        await evaluateProvisioningBillingContractGate(
          {
            pendingService: order.activationRequest,
            provider: order.provider,
            providerApiVersion: order.providerApiVersion,
            productKind: order.productKind,
            externalPlanId: locked.externalPlanId,
          },
          prisma,
        );
      if (!preMutationBillingGate.allowed) {
        throw new InfrastructureError(
          "billing_contract_blocked",
          `Billing contract snapshot is blocked: ${preMutationBillingGate.blockingReasons.join(", ")}`,
        );
      }
    }
    await assertFence(workerFence);
    const submission = await submitProvisioningOnce({
      adapter: provider,
      attempt: {
        paid: true,
        providerLocked: true,
        // createSentAt is durably fenced immediately before this call.
        // The current owning worker may submit once; later workers see the
        // persisted timestamp and must reconcile instead of creating.
        createSentAt: aboutToCreate
          ? null
          : effectiveCreateSentAt,
        providerTaskId: job.providerTaskId,
        providerResourceId:
          job.providerResourceId ??
          order.cloudInstance?.providerInstanceId ??
          null,
        noResourceConfirmedAt:
          order.reconcileNoResourceConfirmedJobId === job.id &&
          order.reconcileNoResourceConfirmedAttempt === job.attempt
            ? order.reconcileNoResourceConfirmedAt
            : null,
      },
      create: createInput,
    });
    await assertFence(workerFence);
    if (submission.state === "RECONCILING") {
      await options.beforeReconcilingPersist?.();
      await prisma.$transaction(async (tx) => {
        await assertProvisioningJobFenceTx(tx, workerFence);
        await transitionProductFlowTx(tx, {
          owner: productFlowOwner(order),
          from: "PROVISIONING",
          to: "PROVISIONING_RECONCILING",
          reason: "provider_create_requires_reconciliation",
          idempotencyKey: `provider-reconciling:${job.id}`,
        });
        const reconciled = await tx.provisioningJob.updateMany({
          where: {
            id: job.id,
            status: ProvisioningJobStatus.RUNNING,
            claimToken: workerFence.claimToken,
            leaseExpiresAt: { gt: new Date() },
          },
          data: {
            status: ProvisioningJobStatus.NEEDS_RECONCILIATION,
            phase: "PROVIDER_RECONCILIATION",
            lastErrorCode: "provider_ambiguous",
            lastErrorMessage: customerSafeProviderMessage(),
            finishedAt: new Date(),
            workerId: null,
            claimToken: null,
            lockedAt: null,
            leaseExpiresAt: null,
          },
        });
        if (reconciled.count !== 1) {
          throw new WorkerLeaseLostError();
        }
        const infrastructure = await tx.infrastructureOrder.updateMany({
          where: {
            id: order.id,
            status: InfrastructureOrderStatus.PROVISIONING,
          },
          data: {
            status: InfrastructureOrderStatus.NEEDS_RECONCILIATION,
          },
        });
        if (infrastructure.count !== 1) {
          throw new WorkerLeaseLostError();
        }
        await tx.provisioningNotificationOutbox.upsert({
          where: { idempotencyKey: `provider-failure:${job.id}` },
          update: {},
          create: {
            idempotencyKey: `provider-failure:${job.id}`,
            type: AdminNotificationType.NEEDS_RECONCILIATION,
            infrastructureOrderId: order.id,
            title: "نیاز به تطبیق",
            message:
              "وضعیت ساخت سرور مبهم است و نیاز به تطبیق دارد.",
          },
        });
      });
      return { state: "RECONCILING" as const };
    }

    const providerResourceId =
      submission.resourceId ?? submission.task?.resourceId ?? null;
    if (submission.task) {
      await prisma.$transaction(async (tx) => {
        await assertProvisioningJobFenceTx(tx, workerFence);
        const persisted = await tx.provisioningJob.updateMany({
          where: {
            id: job.id,
            status: ProvisioningJobStatus.RUNNING,
            claimToken: workerFence.claimToken,
            leaseExpiresAt: { gt: new Date() },
          },
          data: {
            phase: "PROVIDER_POLLING",
            providerTaskId: submission.task!.taskId,
            providerActionId: submission.task!.actionId,
            providerRequestId: submission.task!.requestId,
            providerResourceId,
            lastPolledAt: new Date(),
          },
        });
        if (persisted.count !== 1) throw new WorkerLeaseLostError();
      });
    }
    if (!providerResourceId) {
      throw new InfrastructureError(
        "provider_ambiguous",
        "Provider did not return a resource id",
      );
    }

    await assertFence(workerFence);
    let taskStatus = await provider.getTaskStatus({
      region: locked.region,
      taskId: submission.task?.taskId ?? job.providerTaskId,
      resourceId: providerResourceId,
    });
    await assertFence(workerFence);
    for (let poll = 0; poll < POLL_ATTEMPTS; poll += 1) {
      if (
        taskStatus.state === "SUCCEEDED" ||
        taskStatus.state === "FAILED"
      ) {
        break;
      }
      await sleep(POLL_DELAY_MS);
      await assertFence(workerFence);
      taskStatus = await provider.getTaskStatus({
        region: locked.region,
        taskId: taskStatus.taskId,
        resourceId: providerResourceId,
      });
      await assertFence(workerFence);
    }
    if (taskStatus.state !== "SUCCEEDED") {
      throw new InfrastructureError(
        taskStatus.state === "FAILED"
          ? "provider_unavailable"
          : "provider_ambiguous",
        "Provider task did not reach success",
      );
    }
    taskCheckedAt = taskStatus.checkedAt;

    await assertFence(workerFence);
    const observed = await provider.findExistingResource({
      region: locked.region,
      orderPublicId: order.id,
      expectedName: order.desiredInstanceName!,
      providerResourceId,
    });
    await assertFence(workerFence);
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

    await prisma.$transaction(async (tx) => {
      await assertProvisioningJobFenceTx(tx, workerFence);
      const confirmedInstance = await tx.cloudInstance.upsert({
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
          providerInstanceId: observed.id,
          ipv4: observed.ipv4,
          providerState: observed.state,
          networkId: observedNetworkId,
          securityId: observedSecurityId,
          providerObservedAt: observed.observedAt,
        },
      });
      await startInitialUsageBillingTx(tx, {
        cloudInstanceId: confirmedInstance.id,
        providerConfirmedAt: observed.observedAt,
        providerEventId:
          taskStatus.actionId ??
          taskStatus.taskId ??
          taskStatus.requestId ??
          `provider-confirmation:${job.id}`,
      });
      const persisted = await tx.provisioningJob.updateMany({
        where: {
          id: job.id,
          status: ProvisioningJobStatus.RUNNING,
          claimToken: workerFence.claimToken,
          leaseExpiresAt: { gt: new Date() },
        },
        data: {
          phase: "PROVIDER_RESULT_PERSISTED",
          providerResourceId: observed.id,
          lastPolledAt: taskCheckedAt,
        },
      });
      if (persisted.count !== 1) throw new WorkerLeaseLostError();
    });
  } catch (error) {
    if (isWorkerLeaseLostError(error)) return null;
    const errorCode =
      error instanceof InfrastructureError
        ? error.code
        : "provider_unavailable";
    const insufficientBalance = isInsufficientBalanceError(error);
    const billingContractBlocked =
      error instanceof InfrastructureError &&
      error.code === "billing_contract_blocked";
    const manualSnapshotReview =
      errorCode === "provider_lock_incomplete" || billingContractBlocked;
    const needsReconciliation =
      !insufficientBalance &&
      (isAmbiguousProviderError(error) ||
        manualSnapshotReview ||
        createWasSent);
    try {
      await prisma.$transaction(async (tx) => {
        await assertProvisioningJobFenceTx(tx, workerFence);
        const targetFlow = insufficientBalance || manualSnapshotReview
          ? "PROVISIONING_MANUAL_REVIEW"
          : needsReconciliation
            ? "PROVISIONING_RECONCILING"
            : "PROVISIONING_RETRYABLE";
        await transitionProductFlowTx(tx, {
          owner: productFlowOwner(order),
          from: "PROVISIONING",
          to: targetFlow,
          reason: insufficientBalance
            ? "provider_funding_blocked"
            : billingContractBlocked
              ? "provider_billing_contract_snapshot_blocked"
            : manualSnapshotReview
              ? "paid_provider_snapshot_incomplete"
              : needsReconciliation
                ? "provider_result_ambiguous"
                : "provider_create_failed",
          idempotencyKey: insufficientBalance
            ? `provider-funding-blocked:${job.id}`
            : billingContractBlocked
              ? `provider-billing-contract-blocked:${job.id}`
            : needsReconciliation
              ? `provider-reconciling:${job.id}`
              : `provider-retryable:${job.id}`,
        });
        const jobStatus = insufficientBalance
          ? ProvisioningJobStatus.BLOCKED_PROVIDER_BALANCE
          : manualSnapshotReview || !needsReconciliation
            ? ProvisioningJobStatus.FAILED
            : ProvisioningJobStatus.NEEDS_RECONCILIATION;
        const infraStatus = insufficientBalance
          ? InfrastructureOrderStatus.WAITING_ADMIN_FUNDING
          : manualSnapshotReview
            ? InfrastructureOrderStatus.MANUAL_REVIEW
            : !needsReconciliation
            ? InfrastructureOrderStatus.FAILED
            : InfrastructureOrderStatus.NEEDS_RECONCILIATION;
        const failed = await tx.provisioningJob.updateMany({
          where: {
            id: job.id,
            status: ProvisioningJobStatus.RUNNING,
            claimToken: workerFence.claimToken,
            leaseExpiresAt: { gt: new Date() },
          },
          data: {
            status: jobStatus,
            phase: "PROVIDER_FAILED",
            lastErrorCode: errorCode,
            lastErrorMessage: billingContractBlocked
              ? error.message.slice(0, 500)
              : customerSafeProviderMessage(),
            finishedAt: new Date(),
            workerId: null,
            claimToken: null,
            lockedAt: null,
            leaseExpiresAt: null,
          },
        });
        if (failed.count !== 1) throw new WorkerLeaseLostError();
        const infrastructure = await tx.infrastructureOrder.updateMany({
          where: {
            id: order.id,
            productFlowState: targetFlow,
          },
          data: { status: infraStatus },
        });
        if (infrastructure.count !== 1) {
          throw new WorkerLeaseLostError();
        }
        await tx.provisioningNotificationOutbox.upsert({
          where: { idempotencyKey: `provider-failure:${job.id}` },
          update: {},
          create: {
            idempotencyKey: `provider-failure:${job.id}`,
            type: insufficientBalance
              ? AdminNotificationType.PROVIDER_BALANCE_BLOCKED
              : manualSnapshotReview
                ? AdminNotificationType.PROVISIONING_FAILED
              : needsReconciliation
                ? AdminNotificationType.NEEDS_RECONCILIATION
                : AdminNotificationType.PROVISIONING_FAILED,
            infrastructureOrderId: order.id,
            title: insufficientBalance
              ? "کمبود اعتبار Provider"
              : billingContractBlocked
                ? "Billing Contract نیاز به بررسی دارد"
              : needsReconciliation
                ? "نیاز به تطبیق"
                : "خطای آماده‌سازی",
            message: insufficientBalance
              ? "اعتبار Provider کافی نیست و نیاز به بررسی دستی دارد."
              : billingContractBlocked
                ? `Provisioning پیش از تماس با Provider متوقف شد: ${error.message.slice(0, 500)}`
              : needsReconciliation
                ? "وضعیت ساخت سرور مبهم است و نیاز به تطبیق دارد."
                : "آماده‌سازی سرور با خطا مواجه شد.",
          },
        });
      });
    } catch (fenceError) {
      if (isWorkerLeaseLostError(fenceError)) return null;
      throw fenceError;
    }
    const notification =
      await prisma.provisioningNotificationOutbox.findUniqueOrThrow({
        where: { idempotencyKey: `provider-failure:${job.id}` },
      });
    try {
      await deliverProvisioningNotification(notification.id);
    } catch {
      // Delivery is retried from the durable outbox.
    }
    await logProviderOperation({
      provider: order.provider,
      operation: job.operation,
      infrastructureOrderId: order.id,
      provisioningJobId: job.id,
      status: "failed",
      errorCode,
    });
    return { state: "PROVIDER_FAILED" as const };
  }

  let healthResult = parseDurableHealthResult(
    (
      await prisma.provisioningJob.findUnique({
        where: { id: job.id },
        select: { healthResultSnapshot: true },
      })
    )?.healthResultSnapshot,
  );
  if (!healthResult) {
    try {
      const result = await runInfrastructureHealthCheck({
        infrastructureOrderId: order.id,
        probe: options.healthProbe,
        workerFence,
        durableJob: { jobId: job.id, workerFence },
        afterTransition: options.afterHealthTransition,
      });
      const refreshed =
        await prisma.provisioningJob.findUniqueOrThrow({
          where: { id: job.id },
          select: { healthResultSnapshot: true },
        });
      healthResult =
        parseDurableHealthResult(
          refreshed.healthResultSnapshot,
        ) ?? {
          healthCheckId: `legacy:${job.id}`,
          healthy: result.healthy,
          delivered: result.delivered,
          resultCode: result.healthy
            ? "service_active"
            : "health_check_failed",
        };
    } catch (error) {
      if (isWorkerLeaseLostError(error)) return null;
      const refreshed =
        await prisma.provisioningJob.findUniqueOrThrow({
          where: { id: job.id },
          select: { healthResultSnapshot: true },
        });
      healthResult = parseDurableHealthResult(
        refreshed.healthResultSnapshot,
      );
      if (!healthResult) throw error;
    }
  }

  try {
    await finalizeCreateJob(
      workerFence,
      options.beforeFinalizeJob,
    );
  } catch (error) {
    if (isWorkerLeaseLostError(error)) return null;
    return { ...healthResult, finalizePending: true as const };
  }

  if (!healthResult.healthy) {
    try {
      const { processPendingHealthRetryDispatches } = await import(
        "@/lib/infrastructure/health-retry-service"
      );
      await processPendingHealthRetryDispatches(1, {
        beforeSchedule: options.beforeHealthRetrySchedule
          ? async () => options.beforeHealthRetrySchedule?.()
          : undefined,
      });
    } catch {
      console.error("[health-retry-schedule]", "schedule_pending");
    }
  }
  return healthResult;
}

export async function runProvisioningWorkerCycle(
  providerOverride?: CloudProviderAdapter,
  workerId?: string,
) {
  const { dispatchApprovedProvisionCommands } = await import(
    "@/lib/infrastructure/provision-dispatch"
  );
  const { releaseExpiredInventoryReservations } = await import(
    "@/lib/infrastructure/preprovisioned-inventory"
  );
  const { expireDueLockedQuotes } = await import(
    "@/lib/orders/quote-expiration"
  );
  await expireDueLockedQuotes();
  await releaseExpiredInventoryReservations();
  const dispatched = await dispatchApprovedProvisionCommands(1);
  await reconcileProvisioningDispatches();
  await processPendingProvisioningNotifications();
  const job = await claimNextProvisioningJob(workerId);
  if (!job) return dispatched > 0;
  if (!job.claimToken) return false;
  await processProvisioningJob(job.id, providerOverride, {
    claimToken: job.claimToken,
  });
  return true;
}
