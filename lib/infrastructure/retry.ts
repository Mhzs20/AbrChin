import {
  InfrastructureOrderStatus,
  ProvisioningJobStatus,
} from "@prisma/client";

import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { WalletError } from "@/lib/wallet/errors";

const ACTIVE_JOB_STATUSES: ProvisioningJobStatus[] = [
  ProvisioningJobStatus.QUEUED,
  ProvisioningJobStatus.RUNNING,
];

export async function reconcileInfrastructureOrder(params: {
  infrastructureOrderId: string;
  adminUserId: string;
  reason: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.infrastructureOrder.findUnique({
      where: { id: params.infrastructureOrderId },
      include: { cloudInstance: true, provisioningJobs: true },
    });
    if (!order) throw new WalletError("not_found", "سفارش زیرساخت پیدا نشد.");
    if (order.status !== InfrastructureOrderStatus.NEEDS_RECONCILIATION) {
      throw new WalletError("invalid_status", "این سفارش در وضعیت تطبیق نیست.");
    }

    const providerInstanceId =
      order.cloudInstance?.providerInstanceId ??
      order.provisioningJobs.find((job) => job.providerRequestId)?.providerRequestId ??
      null;

    if (!providerInstanceId && !order.cloudInstance) {
      throw new WalletError("invalid_status", "منبعی برای تطبیق پیدا نشد.");
    }

    await tx.infrastructureOrder.update({
      where: { id: order.id },
      data: {
        status: providerInstanceId
          ? InfrastructureOrderStatus.PROVISIONING
          : InfrastructureOrderStatus.FAILED,
      },
    });

    await writeAuditLog(
      {
        actorUserId: params.adminUserId,
        action: AuditActions.RECONCILIATION,
        entityType: "infrastructure_order",
        entityId: order.id,
        afterData: { reason: params.reason, providerInstanceId },
        ip: params.ip,
        userAgent: params.userAgent,
      },
      tx,
    );

    return tx.infrastructureOrder.findUniqueOrThrow({ where: { id: order.id } });
  });
}

export async function retryFailedProvisioning(params: {
  infrastructureOrderId: string;
  adminUserId: string;
  reason: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  if (params.reason.trim().length < 3) {
    throw new WalletError("invalid_reason", "دلیل Retry الزامی است.");
  }

  return prisma.$transaction(async (tx) => {
    const order = await tx.infrastructureOrder.findUnique({
      where: { id: params.infrastructureOrderId },
      include: { cloudInstance: true, provisioningJobs: { orderBy: { createdAt: "desc" } } },
    });
    if (!order) throw new WalletError("not_found", "سفارش زیرساخت پیدا نشد.");

    if (order.status === InfrastructureOrderStatus.NEEDS_RECONCILIATION) {
      throw new WalletError("invalid_status", "ابتدا تطبیق دستی انجام دهید.");
    }

    if (order.cloudInstance || order.provisioningJobs.some((job) => job.providerRequestId)) {
      throw new WalletError("invalid_status", "منبع Provider از قبل وجود دارد؛ Retry مجاز نیست.");
    }

    if (order.status !== InfrastructureOrderStatus.FAILED) {
      throw new WalletError("invalid_status", "فقط سفارش‌های ناموفق قابل Retry هستند.");
    }

    const activeCreate = order.provisioningJobs.find(
      (job) => job.operation === "create_instance" && ACTIVE_JOB_STATUSES.includes(job.status),
    );
    if (activeCreate) {
      throw new WalletError("invalid_status", "Job فعال در حال اجراست.");
    }

    const lastAttempt = order.provisioningJobs.reduce((max, job) => Math.max(max, job.attempt), 0);
    const nextAttempt = lastAttempt + 1;
    const idempotencyKey = `parspack_create_${order.id}_a${nextAttempt}`;

    const existing = await tx.provisioningJob.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return { order, job: existing };
    }

    const job = await tx.provisioningJob.create({
      data: {
        infrastructureOrderId: order.id,
        operation: "create_instance",
        status: ProvisioningJobStatus.QUEUED,
        idempotencyKey,
        attempt: nextAttempt,
      },
    });

    await tx.infrastructureOrder.update({
      where: { id: order.id },
      data: { status: InfrastructureOrderStatus.QUEUED },
    });

    await writeAuditLog(
      {
        actorUserId: params.adminUserId,
        action: AuditActions.PROVISIONING_RETRY,
        entityType: "infrastructure_order",
        entityId: order.id,
        afterData: { reason: params.reason, attempt: nextAttempt, jobId: job.id },
        ip: params.ip,
        userAgent: params.userAgent,
      },
      tx,
    );

    return { order, job };
  });
}
