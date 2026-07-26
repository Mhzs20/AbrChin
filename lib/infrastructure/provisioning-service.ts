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
import {
  customerSafeProviderMessage,
  InfrastructureError,
  isAmbiguousProviderError,
  isInsufficientBalanceError,
} from "@/lib/infrastructure/errors";
import { createInfrastructureProvider } from "@/lib/infrastructure/provider-factory";
import type { InfrastructureProviderAdapter } from "@/lib/infrastructure/types";
import { getWorkerConfig } from "@/lib/worker/config";

const POLL_ATTEMPTS = 8;
const POLL_DELAY_MS = 2000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildDesiredInstanceName(infrastructureOrderId: string) {
  return `abrchin-${infrastructureOrderId.slice(-12)}`;
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
      job.providerRequestId || job.infrastructureOrder.cloudInstance?.providerInstanceId,
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

    const job = await tx.provisioningJob.findUniqueOrThrow({ where: { id: row.id } });
    await tx.infrastructureOrder.updateMany({
      where: { id: job.infrastructureOrderId, status: InfrastructureOrderStatus.QUEUED },
      data: { status: InfrastructureOrderStatus.PROVISIONING },
    });

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

async function resolveExistingProviderInstance(
  order: {
    id: string;
    desiredInstanceName: string | null;
    provider: InfrastructureProvider;
    cloudInstance: { providerInstanceId: string } | null;
    provisioningJobs: Array<{ providerRequestId: string | null }>;
  },
  provider: InfrastructureProviderAdapter,
) {
  const providerInstanceId =
    order.cloudInstance?.providerInstanceId ??
    order.provisioningJobs.find((job) => job.providerRequestId)?.providerRequestId ??
    null;
  if (providerInstanceId) {
    return provider.getInstance(providerInstanceId);
  }
  if (order.desiredInstanceName) {
    return provider.findInstanceByName(order.desiredInstanceName);
  }
  return null;
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
  else if (row.lastCycleAt) status = "healthy";
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
  providerOverride?: InfrastructureProviderAdapter,
) {
  const job = await prisma.provisioningJob.findUnique({
    where: { id: jobId },
    include: {
      infrastructureOrder: {
        include: { plan: true, serviceOrder: true, cloudInstance: true, provisioningJobs: true },
      },
    },
  });
  if (!job || job.status !== ProvisioningJobStatus.RUNNING) return;

  const order = job.infrastructureOrder;
  if (order.cloudInstance?.status === CloudInstanceStatus.ACTIVE) {
    await prisma.provisioningJob.update({
      where: { id: job.id },
      data: { status: ProvisioningJobStatus.SUCCEEDED, finishedAt: new Date() },
    });
    return;
  }

  const provider = providerOverride ?? createInfrastructureProvider();

  if (!order.desiredInstanceName) {
    const desiredName = buildDesiredInstanceName(order.id);
    await prisma.infrastructureOrder.update({
      where: { id: order.id },
      data: { desiredInstanceName: desiredName },
    });
    order.desiredInstanceName = desiredName;
  }

  try {
    const existingInstance = await resolveExistingProviderInstance(order, provider);
    if (existingInstance) {
      if (!order.cloudInstance) {
        await prisma.cloudInstance.create({
          data: {
            infrastructureOrderId: order.id,
            userId: order.userId,
            provider: order.provider,
            providerInstanceId: existingInstance.id,
            name: existingInstance.name,
            region: existingInstance.region,
            size: existingInstance.size,
            image: existingInstance.image,
            deliveryMode: order.deliveryMode,
            ipv4: existingInstance.ipv4,
            status: CloudInstanceStatus.PENDING,
          },
        });
      }
      await prisma.provisioningJob.update({
        where: { id: job.id },
        data: { providerRequestId: existingInstance.id },
      });
    }

    let providerInstanceId = job.providerRequestId ?? order.cloudInstance?.providerInstanceId ?? null;
    let created = existingInstance;

    if (!providerInstanceId) {
      const createInput = {
        name: order.desiredInstanceName,
        region: order.plan.regionCode,
        size: order.plan.sizeCode,
        image: order.plan.imageCode,
        deliveryMode: order.deliveryMode,
      };

      await prisma.provisioningJob.update({
        where: { id: job.id },
        data: { createSentAt: new Date() },
      });

      created = await provider.createInstance(createInput);
      providerInstanceId = created.id;

      await logProviderOperation({
        provider: order.provider,
        operation: "create_instance",
        infrastructureOrderId: order.id,
        provisioningJobId: job.id,
        status: "success",
        requestSummary: createInput,
        responseSummary: { id: created.id, status: created.status },
      });

      await prisma.provisioningJob.update({
        where: { id: job.id },
        data: { providerRequestId: created.id },
      });

      if (!order.cloudInstance) {
        await prisma.cloudInstance.create({
          data: {
            infrastructureOrderId: order.id,
            userId: order.userId,
            provider: order.provider,
            providerInstanceId: created.id,
            name: created.name,
            region: created.region,
            size: created.size,
            image: created.image,
            deliveryMode: order.deliveryMode,
            ipv4: created.ipv4,
            status: CloudInstanceStatus.PENDING,
          },
        });
      }
    }

    let final = created ?? (await provider.getInstance(providerInstanceId!));
    for (let poll = 0; poll < POLL_ATTEMPTS; poll += 1) {
      await sleep(POLL_DELAY_MS);
      final = await provider.getInstance(providerInstanceId!);
      if (final.status.toLowerCase() === "active" && final.ipv4) break;
    }

    await logProviderOperation({
      provider: order.provider,
      operation: "get_instance",
      infrastructureOrderId: order.id,
      provisioningJobId: job.id,
      status: "success",
      responseSummary: { id: final.id, status: final.status, ipv4: final.ipv4 },
    });

    const isActive = final.status.toLowerCase() === "active" || Boolean(final.ipv4);
    if (!isActive) {
      throw new InfrastructureError("provider_ambiguous", "Instance state ambiguous");
    }

    await prisma.$transaction([
      prisma.cloudInstance.updateMany({
        where: { infrastructureOrderId: order.id },
        data: {
          ipv4: final.ipv4,
          status: CloudInstanceStatus.ACTIVE,
          provisionedAt: new Date(),
        },
      }),
      prisma.infrastructureOrder.update({
        where: { id: order.id },
        data: { status: InfrastructureOrderStatus.ACTIVE },
      }),
      prisma.provisioningJob.update({
        where: { id: job.id },
        data: {
          status: ProvisioningJobStatus.SUCCEEDED,
          finishedAt: new Date(),
          workerId: null,
          lockedAt: null,
          leaseExpiresAt: null,
        },
      }),
    ]);

    await createAdminNotification({
      type: AdminNotificationType.INSTANCE_ACTIVE,
      infrastructureOrderId: order.id,
      title: "سرور فعال شد",
      message: `سرور سفارش ${order.serviceOrder.title} آماده است.`,
    });
  } catch (error) {
    const errorCode = error instanceof InfrastructureError ? error.code : "provider_unavailable";
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
      return;
    }

    if (isAmbiguousProviderError(error) || job.createSentAt) {
      await prisma.$transaction([
        prisma.provisioningJob.update({
          where: { id: job.id },
          data: {
            status: ProvisioningJobStatus.NEEDS_RECONCILIATION,
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
          data: { status: InfrastructureOrderStatus.NEEDS_RECONCILIATION },
        }),
      ]);
      await createAdminNotification({
        type: AdminNotificationType.NEEDS_RECONCILIATION,
        infrastructureOrderId: order.id,
        title: "نیاز به تطبیق",
        message: "وضعیت ساخت سرور مبهم است و نیاز به بررسی دستی دارد.",
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
  providerOverride?: InfrastructureProviderAdapter,
  workerId?: string,
) {
  const job = await claimNextProvisioningJob(workerId);
  if (!job) return false;
  await processProvisioningJob(job.id, providerOverride);
  return true;
}
