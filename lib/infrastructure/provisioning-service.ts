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

const POLL_ATTEMPTS = 8;
const POLL_DELAY_MS = 2000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export async function claimNextProvisioningJob() {
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
        startedAt: new Date(),
        attempt: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return null;

    await tx.infrastructureOrder.updateMany({
      where: { id: (await tx.provisioningJob.findUniqueOrThrow({ where: { id: row.id } })).infrastructureOrderId, status: InfrastructureOrderStatus.QUEUED },
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
  if (!providerInstanceId) return null;
  return provider.getInstance(providerInstanceId);
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
        name: `abrchin-${order.id.slice(-8)}`,
        region: order.plan.regionCode,
        size: order.plan.sizeCode,
        image: order.plan.imageCode,
        deliveryMode: order.deliveryMode,
      };

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
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
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
        data: { status: ProvisioningJobStatus.SUCCEEDED, finishedAt: new Date() },
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

    if (isAmbiguousProviderError(error)) {
      await prisma.$transaction([
        prisma.provisioningJob.update({
          where: { id: job.id },
          data: {
            status: ProvisioningJobStatus.NEEDS_RECONCILIATION,
            lastErrorCode: errorCode,
            lastErrorMessage: errorMessage,
            finishedAt: new Date(),
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

export async function runProvisioningWorkerCycle(providerOverride?: InfrastructureProviderAdapter) {
  const job = await claimNextProvisioningJob();
  if (!job) return false;
  await processProvisioningJob(job.id, providerOverride);
  return true;
}
