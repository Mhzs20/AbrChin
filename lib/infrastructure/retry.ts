import {
  CloudInstanceStatus,
  InfrastructureOrderStatus,
  ProvisioningJobStatus,
} from "@prisma/client";

import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { createCloudProviderAdapter } from "@/lib/infrastructure/provider-factory";
import type { CloudProviderAdapter } from "@/lib/infrastructure/cloud-provider-adapter";
import {
  absenceAuditMatchesAttempt,
  assessRefundResourceSafety,
  latestCreateAttempt,
} from "@/lib/infrastructure/resource-disposition";
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
}, providerOverride?: CloudProviderAdapter) {
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
    const reconciling =
      order.status === InfrastructureOrderStatus.NEEDS_RECONCILIATION &&
      order.productFlowState === "PROVISIONING_RECONCILING";
    const manualWithoutInstance =
      !order.cloudInstance &&
      (order.status === InfrastructureOrderStatus.FAILED ||
        order.status === InfrastructureOrderStatus.MANUAL_REVIEW) &&
      order.productFlowState === "PROVISIONING_MANUAL_REVIEW";
    if (!reconciling && !manualWithoutInstance) {
      throw new WalletError("invalid_status", "این سفارش در وضعیت تطبیق نیست.");
    }

    const desiredName = order.desiredInstanceName ?? buildDesiredInstanceName(order.id);
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
            locked.topologyVerificationMode === "STRICT_OBSERVED" &&
            locked.externalNetworkId &&
            instance.networkIds?.includes(locked.externalNetworkId)
              ? locked.externalNetworkId
              : locked.topologyVerificationMode === "STRICT_OBSERVED"
                ? instance.networkIds?.[0] ?? null
                : null,
          securityId:
            locked.topologyVerificationMode === "STRICT_OBSERVED" &&
            locked.externalSecurityId &&
            instance.securityIds?.includes(locked.externalSecurityId)
              ? locked.externalSecurityId
              : locked.topologyVerificationMode === "STRICT_OBSERVED"
                ? instance.securityIds?.[0] ?? null
                : null,
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
    const flowOwner = {
      recommendationSessionId:
        order.serviceOrder.recommendationQuote?.sessionId ?? null,
      serviceOrderId: order.serviceOrderId,
      infrastructureOrderId: order.id,
    };
    if (manualWithoutInstance) {
      await transitionProductFlowTx(tx, {
        owner: flowOwner,
        from: "PROVISIONING_MANUAL_REVIEW",
        to: "PROVISIONING_RECONCILING",
        reason: "manual_review_resource_found",
        idempotencyKey:
          `manual-resource-found:${order.id}:${instance.id}`,
        actorUserId: params.adminUserId,
      });
    }
    await transitionProductFlowTx(tx, {
      owner: flowOwner,
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
}, providerOverride?: CloudProviderAdapter) {
  const reason = params.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new WalletError(
      "invalid_reason",
      "دلیل تأیید باید بین ۳ تا ۵۰۰ کاراکتر باشد.",
    );
  }
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "InfrastructureOrder" WHERE id = ${params.infrastructureOrderId} FOR UPDATE`;
    const order = await tx.infrastructureOrder.findUnique({
      where: { id: params.infrastructureOrderId },
      include: {
        cloudInstance: true,
        serviceOrder: { include: { recommendationQuote: true } },
        provisioningJobs: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!order) throw new WalletError("not_found", "سفارش زیرساخت پیدا نشد.");
    const reconciling =
      order.status === InfrastructureOrderStatus.NEEDS_RECONCILIATION &&
      order.productFlowState === "PROVISIONING_RECONCILING";
    const manualWithoutInstance =
      !order.cloudInstance &&
      (order.status === InfrastructureOrderStatus.FAILED ||
        order.status === InfrastructureOrderStatus.MANUAL_REVIEW) &&
      order.productFlowState === "PROVISIONING_MANUAL_REVIEW";
    if (!reconciling && !manualWithoutInstance) {
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
    const createAttempt = latestCreateAttempt(order.provisioningJobs);
    if (!createAttempt) {
      throw new WalletError(
        "invalid_status",
        "هیچ Attempt ساختی ثبت نشده و سفارش بدون Reconciliation قابل لغو امن است.",
      );
    }
    const provider =
      providerOverride ??
      createCloudProviderAdapter(
        order.provider,
        order.providerApiVersion,
      );
    const found = await provider.findExistingResource({
      region: locked.region,
      orderPublicId: order.id,
      expectedName: desiredName,
      providerResourceId:
        createAttempt.providerResourceId ?? undefined,
    });
    if (found) {
      throw new WalletError("invalid_status", "منبع در Provider پیدا شد؛ از تطبیق استفاده کنید.");
    }

    await tx.infrastructureOrder.update({
      where: { id: order.id },
      data: {
        reconcileNoResourceConfirmedAt: new Date(),
        reconcileNoResourceConfirmedJobId: createAttempt.id,
        reconcileNoResourceConfirmedAttempt: createAttempt.attempt,
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
      from: manualWithoutInstance
        ? "PROVISIONING_MANUAL_REVIEW"
        : "PROVISIONING_RECONCILING",
      to: "PROVISIONING_RETRYABLE",
      reason: "provider_absence_manually_confirmed",
      idempotencyKey:
        `provider-absence-flow:${order.id}:${createAttempt.id}:${createAttempt.attempt}`,
      actorUserId: params.adminUserId,
    });

    await writeAuditLog(
      {
        actorUserId: params.adminUserId,
        action: AuditActions.RECONCILIATION,
        entityType: "infrastructure_order",
        entityId: order.id,
        afterData: {
          reason,
          noResourceConfirmed: true,
          provisioningJobId: createAttempt.id,
          attempt: createAttempt.attempt,
          providerObservation: "NOT_FOUND",
          containsSecret: false,
        },
        ip: params.ip,
        userAgent: params.userAgent,
        idempotencyKey:
          `provider-absence-confirmed:${order.id}:${createAttempt.id}:${createAttempt.attempt}`,
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
      order.cloudInstance
    ) {
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
    const absenceAuditKey =
      order.reconcileNoResourceConfirmedJobId &&
      order.reconcileNoResourceConfirmedAttempt != null
        ? `provider-absence-confirmed:${order.id}:${order.reconcileNoResourceConfirmedJobId}:${order.reconcileNoResourceConfirmedAttempt}`
        : null;
    const absenceAudit = absenceAuditKey
      ? await tx.auditLog.findUnique({
          where: { idempotencyKey: absenceAuditKey },
        })
      : null;
    const resourceSafety = assessRefundResourceSafety({
      jobs: order.provisioningJobs,
      cloudInstance: null,
      reconcileNoResourceConfirmedAt:
        order.reconcileNoResourceConfirmedAt,
      reconcileNoResourceConfirmedJobId:
        order.reconcileNoResourceConfirmedJobId,
      reconcileNoResourceConfirmedAttempt:
        order.reconcileNoResourceConfirmedAttempt,
      absenceAuditMatches: absenceAuditMatchesAttempt({
        audit: absenceAudit,
        infrastructureOrderId: order.id,
        provisioningJobId:
          order.reconcileNoResourceConfirmedJobId,
        attempt: order.reconcileNoResourceConfirmedAttempt,
      }),
    });
    if (!resourceSafety.safe) {
      throw new WalletError(
        "invalid_status",
        "پیش از Retry باید نبود Resource برای آخرین Attempt قطعی و Audit شود.",
      );
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
      data: {
        status: InfrastructureOrderStatus.QUEUED,
        reconcileNoResourceConfirmedAt: null,
        reconcileNoResourceConfirmedJobId: null,
        reconcileNoResourceConfirmedAttempt: null,
      },
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
