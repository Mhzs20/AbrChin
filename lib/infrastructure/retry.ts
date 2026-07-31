import {
  CloudInstanceStatus,
  InfrastructureOrderStatus,
  ProvisioningJobStatus,
} from "@prisma/client";

import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import {
  assertAdminActorTx,
  normalizeAdminCommand,
  persistAdminCommandReceiptTx,
  replayAdminCommandTx,
} from "@/lib/admin/command-receipt";
import { prisma } from "@/lib/db";
import { createCloudProviderAdapter } from "@/lib/infrastructure/provider-factory";
import type { CloudProviderAdapter } from "@/lib/infrastructure/cloud-provider-adapter";
import {
  absenceAuditMatchesAttempt,
  assessRefundResourceSafety,
  latestCreateAttempt,
  loadInfrastructureRecoveryAssessmentTx,
  type InfrastructureRecoveryAction,
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

async function requireAllowedRecoveryActionTx(
  tx: Parameters<typeof loadInfrastructureRecoveryAssessmentTx>[0],
  order: {
    id: string;
    status: InfrastructureOrderStatus;
    productFlowState: string | null;
    reconcileNoResourceConfirmedAt: Date | null;
    reconcileNoResourceConfirmedJobId: string | null;
    reconcileNoResourceConfirmedAttempt: number | null;
    cloudInstance: {
      status: CloudInstanceStatus;
      terminatedAt: Date | null;
    } | null;
    provisioningJobs: Array<{
      id: string;
      operation: string;
      attempt: number;
      status: ProvisioningJobStatus;
      createSentAt: Date | null;
      providerTaskId: string | null;
      providerResourceId: string | null;
      lastErrorCode: string | null;
      createdAt: Date;
    }>;
  },
  action: InfrastructureRecoveryAction,
) {
  const assessment = await loadInfrastructureRecoveryAssessmentTx(
    tx,
    {
      id: order.id,
      status: order.status,
      productFlowState: order.productFlowState,
      provisioningJobs: order.provisioningJobs,
      cloudInstance: order.cloudInstance,
      reconcileNoResourceConfirmedAt:
        order.reconcileNoResourceConfirmedAt,
      reconcileNoResourceConfirmedJobId:
        order.reconcileNoResourceConfirmedJobId,
      reconcileNoResourceConfirmedAttempt:
        order.reconcileNoResourceConfirmedAttempt,
    },
  );
  if (!assessment.allowedActions.includes(action)) {
    throw new WalletError(
      "invalid_status",
      "این عملیات با وضعیت فعلی سفارش مجاز نیست.",
    );
  }
  return assessment;
}

export async function reconcileInfrastructureOrder(params: {
  infrastructureOrderId: string;
  adminUserId: string;
  reason: string;
  idempotencyKey: string;
  ip?: string | null;
  userAgent?: string | null;
}, providerOverride?: CloudProviderAdapter) {
  const command = normalizeAdminCommand({
    operation: "ADMIN_RECONCILE_RESOURCE",
    idempotencyKey: params.idempotencyKey,
    actorUserId: params.adminUserId,
    infrastructureOrderId: params.infrastructureOrderId,
    reason: params.reason,
  });
  return prisma.$transaction(async (tx) => {
    await assertAdminActorTx(tx, params.adminUserId);
    const replay = await replayAdminCommandTx(tx, command);
    if (replay && typeof replay === "object" && !Array.isArray(replay)) {
      const snapshot = replay as Record<string, unknown>;
      const [order, job, instance] = await Promise.all([
        tx.infrastructureOrder.findUniqueOrThrow({
          where: { id: params.infrastructureOrderId },
        }),
        tx.provisioningJob.findUniqueOrThrow({
          where: { id: String(snapshot.jobId) },
        }),
        tx.cloudInstance.findUniqueOrThrow({
          where: { id: String(snapshot.instanceId) },
        }),
      ]);
      return {
        order: { ...order, status: snapshot.orderStatus as InfrastructureOrderStatus },
        job: { ...job, status: snapshot.jobStatus as ProvisioningJobStatus },
        instance,
      };
    }
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
    await requireAllowedRecoveryActionTx(tx, order, "reconcile");
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
        afterData: {
          reason: command.reason,
          providerInstanceId: instance.id,
          requestFingerprint: command.requestFingerprint,
        },
        ip: params.ip,
        userAgent: params.userAgent,
        idempotencyKey: `audit:${command.receiptKey}`,
      },
      tx,
    );

    await persistAdminCommandReceiptTx(tx, command, {
      infrastructureOrderId: order.id,
      orderStatus: InfrastructureOrderStatus.PROVISIONING,
      jobId: job.id,
      jobStatus: job.status,
      instanceId: instance.id,
      providerResourceId: instance.id,
      containsSecret: false,
    });

    const updatedOrder =
      await tx.infrastructureOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
    return { order: updatedOrder, job, instance };
  });
}

export async function confirmNoProviderResource(params: {
  infrastructureOrderId: string;
  adminUserId: string;
  reason: string;
  idempotencyKey: string;
  ip?: string | null;
  userAgent?: string | null;
}, providerOverride?: CloudProviderAdapter) {
  const command = normalizeAdminCommand({
    operation: "ADMIN_CONFIRM_NO_RESOURCE",
    idempotencyKey: params.idempotencyKey,
    actorUserId: params.adminUserId,
    infrastructureOrderId: params.infrastructureOrderId,
    reason: params.reason,
  });
  return prisma.$transaction(async (tx) => {
    await assertAdminActorTx(tx, params.adminUserId);
    const replay = await replayAdminCommandTx(tx, command);
    if (replay && typeof replay === "object" && !Array.isArray(replay)) {
      const snapshot = replay as Record<string, unknown>;
      const persisted = await tx.infrastructureOrder.findUniqueOrThrow({
        where: { id: params.infrastructureOrderId },
      });
      return {
        ...persisted,
        status: snapshot.orderStatus as InfrastructureOrderStatus,
        productFlowState: String(snapshot.productFlowState),
      };
    }
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
    await requireAllowedRecoveryActionTx(
      tx,
      order,
      "confirm-no-resource",
    );
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
          reason: command.reason,
          noResourceConfirmed: true,
          provisioningJobId: createAttempt.id,
          attempt: createAttempt.attempt,
          providerObservation: "NOT_FOUND",
          containsSecret: false,
        },
        ip: params.ip,
        userAgent: params.userAgent,
        idempotencyKey: `provider-absence-confirmed:${order.id}:${createAttempt.id}:${createAttempt.attempt}`,
      },
      tx,
    );

    await persistAdminCommandReceiptTx(tx, command, {
      infrastructureOrderId: order.id,
      orderStatus: InfrastructureOrderStatus.FAILED,
      productFlowState: "PROVISIONING_RETRYABLE",
      provisioningJobId: createAttempt.id,
      attempt: createAttempt.attempt,
      providerObservation: "NOT_FOUND",
      containsSecret: false,
    });

    return tx.infrastructureOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
  });
}

export async function retryFailedProvisioning(params: {
  infrastructureOrderId: string;
  adminUserId: string;
  reason: string;
  idempotencyKey: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const command = normalizeAdminCommand({
    operation: "ADMIN_RETRY_PROVISIONING",
    idempotencyKey: params.idempotencyKey,
    actorUserId: params.adminUserId,
    infrastructureOrderId: params.infrastructureOrderId,
    reason: params.reason,
  });

  return prisma.$transaction(async (tx) => {
    await assertAdminActorTx(tx, params.adminUserId);
    const replay = await replayAdminCommandTx(tx, command);
    if (replay && typeof replay === "object" && !Array.isArray(replay)) {
      const snapshot = replay as Record<string, unknown>;
      const [order, job] = await Promise.all([
        tx.infrastructureOrder.findUniqueOrThrow({
          where: { id: params.infrastructureOrderId },
        }),
        tx.provisioningJob.findUniqueOrThrow({
          where: { id: String(snapshot.jobId) },
        }),
      ]);
      return {
        order: {
          ...order,
          status: snapshot.orderStatus as InfrastructureOrderStatus,
          productFlowState: String(snapshot.productFlowState),
        },
        job: {
          ...job,
          status: snapshot.jobStatus as ProvisioningJobStatus,
          attempt: Number(snapshot.attempt),
        },
      };
    }
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
    await requireAllowedRecoveryActionTx(tx, order, "retry");

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
    parseLockedProvisioningSelection({
      snapshot: order.providerSelectionSnapshot,
      provider: order.provider,
      providerApiVersion: order.providerApiVersion,
      productKind: order.productKind,
    });

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
      from:
        order.productFlowState === "PROVISIONING_MANUAL_REVIEW"
          ? "PROVISIONING_MANUAL_REVIEW"
          : "PROVISIONING_RETRYABLE",
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
        afterData: {
          reason: command.reason,
          attempt: nextAttempt,
          jobId: job.id,
          requestFingerprint: command.requestFingerprint,
        },
        ip: params.ip,
        userAgent: params.userAgent,
        idempotencyKey: `audit:${command.receiptKey}`,
      },
      tx,
    );

    await persistAdminCommandReceiptTx(tx, command, {
      infrastructureOrderId: order.id,
      orderStatus: InfrastructureOrderStatus.QUEUED,
      productFlowState: "PROVISIONING_SUBMITTED",
      jobId: job.id,
      jobStatus: ProvisioningJobStatus.QUEUED,
      attempt: nextAttempt,
      containsSecret: false,
    });

    const updatedOrder =
      await tx.infrastructureOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
    return { order: updatedOrder, job };
  });
}
