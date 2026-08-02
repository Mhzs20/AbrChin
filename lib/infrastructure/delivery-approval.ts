import {
  CloudInstanceStatus,
  InfrastructureHealthCheckStatus,
  InfrastructureOrderStatus,
  InstanceCredentialStatus,
  ServiceOrderStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import {
  assertAdminActorTx,
  normalizeAdminCommand,
  persistAdminCommandReceiptTx,
  replayAdminCommandTx,
} from "@/lib/admin/command-receipt";
import { prisma } from "@/lib/db";
import { activateApprovedDeliveryTx } from "@/lib/infrastructure/health-check-service";
import { parseLockedProvisioningSelection } from "@/lib/infrastructure/provisioning-service";
import { transitionProductFlowTx } from "@/lib/product-flow/service";
import { WalletError } from "@/lib/wallet/errors";

type Db = PrismaClient | Prisma.TransactionClient;

type ReviewIssue = { code: string; message: string };

function owner(order: {
  id: string;
  serviceOrderId: string;
  serviceOrder: { recommendationQuote: { sessionId: string } | null };
}) {
  return {
    recommendationSessionId:
      order.serviceOrder.recommendationQuote?.sessionId ?? null,
    serviceOrderId: order.serviceOrderId,
    infrastructureOrderId: order.id,
  };
}

async function loadDeliveryOrder(db: Db, infrastructureOrderId: string) {
  return db.infrastructureOrder.findUnique({
    where: { id: infrastructureOrderId },
    include: {
      plan: true,
      serviceOrder: { include: { recommendationQuote: true } },
      cloudInstance: {
        include: {
          credential: true,
          healthChecks: { orderBy: { checkedAt: "desc" }, take: 1 },
          secureDeliveryEvents: { orderBy: { createdAt: "desc" }, take: 3 },
        },
      },
    },
  });
}

export type DeliveryApprovalReview = {
  infrastructureOrderId: string;
  serviceOrderId: string;
  provider: { provider: string; source: string; apiVersion: string };
  resource: {
    providerResourceId: string | null;
    ipv4: string | null;
    region: string | null;
    plan: string | null;
    image: string | null;
    powerState: string | null;
    observedAt: string | null;
  };
  expected: {
    region: string | null;
    plan: string | null;
    image: string | null;
    vcpu: number | null;
    ramGb: number | null;
    storageGb: number | null;
    accessMethod: string | null;
  };
  health: {
    status: string | null;
    resultCode: string | null;
    checkedAt: string | null;
  };
  credential: {
    required: boolean;
    status: string | null;
    username: string | null;
    expiresAt: string | null;
  };
  warnings: ReviewIssue[];
  blockingIssues: ReviewIssue[];
  canApprove: boolean;
};

async function buildDeliveryApprovalReview(
  db: Db,
  infrastructureOrderId: string,
): Promise<DeliveryApprovalReview> {
  const order = await loadDeliveryOrder(db, infrastructureOrderId);
  if (!order) throw new WalletError("not_found", "سفارش زیرساخت پیدا نشد.");

  const blockingIssues: ReviewIssue[] = [];
  const warnings: ReviewIssue[] = [];
  const block = (code: string, message: string) => {
    blockingIssues.push({ code, message });
  };
  const warn = (code: string, message: string) => {
    warnings.push({ code, message });
  };
  let selection: ReturnType<typeof parseLockedProvisioningSelection> | null = null;
  try {
    selection = parseLockedProvisioningSelection({
      snapshot: order.providerSelectionSnapshot,
      provider: order.provider,
      providerApiVersion: order.providerApiVersion,
      productKind: order.productKind,
    });
  } catch {
    block("locked_snapshot_invalid", "Snapshot پرداخت‌شده برای تحویل قابل اتکا نیست.");
  }

  const instance = order.cloudInstance;
  const health = instance?.healthChecks[0] ?? null;
  const credential = instance?.credential ?? null;
  if (order.serviceOrder.status !== ServiceOrderStatus.PAID) {
    block("payment_not_settled", "پرداخت سفارش برای تحویل نهایی معتبر نیست.");
  }
  if (order.status !== InfrastructureOrderStatus.PROVISIONING) {
    block("infrastructure_state_invalid", "وضعیت زیرساخت در صف تأیید تحویل نیست.");
  }
  if (order.productFlowState !== "WAITING_ADMIN_DELIVERY_APPROVAL") {
    block("delivery_state_invalid", "جریان محصول در انتظار تأیید دوم Admin نیست.");
  }
  if (!instance) {
    block("resource_missing", "Resource ثبت‌شده برای سفارش وجود ندارد.");
  } else {
    if (instance.status !== CloudInstanceStatus.PENDING) {
      block("resource_state_invalid", "Resource در وضعیت قابل تحویل نیست.");
    }
    if (!instance.providerInstanceId || !instance.ipv4) {
      block("resource_identity_incomplete", "شناسهٔ Resource یا IP برای تحویل کامل نیست.");
    }
    if (instance.provider !== order.provider || instance.providerApiVersion !== order.providerApiVersion) {
      block("provider_mismatch", "Provider یا نسخهٔ Resource با سفارش یکسان نیست.");
    }
    if (instance.providerState?.toLowerCase() !== "active") {
      block("provider_power_not_active", "وضعیت Resource نزد Provider فعال تأیید نشده است.");
    }
    if (!instance.providerObservedAt) {
      block("provider_observation_missing", "مشاهدهٔ اخیر Provider برای Resource ثبت نشده است.");
    }
    if (!instance.healthCheckedAt || health?.status !== InfrastructureHealthCheckStatus.SUCCEEDED) {
      block("health_not_succeeded", "Health Check موفق برای Resource ثبت نشده است.");
    }
    if (!instance.secureDeliveryEvents.some((event) => event.status === "PENDING")) {
      block("delivery_event_missing", "رویداد تحویل امنِ در انتظار تأیید ثبت نشده است.");
    }
  }

  if (selection && instance) {
    if (instance.region !== selection.region) {
      block("region_mismatch", "Region Resource با Snapshot پرداخت‌شده متفاوت است.");
    }
    if (instance.size !== selection.externalPlanId) {
      block("plan_mismatch", "پلن Resource با Snapshot پرداخت‌شده متفاوت است.");
    }
    if (instance.image !== selection.externalImageId) {
      block("image_mismatch", "Image Resource با Snapshot پرداخت‌شده متفاوت است.");
    }
    if (
      selection.topologyVerificationMode === "STRICT_OBSERVED" &&
      (instance.networkId !== selection.externalNetworkId ||
        instance.securityId !== selection.externalSecurityId)
    ) {
      block("topology_mismatch", "شبکه یا Security Resource با Snapshot پرداخت‌شده متفاوت است.");
    }
  }

  const credentialRequired = selection?.accessMethod !== "SSH_KEY";
  if (credentialRequired) {
    if (
      !credential ||
      credential.status !== InstanceCredentialStatus.READY ||
      !credential.ciphertext ||
      !credential.iv ||
      !credential.authTag ||
      credential.expiresAt.getTime() <= Date.now()
    ) {
      block("credential_not_ready", "Credential رمزگذاری‌شده و معتبر برای تحویل آماده نیست.");
    }
  } else if (credential?.status === InstanceCredentialStatus.READY) {
    warn("optional_credential_present", "Credential ثبت شده است؛ روش دسترسی Snapshot کلید SSH است.");
  }

  return {
    infrastructureOrderId: order.id,
    serviceOrderId: order.serviceOrderId,
    provider: {
      provider: order.provider,
      source: order.plan.offerSource,
      apiVersion: order.providerApiVersion,
    },
    resource: {
      providerResourceId: instance?.providerInstanceId ?? null,
      ipv4: instance?.ipv4 ?? null,
      region: instance?.region ?? null,
      plan: instance?.size ?? null,
      image: instance?.image ?? null,
      powerState: instance?.providerState ?? null,
      observedAt: instance?.providerObservedAt?.toISOString() ?? null,
    },
    expected: {
      region: selection?.region ?? null,
      plan: selection?.externalPlanId ?? null,
      image: selection?.externalImageId ?? null,
      vcpu: order.plan.vcpu,
      ramGb: order.plan.ramGb,
      storageGb: order.plan.storageGb,
      accessMethod: selection?.accessMethod ?? null,
    },
    health: {
      status: health?.status ?? null,
      resultCode: health?.resultCode ?? null,
      checkedAt: health?.checkedAt.toISOString() ?? null,
    },
    credential: {
      required: credentialRequired,
      status: credential?.status ?? null,
      username: credential?.username ?? null,
      expiresAt: credential?.expiresAt.toISOString() ?? null,
    },
    warnings,
    blockingIssues,
    canApprove: blockingIssues.length === 0,
  };
}

export async function getDeliveryApprovalReview(infrastructureOrderId: string) {
  return buildDeliveryApprovalReview(prisma, infrastructureOrderId);
}

function assertWaitingDeliveryState(order: {
  status: InfrastructureOrderStatus;
  productFlowState: string | null;
  serviceOrder: { status: ServiceOrderStatus };
}) {
  if (
    order.status !== InfrastructureOrderStatus.PROVISIONING ||
    order.productFlowState !== "WAITING_ADMIN_DELIVERY_APPROVAL" ||
    order.serviceOrder.status !== ServiceOrderStatus.PAID
  ) {
    throw new WalletError("invalid_status", "این سفارش در صف تأیید نهایی تحویل نیست.");
  }
}

export async function approveDelivery(params: {
  infrastructureOrderId: string;
  adminUserId: string;
  reason: string;
  idempotencyKey: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const command = normalizeAdminCommand({
    operation: "APPROVE_DELIVERY",
    idempotencyKey: params.idempotencyKey,
    actorUserId: params.adminUserId,
    infrastructureOrderId: params.infrastructureOrderId,
    reason: params.reason,
  });
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "InfrastructureOrder"
      WHERE id = ${params.infrastructureOrderId}
      FOR UPDATE
    `;
    await assertAdminActorTx(tx, params.adminUserId);
    const replay = await replayAdminCommandTx(tx, command);
    if (replay) return replay;

    const order = await loadDeliveryOrder(tx, params.infrastructureOrderId);
    if (!order) throw new WalletError("not_found", "سفارش زیرساخت پیدا نشد.");
    assertWaitingDeliveryState(order);
    const review = await buildDeliveryApprovalReview(tx, order.id);
    if (!review.canApprove) {
      await tx.infrastructureOrder.update({
        where: { id: order.id },
        data: { status: InfrastructureOrderStatus.MANUAL_REVIEW },
      });
      await transitionProductFlowTx(tx, {
        owner: owner(order),
        from: "WAITING_ADMIN_DELIVERY_APPROVAL",
        to: "PROVISIONING_MANUAL_REVIEW",
        reason: "delivery_approval_blocked",
        idempotencyKey: `delivery-approval-blocked:${order.id}`,
        actorUserId: params.adminUserId,
      });
      const result = {
        infrastructureOrderId: order.id,
        status: InfrastructureOrderStatus.MANUAL_REVIEW,
        productFlowState: "PROVISIONING_MANUAL_REVIEW",
        approved: false,
        review,
        containsSecret: false,
      };
      await writeAuditLog(
        {
          actorUserId: params.adminUserId,
          action: AuditActions.DELIVERY_APPROVAL_BLOCKED,
          entityType: "infrastructure_order",
          entityId: order.id,
          afterData: {
            status: InfrastructureOrderStatus.MANUAL_REVIEW,
            blockingCodes: review.blockingIssues.map((issue) => issue.code),
            containsSecret: false,
          },
          ip: params.ip,
          userAgent: params.userAgent,
          idempotencyKey: `audit:${command.receiptKey}`,
        },
        tx,
      );
      await persistAdminCommandReceiptTx(tx, command, result);
      return result;
    }

    await transitionProductFlowTx(tx, {
      owner: owner(order),
      from: "WAITING_ADMIN_DELIVERY_APPROVAL",
      to: "DELIVERED",
      reason: "admin_delivery_approved",
      idempotencyKey: `delivery-approved:${order.id}`,
      actorUserId: params.adminUserId,
    });
    await activateApprovedDeliveryTx(tx, order.id);
    const result = {
      infrastructureOrderId: order.id,
      status: InfrastructureOrderStatus.ACTIVE,
      productFlowState: "ACTIVE",
      approved: true,
      containsSecret: false,
    };
    await writeAuditLog(
      {
        actorUserId: params.adminUserId,
        action: AuditActions.DELIVERY_APPROVED,
        entityType: "infrastructure_order",
        entityId: order.id,
        afterData: result,
        ip: params.ip,
        userAgent: params.userAgent,
        idempotencyKey: `audit:${command.receiptKey}`,
      },
      tx,
    );
    await persistAdminCommandReceiptTx(tx, command, result);
    return result;
  });
}

export async function holdDeliveryApproval(params: {
  infrastructureOrderId: string;
  adminUserId: string;
  reason: string;
  idempotencyKey: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const command = normalizeAdminCommand({
    operation: "HOLD_DELIVERY",
    idempotencyKey: params.idempotencyKey,
    actorUserId: params.adminUserId,
    infrastructureOrderId: params.infrastructureOrderId,
    reason: params.reason,
  });
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "InfrastructureOrder"
      WHERE id = ${params.infrastructureOrderId}
      FOR UPDATE
    `;
    await assertAdminActorTx(tx, params.adminUserId);
    const replay = await replayAdminCommandTx(tx, command);
    if (replay) return replay;
    const order = await loadDeliveryOrder(tx, params.infrastructureOrderId);
    if (!order) throw new WalletError("not_found", "سفارش زیرساخت پیدا نشد.");
    assertWaitingDeliveryState(order);
    await tx.infrastructureOrder.update({
      where: { id: order.id },
      data: { status: InfrastructureOrderStatus.MANUAL_REVIEW },
    });
    await transitionProductFlowTx(tx, {
      owner: owner(order),
      from: "WAITING_ADMIN_DELIVERY_APPROVAL",
      to: "PROVISIONING_MANUAL_REVIEW",
      reason: "delivery_held_by_admin",
      idempotencyKey: `delivery-held:${order.id}`,
      actorUserId: params.adminUserId,
    });
    const result = {
      infrastructureOrderId: order.id,
      status: InfrastructureOrderStatus.MANUAL_REVIEW,
      productFlowState: "PROVISIONING_MANUAL_REVIEW",
      held: true,
      containsSecret: false,
    };
    await writeAuditLog(
      {
        actorUserId: params.adminUserId,
        action: AuditActions.DELIVERY_HELD,
        entityType: "infrastructure_order",
        entityId: order.id,
        afterData: result,
        ip: params.ip,
        userAgent: params.userAgent,
        idempotencyKey: `audit:${command.receiptKey}`,
      },
      tx,
    );
    await persistAdminCommandReceiptTx(tx, command, result);
    return result;
  });
}
