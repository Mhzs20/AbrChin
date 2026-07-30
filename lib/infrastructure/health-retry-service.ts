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
import {
  idempotencyFingerprint,
  stableJson,
} from "@/lib/idempotency";
import type {
  CloudProviderAdapter,
  ProviderTopologyVerificationMode,
} from "@/lib/infrastructure/cloud-provider-adapter";
import {
  parseDurableHealthResult,
  runInfrastructureHealthCheck,
} from "@/lib/infrastructure/health-check-service";
import { createCloudProviderAdapter } from "@/lib/infrastructure/provider-factory";
import { parseLockedProvisioningSelection } from "@/lib/infrastructure/provisioning-service";
import { transitionProductFlowTx } from "@/lib/product-flow/service";
import { WalletError } from "@/lib/wallet/errors";
import {
  assertProvisioningJobFenceTx,
  isWorkerLeaseLostError,
  type ProvisioningJobFence,
  WorkerLeaseLostError,
} from "@/lib/infrastructure/worker-fence";

export const HEALTH_RETRY_OPERATION = "health_check_retry";
export const HEALTH_MANUAL_RECOVERY_OPERATION =
  "health_check_manual_recovery";
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

function healthOperationFingerprint(input: {
  infrastructureOrderId: string;
  actorUserId?: string | null;
  reason: string;
  source: string;
  operation: string;
}) {
  return idempotencyFingerprint({
    infrastructureOrderId: input.infrastructureOrderId,
    actorUserId: input.actorUserId ?? null,
    reason: input.reason,
    source: input.source,
    operation: input.operation,
  });
}

function assertHealthOperationReplay(
  job: {
    infrastructureOrderId: string;
    operation: string;
    jobMetadata: Prisma.JsonValue | null;
  },
  input: {
    infrastructureOrderId: string;
    actorUserId?: string | null;
    reason: string;
    source: string;
    operation: string;
    fingerprint: string;
  },
) {
  const metadata = asRecord(job.jobMetadata);
  const storedFingerprint =
    typeof metadata.requestFingerprint === "string"
      ? metadata.requestFingerprint
      : healthOperationFingerprint({
          infrastructureOrderId: job.infrastructureOrderId,
          actorUserId:
            typeof metadata.actorUserId === "string"
              ? metadata.actorUserId
              : null,
          reason:
            typeof metadata.reason === "string" ? metadata.reason : "",
          source:
            typeof metadata.source === "string" ? metadata.source : "",
          operation: job.operation,
        });
  if (
    job.infrastructureOrderId !== input.infrastructureOrderId ||
    job.operation !== input.operation ||
    storedFingerprint !== input.fingerprint
  ) {
    throw new WalletError(
      "idempotency_conflict",
      "شناسه یکتا قبلاً برای درخواست دیگری استفاده شده است.",
    );
  }
}

function adminHealthReceiptKey(idempotencyKey: string) {
  return `health-retry-admin:${idempotencyKey}`;
}

function asHealthRetryReceipt(value: Prisma.JsonValue) {
  const snapshot = asRecord(value);
  if (
    typeof snapshot.jobId !== "string" ||
    typeof snapshot.status !== "string" ||
    typeof snapshot.availableAt !== "string" ||
    typeof snapshot.attempt !== "number"
  ) {
    throw new Error("health_retry_receipt_invalid");
  }
  return {
    jobId: snapshot.jobId,
    status: snapshot.status as ProvisioningJobStatus,
    availableAt: new Date(snapshot.availableAt),
    attempt: snapshot.attempt,
  };
}

async function replayAdminHealthReceiptTx(
  tx: Prisma.TransactionClient,
  input: {
    idempotencyKey: string;
    requestFingerprint: string;
    infrastructureOrderId: string;
    adminUserId: string;
  },
) {
  const receipt = await tx.adminCommandReceipt.findUnique({
    where: {
      idempotencyKey: adminHealthReceiptKey(input.idempotencyKey),
    },
  });
  if (!receipt) return null;
  if (
    receipt.operation !== "ADMIN_HEALTH_RETRY" ||
    receipt.requestFingerprint !== input.requestFingerprint ||
    receipt.infrastructureOrderId !== input.infrastructureOrderId ||
    receipt.actorUserId !== input.adminUserId
  ) {
    throw new WalletError(
      "idempotency_conflict",
      "شناسه یکتا قبلاً برای درخواست دیگری استفاده شده است.",
    );
  }
  const snapshot = asHealthRetryReceipt(receipt.resultSnapshot);
  const job = await tx.provisioningJob.findUniqueOrThrow({
    where: { id: snapshot.jobId },
  });
  return {
    ...job,
    status: snapshot.status,
    availableAt: snapshot.availableAt,
    attempt: snapshot.attempt,
  };
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
  options?: {
    transitionIdempotencyKey?: string;
    actorUserId?: string | null;
    retryLimit?: number | null;
    source?: "AUTO" | "MANUAL";
  },
) {
  let manualReviewReached =
    order.productFlowState === "PROVISIONING_MANUAL_REVIEW";
  if (order.productFlowState === "HEALTH_CHECKING") {
    await transitionProductFlowTx(tx, {
      owner: owner(order),
      from: "HEALTH_CHECKING",
      to: "HEALTH_CHECK_FAILED",
      reason: `${reason}_health_failed`,
      idempotencyKey:
        `${options?.transitionIdempotencyKey ??
          `health-manual-review:${order.id}:${retryCount}`}:failed`,
      actorUserId: options?.actorUserId ?? null,
      metadata: {
        retryCount,
        source: options?.source ?? "AUTO",
        containsSecret: false,
      },
    });
    order.productFlowState = "HEALTH_CHECK_FAILED";
  }
  if (order.productFlowState === "HEALTH_CHECK_FAILED") {
    await transitionProductFlowTx(tx, {
      owner: owner(order),
      from: "HEALTH_CHECK_FAILED",
      to: "PROVISIONING_MANUAL_REVIEW",
      reason,
      idempotencyKey:
        options?.transitionIdempotencyKey ??
        `health-manual-review:${order.id}:${retryCount}`,
      actorUserId: options?.actorUserId ?? null,
      metadata: {
        retryCount,
        retryLimit:
          options?.retryLimit === undefined
            ? HEALTH_RETRY_LIMIT
            : options.retryLimit,
        source: options?.source ?? "AUTO",
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
    manualReviewReached = true;
  }
  if (!manualReviewReached) {
    throw new Error(
      `manual_review_state_conflict:${order.productFlowState ?? "null"}`,
    );
  }
  const updated = await tx.infrastructureOrder.updateMany({
    where: {
      id: order.id,
      productFlowState: "PROVISIONING_MANUAL_REVIEW",
    },
    data: { status: InfrastructureOrderStatus.MANUAL_REVIEW },
  });
  if (updated.count !== 1) {
    throw new Error("manual_review_state_conflict");
  }
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
  const requestFingerprint = healthOperationFingerprint({
    infrastructureOrderId: input.infrastructureOrderId,
    actorUserId: input.actorUserId,
    reason: input.reason,
    source: input.source,
    operation: HEALTH_RETRY_OPERATION,
  });
  const idempotencyKey =
    input.source === "ADMIN"
      ? `health-retry-admin:${input.requestKey}`
      : `health-retry-auto:${input.requestKey}`;
  const repeated = await tx.provisioningJob.findUnique({
    where: { idempotencyKey },
  });
  if (repeated) {
    assertHealthOperationReplay(repeated, {
      infrastructureOrderId: input.infrastructureOrderId,
      actorUserId: input.actorUserId,
      reason: input.reason,
      source: input.source,
      operation: HEALTH_RETRY_OPERATION,
      fingerprint: requestFingerprint,
    });
    return repeated;
  }

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
      return tx.provisioningJob.update({
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
        requestFingerprint,
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
  const requestFingerprint = healthOperationFingerprint({
    infrastructureOrderId: input.infrastructureOrderId,
    actorUserId: input.adminUserId,
    reason,
    source: "ADMIN",
    operation: HEALTH_RETRY_OPERATION,
  });

  const job = await prisma.$transaction(async (tx) => {
    const receiptKey = adminHealthReceiptKey(input.idempotencyKey);
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`command:${receiptKey}`}, 0)
      )::text AS locked
    `;
    const replay = await replayAdminHealthReceiptTx(tx, {
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      infrastructureOrderId: input.infrastructureOrderId,
      adminUserId: input.adminUserId,
    });
    if (replay) return replay;

    const job = await scheduleHealthRetryTx(tx, {
      infrastructureOrderId: input.infrastructureOrderId,
      source: "ADMIN",
      reason,
      requestKey: input.idempotencyKey,
      actorUserId: input.adminUserId,
      immediate: true,
    });
    if (!job) return null;
    const resultSnapshot = {
      jobId: job.id,
      status: job.status,
      availableAt: job.availableAt.toISOString(),
      attempt: job.attempt,
      requestFingerprint,
      actorUserId: input.adminUserId,
      reason,
      infrastructureOrderId: input.infrastructureOrderId,
      containsSecret: false,
    };
    await tx.adminCommandReceipt.create({
      data: {
        operation: "ADMIN_HEALTH_RETRY",
        idempotencyKey: receiptKey,
        requestFingerprint,
        actorUserId: input.adminUserId,
        infrastructureOrderId: input.infrastructureOrderId,
        resultSnapshot,
      },
    });
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
          requestFingerprint,
          receiptKey,
          containsSecret: false,
        },
        ip: input.ip,
        userAgent: input.userAgent,
        idempotencyKey: `audit:health-retry:${input.idempotencyKey}`,
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

async function requireAdminOperation(input: {
  adminUserId: string;
  reason: string;
  idempotencyKey: string;
  operation: string;
  infrastructureOrderId: string;
}) {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new WalletError(
      "invalid_reason",
      "دلیل عملیات باید بین ۳ تا ۵۰۰ کاراکتر باشد.",
    );
  }
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(input.idempotencyKey)) {
    throw new WalletError(
      "invalid_idempotency_key",
      "شناسه یکتای عملیات معتبر نیست.",
    );
  }
  const admin = await prisma.user.findUnique({
    where: { id: input.adminUserId },
    select: { role: true },
  });
  if (admin?.role !== UserRole.ADMIN) {
    throw new WalletError("forbidden", "دسترسی مجاز نیست.");
  }
  return {
    reason,
    requestFingerprint: healthOperationFingerprint({
      infrastructureOrderId: input.infrastructureOrderId,
      actorUserId: input.adminUserId,
      reason,
      source: "ADMIN",
      operation: input.operation,
    }),
  };
}

async function fetchLockedProviderObservation(
  infrastructureOrderId: string,
  providerOverride?: CloudProviderAdapter,
) {
  const order = await prisma.infrastructureOrder.findUnique({
    where: { id: infrastructureOrderId },
    include: {
      cloudInstance: true,
      serviceOrder: { include: { recommendationQuote: true } },
    },
  });
  if (
    !order ||
    order.serviceOrder.status !== ServiceOrderStatus.PAID ||
    !order.cloudInstance
  ) {
    throw new WalletError(
      "invalid_status",
      "منبع پرداخت‌شده برای تطبیق Provider موجود نیست.",
    );
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
    throw new WalletError(
      "provider_route_mismatch",
      "مسیر Provider با Snapshot پرداخت‌شده مطابقت ندارد.",
    );
  }
  const observed = await provider.findExistingResource({
    region: locked.region,
    orderPublicId: order.id,
    expectedName:
      order.desiredInstanceName ?? order.cloudInstance.name,
    providerResourceId: order.cloudInstance.providerInstanceId,
  });
  if (
    observed &&
    (observed.id !== order.cloudInstance.providerInstanceId ||
      observed.region !== locked.region)
  ) {
    throw new WalletError(
      "provider_resource_identity_conflict",
      "منبع مشاهده‌شده با Snapshot قفل‌شده مطابقت ندارد.",
    );
  }
  const observation = observed
    ? {
        found: true,
        providerResourceId: observed.id,
        state: observed.state,
        ipv4: observed.ipv4,
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
        observedAt: observed.observedAt,
      }
    : {
        found: false,
        providerResourceId: order.cloudInstance.providerInstanceId,
        state: "unknown",
        ipv4: null,
        networkId: null,
        securityId: null,
        observedAt: null,
      };
  return { order, locked, observation };
}

async function persistProviderObservation(input: {
  cloudInstanceId: string;
  providerInstanceId: string;
  observation: Awaited<
    ReturnType<typeof fetchLockedProviderObservation>
  >["observation"];
  workerFence?: ProvisioningJobFence;
}) {
  return prisma.$transaction(async (tx) => {
    if (input.workerFence) {
      await assertProvisioningJobFenceTx(tx, input.workerFence);
    }
    const updated = await tx.cloudInstance.updateMany({
      where: {
        id: input.cloudInstanceId,
        providerInstanceId: input.providerInstanceId,
      },
      data: {
        ipv4: input.observation.ipv4,
        providerState: input.observation.state,
        networkId: input.observation.networkId,
        securityId: input.observation.securityId,
        providerObservedAt: input.observation.observedAt,
      },
    });
    if (updated.count !== 1) {
      throw new WalletError(
        "provider_resource_identity_conflict",
        "شناسه منبع Provider هنگام ثبت Observation تغییر کرده است.",
      );
    }
  });
}

function serializedObservation(
  observation: Awaited<
    ReturnType<typeof fetchLockedProviderObservation>
  >["observation"],
) {
  return {
    ...observation,
    observedAt: observation.observedAt?.toISOString() ?? null,
    containsSecret: false,
  };
}

export async function observeManualReviewResource(
  input: {
    infrastructureOrderId: string;
    adminUserId: string;
    reason: string;
    idempotencyKey: string;
    ip?: string | null;
    userAgent?: string | null;
  },
  providerOverride?: CloudProviderAdapter,
) {
  const { reason, requestFingerprint } =
    await requireAdminOperation({
      ...input,
      operation: "health_check_manual_observe",
    });
  const auditKey = `audit:health-observe:${input.idempotencyKey}`;
  const existing = await prisma.auditLog.findUnique({
    where: { idempotencyKey: auditKey },
  });
  if (existing) {
    const after = asRecord(existing.afterData);
    if (
      existing.actorUserId !== input.adminUserId ||
      existing.action !== AuditActions.HEALTH_CHECK_MANUAL_OBSERVE ||
      existing.entityType !== "infrastructure_order" ||
      existing.entityId !== input.infrastructureOrderId ||
      after.requestFingerprint !== requestFingerprint
    ) {
      throw new WalletError(
        "idempotency_conflict",
        "شناسه یکتا قبلاً برای درخواست دیگری استفاده شده است.",
      );
    }
    return asRecord(
      (after.observation ?? null) as Prisma.JsonValue | null,
    );
  }

  const fetched = await fetchLockedProviderObservation(
    input.infrastructureOrderId,
    providerOverride,
  );
  if (
    fetched.order.status !== InfrastructureOrderStatus.MANUAL_REVIEW ||
    fetched.order.productFlowState !==
      "PROVISIONING_MANUAL_REVIEW"
  ) {
    throw new WalletError(
      "invalid_status",
      "سفارش در وضعیت بررسی دستی نیست.",
    );
  }
  const observation = serializedObservation(fetched.observation);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id
      FROM "InfrastructureOrder"
      WHERE id = ${input.infrastructureOrderId}
      FOR UPDATE
    `;
    const repeated = await tx.auditLog.findUnique({
      where: { idempotencyKey: auditKey },
    });
    if (repeated) {
      const after = asRecord(repeated.afterData);
      if (
        repeated.actorUserId !== input.adminUserId ||
        repeated.action !==
          AuditActions.HEALTH_CHECK_MANUAL_OBSERVE ||
        repeated.entityId !== input.infrastructureOrderId ||
        after.requestFingerprint !== requestFingerprint
      ) {
        throw new WalletError(
          "idempotency_conflict",
          "شناسه یکتا قبلاً برای درخواست دیگری استفاده شده است.",
        );
      }
      return asRecord(
        (after.observation ?? null) as Prisma.JsonValue | null,
      );
    }
    const current = await tx.infrastructureOrder.findUniqueOrThrow({
      where: { id: input.infrastructureOrderId },
      include: { cloudInstance: true },
    });
    if (
      current.status !== InfrastructureOrderStatus.MANUAL_REVIEW ||
      current.productFlowState !==
        "PROVISIONING_MANUAL_REVIEW" ||
      current.provider !== fetched.order.provider ||
      current.providerApiVersion !==
        fetched.order.providerApiVersion ||
      stableJson(current.providerSelectionSnapshot) !==
        stableJson(fetched.order.providerSelectionSnapshot) ||
      current.cloudInstance?.providerInstanceId !==
        fetched.order.cloudInstance!.providerInstanceId
    ) {
      throw new WalletError(
        "provider_lock_changed",
        "Snapshot قفل‌شده سفارش تغییر کرده است.",
      );
    }
    const updated = await tx.cloudInstance.updateMany({
      where: {
        id: fetched.order.cloudInstance!.id,
        providerInstanceId:
          fetched.order.cloudInstance!.providerInstanceId,
      },
      data: {
        ipv4: fetched.observation.ipv4,
        providerState: fetched.observation.state,
        networkId: fetched.observation.networkId,
        securityId: fetched.observation.securityId,
        providerObservedAt: fetched.observation.observedAt,
      },
    });
    if (updated.count !== 1) {
      throw new WalletError(
        "provider_resource_identity_conflict",
        "شناسه منبع Provider هنگام ثبت Observation تغییر کرده است.",
      );
    }
    await writeAuditLog(
      {
        actorUserId: input.adminUserId,
        action: AuditActions.HEALTH_CHECK_MANUAL_OBSERVE,
        entityType: "infrastructure_order",
        entityId: input.infrastructureOrderId,
        afterData: {
          reason,
          requestFingerprint,
          provider: current.provider,
          providerApiVersion: current.providerApiVersion,
          providerResourceId:
            current.cloudInstance!.providerInstanceId,
          observation,
          containsSecret: false,
        },
        ip: input.ip,
        userAgent: input.userAgent,
        idempotencyKey: auditKey,
      },
      tx,
    );
    return observation;
  });
}

export async function scheduleManualHealthRecovery(input: {
  infrastructureOrderId: string;
  adminUserId: string;
  reason: string;
  idempotencyKey: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const { reason, requestFingerprint } =
    await requireAdminOperation({
      ...input,
      operation: HEALTH_MANUAL_RECOVERY_OPERATION,
    });
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id
      FROM "InfrastructureOrder"
      WHERE id = ${input.infrastructureOrderId}
      FOR UPDATE
    `;
    const jobKey = `health-manual-recovery:${input.idempotencyKey}`;
    const repeated = await tx.provisioningJob.findUnique({
      where: { idempotencyKey: jobKey },
    });
    if (repeated) {
      assertHealthOperationReplay(repeated, {
        infrastructureOrderId: input.infrastructureOrderId,
        actorUserId: input.adminUserId,
        reason,
        source: "ADMIN",
        operation: HEALTH_MANUAL_RECOVERY_OPERATION,
        fingerprint: requestFingerprint,
      });
      return repeated;
    }
    const order = await tx.infrastructureOrder.findUnique({
      where: { id: input.infrastructureOrderId },
      include: {
        cloudInstance: true,
        serviceOrder: true,
        provisioningJobs: {
          where: {
            operation: {
              in: [
                HEALTH_RETRY_OPERATION,
                HEALTH_MANUAL_RECOVERY_OPERATION,
              ],
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (
      !order ||
      !order.cloudInstance ||
      order.serviceOrder.status !== ServiceOrderStatus.PAID ||
      order.status !== InfrastructureOrderStatus.MANUAL_REVIEW ||
      order.productFlowState !==
        "PROVISIONING_MANUAL_REVIEW"
    ) {
      throw new WalletError(
        "invalid_status",
        "سفارش آماده Recovery دستی نیست.",
      );
    }
    parseLockedProvisioningSelection({
      snapshot: order.providerSelectionSnapshot,
      provider: order.provider,
      providerApiVersion: order.providerApiVersion,
      productKind: order.productKind,
    });
    if (
      order.provisioningJobs.some((job) =>
        ACTIVE_JOB_STATUSES.includes(job.status),
      )
    ) {
      throw new WalletError(
        "manual_recovery_in_progress",
        "یک Recovery سلامت برای این سفارش در حال اجراست.",
      );
    }
    const manualAttempt =
      order.provisioningJobs.filter(
        (job) =>
          job.operation === HEALTH_MANUAL_RECOVERY_OPERATION,
      ).length + 1;
    const job = await tx.provisioningJob.create({
      data: {
        infrastructureOrderId: order.id,
        operation: HEALTH_MANUAL_RECOVERY_OPERATION,
        status: ProvisioningJobStatus.QUEUED,
        idempotencyKey: jobKey,
        attempt: manualAttempt,
        availableAt: new Date(),
        providerResourceId:
          order.cloudInstance.providerInstanceId,
        jobMetadata: {
          source: "ADMIN",
          reason,
          actorUserId: input.adminUserId,
          requestFingerprint,
          manualAttempt,
          automaticRetryCount: HEALTH_RETRY_LIMIT,
          containsSecret: false,
        },
      },
    });
    await writeAuditLog(
      {
        actorUserId: input.adminUserId,
        action: AuditActions.HEALTH_CHECK_MANUAL_RECOVERY,
        entityType: "infrastructure_order",
        entityId: order.id,
        afterData: {
          reason,
          requestFingerprint,
          jobId: job.id,
          manualAttempt,
          provider: order.provider,
          providerApiVersion: order.providerApiVersion,
          providerResourceId:
            order.cloudInstance.providerInstanceId,
          containsSecret: false,
        },
        ip: input.ip,
        userAgent: input.userAgent,
        idempotencyKey: `audit:health-manual-recovery:${input.idempotencyKey}`,
      },
      tx,
    );
    return job;
  });
}

async function recordManualRecoveryResult(
  job: {
    id: string;
    attempt: number;
    infrastructureOrderId: string;
    jobMetadata: Prisma.JsonValue | null;
  },
  input: {
    healthy: boolean;
    delivered: boolean;
    resultCode: string;
  },
  workerFence?: ProvisioningJobFence,
  beforeAudit?: () => void | Promise<void>,
) {
  const metadata = asRecord(job.jobMetadata);
  const actorUserId =
    typeof metadata.actorUserId === "string"
      ? metadata.actorUserId
      : null;
  if (!actorUserId) {
    throw new Error("manual_recovery_actor_missing");
  }
  if (!input.healthy) {
    await prisma.$transaction(async (tx) => {
      if (workerFence) {
        await assertProvisioningJobFenceTx(tx, workerFence);
      }
      await tx.$queryRaw`
        SELECT id
        FROM "InfrastructureOrder"
        WHERE id = ${job.infrastructureOrderId}
        FOR UPDATE
      `;
      const order = await tx.infrastructureOrder.findUniqueOrThrow({
        where: { id: job.infrastructureOrderId },
        include: {
          cloudInstance: true,
          serviceOrder: { include: { recommendationQuote: true } },
        },
      });
      await moveHealthToManualReviewTx(
        tx,
        order,
        "manual_health_recovery_failed",
        job.attempt,
        {
          transitionIdempotencyKey:
            `health-manual-recovery-failed:${job.id}`,
          actorUserId,
          retryLimit: null,
          source: "MANUAL",
        },
      );
    });
  }
  const order = await prisma.infrastructureOrder.findUniqueOrThrow({
    where: { id: job.infrastructureOrderId },
    include: { cloudInstance: true },
  });
  await beforeAudit?.();
  await writeAuditLog({
    actorUserId,
    action: AuditActions.HEALTH_CHECK_MANUAL_RECOVERY_RESULT,
    entityType: "infrastructure_order",
    entityId: order.id,
    afterData: {
      jobId: job.id,
      manualAttempt: job.attempt,
      healthy: input.healthy,
      delivered: input.delivered,
      resultCode: input.resultCode,
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
    idempotencyKey:
      `audit:health-manual-recovery-result:${job.id}`,
  });
}

async function finalizeHealthRetryJob(input: {
  jobId: string;
  workerFence: ProvisioningJobFence;
  healthy: boolean;
  beforeFinalize?: () => void | Promise<void>;
}) {
  await input.beforeFinalize?.();
  return prisma.$transaction(async (tx) => {
    await assertProvisioningJobFenceTx(tx, input.workerFence);
    const finalized = await tx.provisioningJob.updateMany({
      where: {
        id: input.jobId,
        status: ProvisioningJobStatus.RUNNING,
        claimToken: input.workerFence.claimToken,
        leaseExpiresAt: { gt: new Date() },
      },
      data: {
        status: input.healthy
          ? ProvisioningJobStatus.SUCCEEDED
          : ProvisioningJobStatus.FAILED,
        finishedAt: new Date(),
        workerId: null,
        claimToken: null,
        lockedAt: null,
        leaseExpiresAt: null,
        lastErrorCode: input.healthy
          ? null
          : "health_check_failed",
        lastErrorMessage: input.healthy
          ? null
          : "بررسی سلامت سرور نیاز به تلاش مجدد دارد.",
      },
    });
    if (finalized.count !== 1) throw new WorkerLeaseLostError();
  });
}

async function ensureHealthFailureIsRecoverable(input: {
  infrastructureOrderId: string;
  jobId: string;
  attempt: number;
  isManualRecovery: boolean;
  actorUserId: string | null;
  workerFence: ProvisioningJobFence;
  resultCode: string;
}) {
  if (input.isManualRecovery) {
    await recordManualRecoveryResult(
      {
        id: input.jobId,
        attempt: input.attempt,
        infrastructureOrderId: input.infrastructureOrderId,
        jobMetadata: input.actorUserId
          ? { actorUserId: input.actorUserId }
          : null,
      },
      {
        healthy: false,
        delivered: false,
        resultCode: input.resultCode,
      },
      input.workerFence,
    );
    return;
  }
  await prisma.$transaction(async (tx) => {
    await assertProvisioningJobFenceTx(tx, input.workerFence);
    await tx.$queryRaw`
      SELECT id
      FROM "InfrastructureOrder"
      WHERE id = ${input.infrastructureOrderId}
      FOR UPDATE
    `;
    const order = await tx.infrastructureOrder.findUniqueOrThrow({
      where: { id: input.infrastructureOrderId },
      include: {
        cloudInstance: true,
        serviceOrder: { include: { recommendationQuote: true } },
      },
    });
    if (order.productFlowState === "HEALTH_CHECKING") {
      await transitionProductFlowTx(tx, {
        owner: owner(order),
        from: "HEALTH_CHECKING",
        to: "HEALTH_CHECK_FAILED",
        reason: input.resultCode,
        idempotencyKey:
          `health-execution-failed:${input.jobId}`,
        actorUserId: input.actorUserId,
      });
    } else if (order.productFlowState !== "HEALTH_CHECK_FAILED") {
      if (
        order.productFlowState === "ACTIVE" ||
        order.productFlowState === "DELIVERED" ||
        order.productFlowState === "DELIVERY_RETRYABLE"
      ) {
        return;
      }
      throw new Error(
        `health_failure_state_conflict:${order.productFlowState ?? "null"}`,
      );
    }
  });
}

async function notifyManualRecoverySuccess(
  infrastructureOrderId: string,
) {
  const existing = await prisma.adminNotification.findFirst({
    where: {
      infrastructureOrderId,
      type: AdminNotificationType.INSTANCE_ACTIVE,
      title: "Recovery سلامت تکمیل شد",
    },
    select: { id: true },
  });
  if (existing) return;
  await prisma.adminNotification.create({
    data: {
      type: AdminNotificationType.INSTANCE_ACTIVE,
      infrastructureOrderId,
      title: "Recovery سلامت تکمیل شد",
      message:
        "منبع موجود دوباره بررسی شد و سرویس بدون ساخت مجدد فعال است.",
      status: AdminNotificationStatus.UNREAD,
    },
  });
}

export async function processHealthCheckRetryJob(
  jobId: string,
  providerOverride?: CloudProviderAdapter,
  options?: {
    healthProbe?: Parameters<
      typeof runInfrastructureHealthCheck
    >[0]["probe"];
    claimToken?: string | null;
    beforeFinalizeJob?: () => void | Promise<void>;
    beforeResultAudit?: () => void | Promise<void>;
    beforeSuccessNotification?: () => void | Promise<void>;
    afterHealthTransition?: () => void | Promise<void>;
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
  const isAutomaticRetry =
    job?.operation === HEALTH_RETRY_OPERATION;
  const isManualRecovery =
    job?.operation === HEALTH_MANUAL_RECOVERY_OPERATION;
  if (
    !job ||
    (!isAutomaticRetry && !isManualRecovery) ||
    job.status !== ProvisioningJobStatus.RUNNING
  ) {
    return null;
  }
  if (
    !options?.claimToken ||
    job.claimToken !== options.claimToken
  ) {
    return null;
  }
  const workerFence = {
    jobId: job.id,
    claimToken: options.claimToken,
  };
  try {
    await prisma.$transaction((tx) =>
      assertProvisioningJobFenceTx(tx, workerFence),
    );
  } catch (error) {
    if (isWorkerLeaseLostError(error)) return null;
    throw error;
  }
  const order = job.infrastructureOrder;
  const instance = order.cloudInstance;
  if (!instance) throw new Error("provider_resource_not_ready");
  if (order.serviceOrder.status !== ServiceOrderStatus.PAID) {
    throw new Error("health_retry_requires_paid_order");
  }
  if (
    job.providerResourceId &&
    job.providerResourceId !== instance.providerInstanceId
  ) {
    throw new Error("provider_resource_identity_conflict");
  }
  const persistedHealthResult = parseDurableHealthResult(
    job.healthResultSnapshot,
  );
  if (persistedHealthResult) {
    let finalizePending = false;
    try {
      await finalizeHealthRetryJob({
        jobId: job.id,
        workerFence,
        healthy: persistedHealthResult.healthy,
        beforeFinalize: options?.beforeFinalizeJob,
      });
    } catch (error) {
      if (isWorkerLeaseLostError(error)) return null;
      finalizePending = true;
    }
    if (finalizePending) {
      return {
        healthy: persistedHealthResult.healthy,
        delivered: persistedHealthResult.delivered,
        finalizePending: true as const,
      };
    }
    if (!persistedHealthResult.healthy && !isManualRecovery) {
      try {
        await scheduleAutomaticHealthRetry({
          infrastructureOrderId: order.id,
          sourceCheckId: job.id,
        });
      } catch {
        console.error(
          "[health-retry-schedule]",
          "schedule_pending",
        );
      }
    }
    if (persistedHealthResult.healthy && isManualRecovery) {
      try {
        await notifyManualRecoverySuccess(order.id);
      } catch {
        console.error(
          "[health-recovery-notification]",
          "notification_pending",
        );
      }
    }
    return {
      healthy: persistedHealthResult.healthy,
      delivered: persistedHealthResult.delivered,
      finalizeOnly: true as const,
    };
  }
  if (isManualRecovery) {
    if (
      order.productFlowState === "ACTIVE" ||
      order.productFlowState === "DELIVERED" ||
      order.productFlowState === "DELIVERY_RETRYABLE"
    ) {
      let finalizePending = false;
      try {
        await finalizeHealthRetryJob({
          jobId: job.id,
          workerFence,
          healthy: true,
          beforeFinalize: options.beforeFinalizeJob,
        });
      } catch (error) {
        finalizePending = true;
        if (!isWorkerLeaseLostError(error)) {
          console.error("[health-recovery-finalize]", "finalize_pending");
        }
      }
      if (!finalizePending) {
        try {
          await options.beforeResultAudit?.();
          await recordManualRecoveryResult(job, {
            healthy: true,
            delivered: order.productFlowState === "ACTIVE",
            resultCode:
              order.productFlowState === "ACTIVE"
                ? "service_active"
                : "secure_delivery_pending",
          });
        } catch {
          console.error("[health-recovery-audit]", "audit_pending");
        }
        try {
          await options.beforeSuccessNotification?.();
          await notifyManualRecoverySuccess(order.id);
        } catch {
          console.error(
            "[health-recovery-notification]",
            "notification_pending",
          );
        }
      }
      return {
        healthy: true as const,
        delivered: order.productFlowState === "ACTIVE",
        finalizePending,
      };
    }
    if (
      order.status !== InfrastructureOrderStatus.MANUAL_REVIEW ||
      order.productFlowState !==
        "PROVISIONING_MANUAL_REVIEW"
    ) {
      throw new Error("manual_recovery_state_conflict");
    }
  }

  const metadata = asRecord(job.jobMetadata);
  const actorUserId =
    typeof metadata.actorUserId === "string"
      ? metadata.actorUserId
      : typeof metadata.manualActorUserId === "string"
        ? metadata.manualActorUserId
        : null;
  let fetched: Awaited<
    ReturnType<typeof fetchLockedProviderObservation>
  >;
  try {
    fetched = await fetchLockedProviderObservation(
      order.id,
      providerOverride,
    );
    await persistProviderObservation({
      cloudInstanceId: instance.id,
      providerInstanceId: instance.providerInstanceId,
      observation: fetched.observation,
      workerFence,
    });
  } catch (error) {
    if (isWorkerLeaseLostError(error)) return null;
    await ensureHealthFailureIsRecoverable({
      infrastructureOrderId: order.id,
      jobId: job.id,
      attempt: job.attempt,
      isManualRecovery,
      actorUserId,
      workerFence,
      resultCode: "provider_reconciliation_failed",
    });
    try {
      await finalizeHealthRetryJob({
        jobId: job.id,
        workerFence,
        healthy: false,
      });
    } catch (finalizeError) {
      if (isWorkerLeaseLostError(finalizeError)) return null;
      throw finalizeError;
    }
    if (!isManualRecovery) {
      await scheduleAutomaticHealthRetry({
        infrastructureOrderId: order.id,
        sourceCheckId: job.id,
      });
    }
    return { healthy: false as const, delivered: false as const };
  }

  let result: {
    healthy: boolean;
    delivered: boolean;
  };
  let manualFailureHandled = false;
  try {
    result = await runInfrastructureHealthCheck({
      infrastructureOrderId: order.id,
      probe: options?.healthProbe,
      workerFence,
      durableJob: {
        jobId: job.id,
        workerFence,
      },
      afterTransition: options?.afterHealthTransition,
      retryTransition: {
        idempotencyKey: `health-retry-start:${job.id}`,
        actorUserId,
        from: isManualRecovery
          ? "PROVISIONING_MANUAL_REVIEW"
          : "HEALTH_CHECK_FAILED",
        reason: isManualRecovery
          ? "manual_health_recovery_after_provider_review"
          : "health_check_retry",
      },
    });
  } catch (error) {
    if (isWorkerLeaseLostError(error)) return null;
    const persisted = await prisma.provisioningJob.findUnique({
      where: { id: job.id },
      select: { healthResultSnapshot: true },
    });
    const durableFailure = parseDurableHealthResult(
      persisted?.healthResultSnapshot,
    );
    await ensureHealthFailureIsRecoverable({
      infrastructureOrderId: order.id,
      jobId: job.id,
      attempt: job.attempt,
      isManualRecovery,
      actorUserId,
      workerFence,
      resultCode: "health_execution_failed",
    });
    manualFailureHandled = isManualRecovery;
    result = durableFailure ?? {
      healthy: false,
      delivered: false,
    };
  }

  if (
    !result.healthy &&
    isManualRecovery &&
    !manualFailureHandled
  ) {
    try {
      await recordManualRecoveryResult(
        job,
        {
          ...result,
          resultCode: "health_check_failed",
        },
        workerFence,
        options.beforeResultAudit,
      );
    } catch (error) {
      if (isWorkerLeaseLostError(error)) return null;
      const current =
        await prisma.infrastructureOrder.findUniqueOrThrow({
          where: { id: order.id },
          select: { productFlowState: true },
        });
      if (
        current.productFlowState !==
        "PROVISIONING_MANUAL_REVIEW"
      ) {
        throw error;
      }
    }
  }

  try {
    await finalizeHealthRetryJob({
      jobId: job.id,
      workerFence,
      healthy: result.healthy,
      beforeFinalize: options.beforeFinalizeJob,
    });
  } catch (error) {
    if (isWorkerLeaseLostError(error)) return null;
    console.error("[health-retry-finalize]", "finalize_pending");
    return {
      ...result,
      finalizePending: true as const,
    };
  }

  if (!result.healthy) {
    if (!isManualRecovery) {
      try {
        await scheduleAutomaticHealthRetry({
          infrastructureOrderId: order.id,
          sourceCheckId: job.id,
        });
      } catch {
        console.error(
          "[health-retry-schedule]",
          "schedule_pending",
        );
      }
    }
  } else if (isManualRecovery) {
    try {
      await options.beforeResultAudit?.();
      await recordManualRecoveryResult(job, {
        ...result,
        resultCode: result.delivered
          ? "service_active"
          : "secure_delivery_pending",
      });
    } catch {
      console.error("[health-recovery-audit]", "audit_pending");
    }
    try {
      await options.beforeSuccessNotification?.();
      await notifyManualRecoverySuccess(order.id);
    } catch {
      console.error(
        "[health-recovery-notification]",
        "notification_pending",
      );
    }
  }
  return result;
}
