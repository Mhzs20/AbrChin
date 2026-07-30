import {
  CloudInstanceStatus,
  InfrastructureOrderStatus,
  ProvisioningJobStatus,
} from "@prisma/client";

import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { createCloudProviderAdapter } from "@/lib/infrastructure/provider-factory";
import {
  buildDesiredInstanceName,
  parseLockedProvisioningSelection,
} from "@/lib/infrastructure/provisioning-service";
import { transitionProductFlowTx } from "@/lib/product-flow/service";
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
    await tx.$queryRaw`SELECT id FROM "InfrastructureOrder" WHERE id = ${params.infrastructureOrderId} FOR UPDATE`;
    const order = await tx.infrastructureOrder.findUnique({
      where: { id: params.infrastructureOrderId },
      include: {
        cloudInstance: true,
        serviceOrder: { include: { recommendationQuote: true } },
        provisioningJobs: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!order) throw new WalletError("not_found", "سفارش زیرساخت پیدا نشد.");
    if (order.status !== InfrastructureOrderStatus.NEEDS_RECONCILIATION) {
      throw new WalletError("invalid_status", "این سفارش در وضعیت تطبیق نیست.");
    }

    const desiredName = order.desiredInstanceName ?? buildDesiredInstanceName(order.id);
    const locked = parseLockedProvisioningSelection({
      snapshot: order.providerSelectionSnapshot,
      provider: order.provider,
      providerApiVersion: order.providerApiVersion,
      productKind: order.productKind,
    });
    const provider = createCloudProviderAdapter(
      order.provider,
      order.providerApiVersion,
    );
    const providerInstanceId =
      order.cloudInstance?.providerInstanceId ??
      order.provisioningJobs.find((job) => job.providerResourceId)
        ?.providerResourceId ??
      null;

    const instance = await provider.findExistingResource({
      region: locked.region,
      orderPublicId: order.id,
      expectedName: desiredName,
      providerResourceId: providerInstanceId,
    });

    if (!instance) {
      throw new WalletError("not_found", "منبعی در Provider پیدا نشد. ابتدا «منبع ساخته نشده» را تأیید کنید.");
    }

    if (!order.cloudInstance) {
      await tx.cloudInstance.create({
        data: {
          infrastructureOrderId: order.id,
          userId: order.userId,
          provider: order.provider,
          providerApiVersion: order.providerApiVersion,
          providerInstanceId: instance.id,
          name: instance.name,
          region: instance.region,
          size: locked.externalPlanId,
          image: locked.externalImageId,
          deliveryMode: order.deliveryMode,
          ipv4: instance.ipv4,
          providerState: instance.state,
          networkId:
            instance.networkIds?.includes(locked.externalNetworkId)
              ? locked.externalNetworkId
              : instance.networkIds?.[0] ?? null,
          securityId:
            instance.securityIds?.includes(locked.externalSecurityId)
              ? locked.externalSecurityId
              : instance.securityIds?.[0] ?? null,
          providerObservedAt: instance.observedAt,
          status: CloudInstanceStatus.PENDING,
        },
      });
    }

    const attempt = order.provisioningJobs[0]?.attempt ?? 1;
    const idempotencyKey = `provider_poll_${order.id}_a${attempt}`;
    let job = await tx.provisioningJob.findUnique({ where: { idempotencyKey } });
    if (!job) {
      job = await tx.provisioningJob.create({
        data: {
          infrastructureOrderId: order.id,
          operation: "poll_instance",
          status: ProvisioningJobStatus.QUEUED,
          idempotencyKey,
          attempt,
          providerResourceId: instance.id,
        },
      });
    }

    await tx.infrastructureOrder.update({
      where: { id: order.id },
      data: { status: InfrastructureOrderStatus.PROVISIONING, desiredInstanceName: desiredName },
    });
    await transitionProductFlowTx(tx, {
      owner: {
        recommendationSessionId:
          order.serviceOrder.recommendationQuote?.sessionId ?? null,
        serviceOrderId: order.serviceOrderId,
        infrastructureOrderId: order.id,
      },
      from: "PROVISIONING_RECONCILING",
      to: "PROVISIONING",
      reason: "provider_resource_reconciled",
      idempotencyKey: `provider-resource-reconciled:${order.id}:${instance.id}`,
      actorUserId: params.adminUserId,
    });

    await writeAuditLog(
      {
        actorUserId: params.adminUserId,
        action: AuditActions.RECONCILIATION,
        entityType: "infrastructure_order",
        entityId: order.id,
        afterData: { reason: params.reason, providerInstanceId: instance.id },
        ip: params.ip,
        userAgent: params.userAgent,
      },
      tx,
    );

    return { order, job, instance };
  });
}

export async function confirmNoProviderResource(params: {
  infrastructureOrderId: string;
  adminUserId: string;
  reason: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "InfrastructureOrder" WHERE id = ${params.infrastructureOrderId} FOR UPDATE`;
    const order = await tx.infrastructureOrder.findUnique({
      where: { id: params.infrastructureOrderId },
      include: {
        cloudInstance: true,
        serviceOrder: { include: { recommendationQuote: true } },
      },
    });
    if (!order) throw new WalletError("not_found", "سفارش زیرساخت پیدا نشد.");
    if (order.status !== InfrastructureOrderStatus.NEEDS_RECONCILIATION) {
      throw new WalletError("invalid_status", "فقط سفارش‌های نیازمند تطبیق قابل تأیید هستند.");
    }
    if (order.cloudInstance) {
      throw new WalletError("invalid_status", "منبع محلی وجود دارد.");
    }

    const desiredName = order.desiredInstanceName ?? buildDesiredInstanceName(order.id);
    const locked = parseLockedProvisioningSelection({
      snapshot: order.providerSelectionSnapshot,
      provider: order.provider,
      providerApiVersion: order.providerApiVersion,
      productKind: order.productKind,
    });
    const provider = createCloudProviderAdapter(
      order.provider,
      order.providerApiVersion,
    );
    const found = await provider.findExistingResource({
      region: locked.region,
      orderPublicId: order.id,
      expectedName: desiredName,
    });
    if (found) {
      throw new WalletError("invalid_status", "منبع در Provider پیدا شد؛ از تطبیق استفاده کنید.");
    }

    await tx.infrastructureOrder.update({
      where: { id: order.id },
      data: {
        reconcileNoResourceConfirmedAt: new Date(),
        status: InfrastructureOrderStatus.FAILED,
      },
    });
    await transitionProductFlowTx(tx, {
      owner: {
        recommendationSessionId:
          order.serviceOrder.recommendationQuote?.sessionId ?? null,
        serviceOrderId: order.serviceOrderId,
        infrastructureOrderId: order.id,
      },
      from: "PROVISIONING_RECONCILING",
      to: "PROVISIONING_RETRYABLE",
      reason: "provider_absence_manually_confirmed",
      idempotencyKey: `provider-absence-confirmed:${order.id}`,
      actorUserId: params.adminUserId,
    });

    await writeAuditLog(
      {
        actorUserId: params.adminUserId,
        action: AuditActions.RECONCILIATION,
        entityType: "infrastructure_order",
        entityId: order.id,
        afterData: { reason: params.reason, noResourceConfirmed: true },
        ip: params.ip,
        userAgent: params.userAgent,
      },
      tx,
    );

    return order;
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
    await tx.$queryRaw`SELECT id FROM "InfrastructureOrder" WHERE id = ${params.infrastructureOrderId} FOR UPDATE`;
    const order = await tx.infrastructureOrder.findUnique({
      where: { id: params.infrastructureOrderId },
      include: {
        cloudInstance: true,
        serviceOrder: { include: { recommendationQuote: true } },
        provisioningJobs: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!order) throw new WalletError("not_found", "سفارش زیرساخت پیدا نشد.");

    if (order.status === InfrastructureOrderStatus.NEEDS_RECONCILIATION) {
      throw new WalletError("invalid_status", "ابتدا تطبیق دستی انجام دهید.");
    }

    if (
      order.cloudInstance ||
      order.provisioningJobs.some(
        (job) => job.providerResourceId || job.providerTaskId,
      )
    ) {
      throw new WalletError("invalid_status", "منبع Provider از قبل وجود دارد؛ Retry مجاز نیست.");
    }

    if (order.status !== InfrastructureOrderStatus.FAILED) {
      throw new WalletError("invalid_status", "فقط سفارش‌های ناموفق قابل Retry هستند.");
    }

    if (!order.reconcileNoResourceConfirmedAt && order.provisioningJobs.some((job) => job.createSentAt)) {
      throw new WalletError("invalid_status", "پس از ارسال Create، ابتدا وضعیت منبع را مشخص کنید.");
    }

    const activeCreate = order.provisioningJobs.find(
      (job) => job.operation === "create_instance" && ACTIVE_JOB_STATUSES.includes(job.status),
    );
    if (activeCreate) {
      throw new WalletError("invalid_status", "Job فعال در حال اجراست.");
    }

    const lastAttempt = order.provisioningJobs.reduce((max, job) => Math.max(max, job.attempt), 0);
    const nextAttempt = Math.max(lastAttempt, 0) + 1;
    const idempotencyKey = `provider_create_${order.id}_a${nextAttempt}`;

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
    await transitionProductFlowTx(tx, {
      owner: {
        recommendationSessionId:
          order.serviceOrder.recommendationQuote?.sessionId ?? null,
        serviceOrderId: order.serviceOrderId,
        infrastructureOrderId: order.id,
      },
      from: "PROVISIONING_RETRYABLE",
      to: "PROVISIONING_SUBMITTED",
      reason: "admin_approved_provisioning_retry",
      idempotencyKey: `provider-retry-submitted:${order.id}:${nextAttempt}`,
      actorUserId: params.adminUserId,
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
