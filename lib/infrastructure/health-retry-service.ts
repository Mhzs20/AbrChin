import {
  AdminNotificationStatus,
  AdminNotificationType,
  InfrastructureOrderStatus,
  ProvisioningJobStatus,
  ServiceOrderStatus,
  UserRole,
  type Prisma,
} from "@prisma/client";

import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import type {
  CloudProviderAdapter,
  ProviderTopologyVerificationMode,
} from "@/lib/infrastructure/cloud-provider-adapter";
import { runInfrastructureHealthCheck } from "@/lib/infrastructure/health-check-service";
import { createCloudProviderAdapter } from "@/lib/infrastructure/provider-factory";
import { parseLockedProvisioningSelection } from "@/lib/infrastructure/provisioning-service";
import { transitionProductFlowTx } from "@/lib/product-flow/service";
import { WalletError } from "@/lib/wallet/errors";

export const HEALTH_RETRY_OPERATION = "health_check_retry";
export const HEALTH_RETRY_LIMIT = 3;
const HEALTH_RETRY_BASE_BACKOFF_MS = 30_000;
const HEALTH_RETRY_MAX_BACKOFF_MS = 5 * 60_000;
const ACTIVE_JOB_STATUSES: ProvisioningJobStatus[] = [
  ProvisioningJobStatus.QUEUED,
  ProvisioningJobStatus.RUNNING,
];

function asRecord(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function retryBackoffMs(attempt: number) {
  return Math.min(
    HEALTH_RETRY_BASE_BACKOFF_MS * 2 ** Math.max(attempt - 1, 0),
    HEALTH_RETRY_MAX_BACKOFF_MS,
  );
}

function owner(order: {
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

async function moveHealthToManualReviewTx(
  tx: Prisma.TransactionClient,
  order: {
    id: string;
    serviceOrderId: string;
    productFlowState: string | null;
    cloudInstance: {
      providerState: string | null;
      ipv4: string | null;
      networkId: string | null;
      securityId: string | null;
      providerObservedAt: Date | null;
    } | null;
    serviceOrder: {
      recommendationQuote: { sessionId: string } | null;
    };
  },
  reason: string,
  retryCount: number,
) {
  if (order.productFlowState === "HEALTH_CHECK_FAILED") {
    await transitionProductFlowTx(tx, {
      owner: owner(order),
      from: "HEALTH_CHECK_FAILED",
      to: "PROVISIONING_MANUAL_REVIEW",
      reason,
      idempotencyKey: `health-manual-review:${order.id}:${retryCount}`,
      metadata: {
        retryCount,
        retryLimit: HEALTH_RETRY_LIMIT,
        lastProviderObservation: {
          state: order.cloudInstance?.providerState ?? null,
          ipv4: order.cloudInstance?.ipv4 ?? null,
          networkId: order.cloudInstance?.networkId ?? null,
          securityId: order.cloudInstance?.securityId ?? null,
          observedAt:
            order.cloudInstance?.providerObservedAt?.toISOString() ??
            null,
        },
        containsSecret: false,
      },
    });
  }
  await tx.infrastructureOrder.update({
    where: { id: order.id },
    data: { status: InfrastructureOrderStatus.MANUAL_REVIEW },
  });
  await tx.adminNotification.create({
    data: {
      type: AdminNotificationType.NEEDS_RECONCILIATION,
      infrastructureOrderId: order.id,
      title: "بررسی دستی سلامت سرور",
      message:
        "تلاش‌های خودکار بررسی سلامت تمام شد؛ منبع موجود است و بدون ساخت مجدد باید بررسی شود.",
      status: AdminNotificationStatus.UNREAD,
    },
  });
}

async function scheduleHealthRetryTx(
  tx: Prisma.TransactionClient,
  input: {
    infrastructureOrderId: string;
    source: "AUTO" | "ADMIN";
    reason: string;
    requestKey: string;
    actorUserId?: string | null;
    immediate: boolean;
  },
) {
  await tx.$queryRaw`
    SELECT id
    FROM "InfrastructureOrder"
    WHERE id = ${input.infrastructureOrderId}
    FOR UPDATE
  `;
  const idempotencyKey =
    input.source === "ADMIN"
      ? `health-retry-admin:${input.infrastructureOrderId}:${input.requestKey}`
      : `health-retry-auto:${input.infrastructureOrderId}:${input.requestKey}`;
  const repeated = await tx.provisioningJob.findUnique({
    where: { idempotencyKey },
  });
  if (repeated) return repeated;

  const order = await tx.infrastructureOrder.findUnique({
    where: { id: input.infrastructureOrderId },
    include: {
      cloudInstance: true,
      serviceOrder: { include: { recommendationQuote: true } },
      provisioningJobs: {
        where: { operation: HEALTH_RETRY_OPERATION },
        orderBy: { attempt: "desc" },
      },
    },
  });
  if (!order) {
    throw new WalletError("not_found", "سفارش زیرساخت پیدا نشد.");
  }
  if (
    order.serviceOrder.status !== ServiceOrderStatus.PAID ||
    !order.cloudInstance
  ) {
    throw new WalletError(
      "invalid_status",
      "منبع پرداخت‌شده برای بررسی سلامت موجود نیست.",
    );
  }
  if (order.productFlowState !== "HEALTH_CHECK_FAILED") {
    throw new WalletError(
      "invalid_status",
      "این سفارش در وضعیت Retry سلامت نیست.",
    );
  }

  parseLockedProvisioningSelection({
    snapshot: order.providerSelectionSnapshot,
    provider: order.provider,
    providerApiVersion: order.providerApiVersion,
    productKind: order.productKind,
  });

  const active = order.provisioningJobs.find((job) =>
    ACTIVE_JOB_STATUSES.includes(job.status),
  );
  if (active) {
    if (input.source === "ADMIN" && input.immediate) {
      await tx.provisioningJob.update({
        where: { id: active.id },
        data: {
          availableAt: new Date(),
          jobMetadata: {
            ...asRecord(active.jobMetadata),
            manualReason: input.reason,
            manualActorUserId: input.actorUserId ?? null,
            manualRequestKey: input.requestKey,
            containsSecret: false,
          },
        },
      });
    }
    return active;
  }

  const retryCount = order.provisioningJobs.length;
  if (retryCount >= HEALTH_RETRY_LIMIT) {
    await moveHealthToManualReviewTx(
      tx,
      order,
      "health_retry_limit_exhausted",
      retryCount,
    );
    return null;
  }

  const attempt = retryCount + 1;
  const availableAt = input.immediate
    ? new Date()
    : new Date(Date.now() + retryBackoffMs(attempt));
  return tx.provisioningJob.create({
    data: {
      infrastructureOrderId: order.id,
      operation: HEALTH_RETRY_OPERATION,
      status: ProvisioningJobStatus.QUEUED,
      idempotencyKey,
      attempt,
      availableAt,
      providerResourceId: order.cloudInstance.providerInstanceId,
      jobMetadata: {
        source: input.source,
        reason: input.reason,
        actorUserId: input.actorUserId ?? null,
        retryAttempt: attempt,
        retryLimit: HEALTH_RETRY_LIMIT,
        containsSecret: false,
      },
    },
  });
}

export async function scheduleAutomaticHealthRetry(input: {
  infrastructureOrderId: string;
  sourceCheckId: string;
}) {
  return prisma.$transaction((tx) =>
    scheduleHealthRetryTx(tx, {
      infrastructureOrderId: input.infrastructureOrderId,
      source: "AUTO",
      reason: "automatic_health_recovery",
      requestKey: input.sourceCheckId,
      immediate: false,
    }),
  );
}

export async function scheduleManualHealthRetry(input: {
  infrastructureOrderId: string;
  adminUserId: string;
  reason: string;
  idempotencyKey: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new WalletError(
      "invalid_reason",
      "دلیل Retry باید بین ۳ تا ۵۰۰ کاراکتر باشد.",
    );
  }
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(input.idempotencyKey)) {
    throw new WalletError(
      "invalid_idempotency_key",
      "شناسه یکتای Retry معتبر نیست.",
    );
  }
  const admin = await prisma.user.findUnique({
    where: { id: input.adminUserId },
    select: { role: true },
  });
  if (admin?.role !== UserRole.ADMIN) {
    throw new WalletError("forbidden", "دسترسی مجاز نیست.");
  }

  const job = await prisma.$transaction(async (tx) => {
    const job = await scheduleHealthRetryTx(tx, {
      infrastructureOrderId: input.infrastructureOrderId,
      source: "ADMIN",
      reason,
      requestKey: input.idempotencyKey,
      actorUserId: input.adminUserId,
      immediate: true,
    });
    if (!job) return null;
    await writeAuditLog(
      {
        actorUserId: input.adminUserId,
        action: AuditActions.HEALTH_CHECK_RETRY,
        entityType: "infrastructure_order",
        entityId: input.infrastructureOrderId,
        afterData: {
          reason,
          jobId: job.id,
          retryAttempt: job.attempt,
          idempotencyKey: input.idempotencyKey,
          containsSecret: false,
        },
        ip: input.ip,
        userAgent: input.userAgent,
        idempotencyKey: `audit:health-retry:${input.infrastructureOrderId}:${input.idempotencyKey}`,
      },
      tx,
    );
    return job;
  });
  if (!job) {
    throw new WalletError(
      "retry_limit_exhausted",
      "سقف تلاش سلامت تمام شده و سفارش به بررسی دستی منتقل شد.",
    );
  }
  return job;
}

function observedTopology(
  mode: ProviderTopologyVerificationMode,
  ids: string[] | null,
  expected: string | null,
) {
  if (mode === "PROVIDER_MANAGED") return null;
  return expected && ids?.includes(expected)
    ? expected
    : ids?.[0] ?? null;
}

export async function processHealthCheckRetryJob(
  jobId: string,
  providerOverride?: CloudProviderAdapter,
  options?: {
    healthProbe?: Parameters<
      typeof runInfrastructureHealthCheck
    >[0]["probe"];
  },
) {
  const job = await prisma.provisioningJob.findUnique({
    where: { id: jobId },
    include: {
      infrastructureOrder: {
        include: {
          cloudInstance: true,
          serviceOrder: { include: { recommendationQuote: true } },
        },
      },
    },
  });
  if (
    !job ||
    job.operation !== HEALTH_RETRY_OPERATION ||
    job.status !== ProvisioningJobStatus.RUNNING
  ) {
    return null;
  }
  const order = job.infrastructureOrder;
  const instance = order.cloudInstance;
  if (!instance) throw new Error("provider_resource_not_ready");
  if (order.serviceOrder.status !== ServiceOrderStatus.PAID) {
    throw new Error("health_retry_requires_paid_order");
  }
  const locked = parseLockedProvisioningSelection({
    snapshot: order.providerSelectionSnapshot,
    provider: order.provider,
    providerApiVersion: order.providerApiVersion,
    productKind: order.productKind,
  });
  const provider =
    providerOverride ??
    createCloudProviderAdapter(
      order.provider,
      order.providerApiVersion,
    );
  if (
    provider.provider !== order.provider ||
    provider.apiVersion !== order.providerApiVersion ||
    provider.topologyVerificationMode !==
      locked.topologyVerificationMode
  ) {
    throw new Error("provider_route_mismatch");
  }

  try {
    const observed = await provider.findExistingResource({
      region: locked.region,
      orderPublicId: order.id,
      expectedName: order.desiredInstanceName ?? instance.name,
      providerResourceId: instance.providerInstanceId,
    });
    await prisma.cloudInstance.update({
      where: { id: instance.id },
      data: observed
        ? {
            ipv4: observed.ipv4,
            providerState: observed.state,
            networkId: observedTopology(
              locked.topologyVerificationMode,
              observed.networkIds,
              locked.externalNetworkId,
            ),
            securityId: observedTopology(
              locked.topologyVerificationMode,
              observed.securityIds,
              locked.externalSecurityId,
            ),
            providerObservedAt: observed.observedAt,
          }
        : {
            ipv4: null,
            providerState: "unknown",
            networkId: null,
            securityId: null,
            providerObservedAt: null,
          },
    });

    const metadata = asRecord(job.jobMetadata);
    const actorUserId =
      typeof metadata.actorUserId === "string"
        ? metadata.actorUserId
        : typeof metadata.manualActorUserId === "string"
          ? metadata.manualActorUserId
          : null;
    const result = await runInfrastructureHealthCheck({
      infrastructureOrderId: order.id,
      probe: options?.healthProbe,
      retryTransition: {
        idempotencyKey: `health-retry-start:${job.id}`,
        actorUserId,
      },
    });
    await prisma.provisioningJob.update({
      where: { id: job.id },
      data: {
        status: result.healthy
          ? ProvisioningJobStatus.SUCCEEDED
          : ProvisioningJobStatus.FAILED,
        finishedAt: new Date(),
        workerId: null,
        lockedAt: null,
        leaseExpiresAt: null,
        lastErrorCode: result.healthy
          ? null
          : "health_check_failed",
        lastErrorMessage: result.healthy
          ? null
          : "بررسی سلامت سرور نیاز به تلاش مجدد دارد.",
      },
    });
    if (!result.healthy) {
      await scheduleAutomaticHealthRetry({
        infrastructureOrderId: order.id,
        sourceCheckId: job.id,
      });
    }
    return result;
  } catch {
    await prisma.provisioningJob.update({
      where: { id: job.id },
      data: {
        status: ProvisioningJobStatus.FAILED,
        finishedAt: new Date(),
        workerId: null,
        lockedAt: null,
        leaseExpiresAt: null,
        lastErrorCode: "health_reconciliation_failed",
        lastErrorMessage:
          "مشاهده وضعیت Provider برای بررسی سلامت ممکن نشد.",
      },
    });
    await scheduleAutomaticHealthRetry({
      infrastructureOrderId: order.id,
      sourceCheckId: job.id,
    });
    return { healthy: false as const, delivered: false as const };
  }
}
