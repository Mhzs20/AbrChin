import { isIPv4 } from "node:net";

import {
  AdminNotificationStatus,
  AdminNotificationType,
  CloudInstanceStatus,
  InfrastructureHealthCheckStatus,
  InfrastructureOrderStatus,
  InfrastructureProductKind,
  InfrastructureProvider,
  InstanceCredentialStatus,
  SecureDeliveryStatus,
  ServiceOrderStatus,
  SubscriptionStatus,
  type Prisma,
} from "@prisma/client";

import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import {
  assertAdminActorTx,
  normalizeAdminCommand,
  persistAdminCommandReceiptTx,
  replayAdminCommandTx,
} from "@/lib/admin/command-receipt";
import { prisma } from "@/lib/db";
import { transitionProductFlowTx } from "@/lib/product-flow/service";
import {
  credentialFingerprint,
  encryptCredential,
} from "@/lib/security/credential-vault";
import { addBillingMonth, addGracePeriod } from "@/lib/subscriptions/period";
import { WalletError } from "@/lib/wallet/errors";

const USERNAME_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/i;
const RESOURCE_ID_PATTERN = /^[A-Za-z0-9._:-]{3,160}$/;

type ManualDeliveryResult = {
  infrastructureOrderId: string;
  serviceOrderId: string;
  cloudInstanceId: string;
  status: "ACTIVE";
};

function lockedSelection(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    row.provider !== "ARVAN" ||
    row.providerApiVersion !== "v1" ||
    row.productKind !== "READY_INSTANT_SERVER" ||
    row.offerSource !== "MANUAL_ADMIN" ||
    typeof row.region !== "string" ||
    typeof row.externalPlanId !== "string" ||
    typeof row.externalImageId !== "string"
  ) {
    return null;
  }
  return {
    region: row.region,
    externalPlanId: row.externalPlanId,
    externalImageId: row.externalImageId,
  };
}

export async function completeManualReadyDelivery(params: {
  infrastructureOrderId: string;
  adminUserId: string;
  providerResourceId: string;
  ipv4: string;
  username: string;
  secret: string;
  reason: string;
  idempotencyKey: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const providerResourceId = params.providerResourceId.trim();
  const ipv4 = params.ipv4.trim();
  const username = params.username.trim();
  if (!RESOURCE_ID_PATTERN.test(providerResourceId)) {
    throw new WalletError("invalid_resource_id", "شناسه Resource معتبر نیست.");
  }
  if (!isIPv4(ipv4)) {
    throw new WalletError("invalid_ipv4", "IPv4 معتبر نیست.");
  }
  if (
    !USERNAME_PATTERN.test(username) ||
    params.secret.length < 8 ||
    params.secret.length > 4_096
  ) {
    throw new WalletError("invalid_credential", "اطلاعات دسترسی معتبر نیست.");
  }
  const secretFingerprint = credentialFingerprint(params.secret);
  const command = normalizeAdminCommand({
    operation: "manual_ready_delivery",
    idempotencyKey: params.idempotencyKey,
    actorUserId: params.adminUserId,
    infrastructureOrderId: params.infrastructureOrderId,
    reason: params.reason,
    payload: {
      providerResourceId,
      ipv4,
      username,
      secretFingerprint,
    },
  });
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "InfrastructureOrder"
      WHERE id = ${params.infrastructureOrderId}
      FOR UPDATE
    `;
    await assertAdminActorTx(tx, params.adminUserId);
    const replay = await replayAdminCommandTx(tx, command);
    if (replay) return replay as unknown as ManualDeliveryResult;

    const order = await tx.infrastructureOrder.findUnique({
      where: { id: params.infrastructureOrderId },
      include: {
        serviceOrder: { include: { recommendationQuote: true } },
        plan: { include: { catalogItem: true } },
        cloudInstance: true,
        provisioningJobs: true,
      },
    });
    const selection = order
      ? lockedSelection(order.providerSelectionSnapshot)
      : null;
    if (!order) throw new WalletError("not_found", "سفارش زیرساخت پیدا نشد.");
    if (
      order.provider !== InfrastructureProvider.ARVAN ||
      order.providerApiVersion !== "v1" ||
      order.productKind !== InfrastructureProductKind.READY_INSTANT_SERVER ||
      order.plan.offerSource !== "MANUAL_ADMIN" ||
      order.plan.catalogItem?.source !== "MANUAL_ADMIN" ||
      order.serviceOrder.status !== ServiceOrderStatus.PAID ||
      order.status !== InfrastructureOrderStatus.WAITING_ADMIN_FUNDING ||
      order.productFlowState !== "PAID" ||
      order.requiredFundingRial !== 0n ||
      order.cloudInstance ||
      order.provisioningJobs.length > 0 ||
      !selection
    ) {
      throw new WalletError(
        "invalid_status",
        "این سفارش در مسیر تحویل دستی معتبر نیست.",
      );
    }
    if (
      selection.region !== order.plan.regionCode ||
      selection.externalPlanId !==
        (order.plan.catalogItem?.externalPlanId ?? order.plan.sizeCode) ||
      selection.externalImageId !==
        (order.serviceOrder.recommendationQuote?.externalImageId ??
          order.plan.imageCode)
    ) {
      throw new WalletError(
        "provider_snapshot_mismatch",
        "Snapshot قفل‌شده سفارش با تحویل دستی یکسان نیست.",
      );
    }
    const duplicateResource = await tx.cloudInstance.findUnique({
      where: { providerInstanceId: providerResourceId },
      select: { id: true },
    });
    if (duplicateResource) {
      throw new WalletError(
        "resource_already_assigned",
        "این Resource قبلاً به سفارش دیگری متصل شده است.",
      );
    }

    const now = new Date();
    const encrypted = encryptCredential(params.secret);
    const credentialExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
    const instance = await tx.cloudInstance.create({
      data: {
        infrastructureOrderId: order.id,
        userId: order.userId,
        provider: order.provider,
        providerApiVersion: order.providerApiVersion,
        providerInstanceId: providerResourceId,
        name: order.desiredInstanceName ?? `abrchin-manual-${order.id.slice(-10)}`,
        region: selection.region,
        size: selection.externalPlanId,
        image: selection.externalImageId,
        deliveryMode: order.deliveryMode,
        ipv4,
        providerState: "active",
        providerObservedAt: now,
        status: CloudInstanceStatus.ACTIVE,
        provisionedAt: now,
        healthCheckedAt: now,
        deliveredAt: now,
      },
    });
    const owner = {
      recommendationSessionId:
        order.serviceOrder.recommendationQuote?.sessionId ?? null,
      serviceOrderId: order.serviceOrderId,
      infrastructureOrderId: order.id,
    };
    await transitionProductFlowTx(tx, {
      owner,
      from: "PAID",
      to: "PROVISIONING_SUBMITTED",
      reason: "manual_ready_delivery_started",
      idempotencyKey: `manual-delivery-submitted:${order.id}`,
      actorUserId: params.adminUserId,
    });
    await transitionProductFlowTx(tx, {
      owner,
      from: "PROVISIONING_SUBMITTED",
      to: "PROVISIONING",
      reason: "manual_resource_recorded",
      idempotencyKey: `manual-delivery-provisioning:${order.id}`,
      actorUserId: params.adminUserId,
    });
    await transitionProductFlowTx(tx, {
      owner,
      from: "PROVISIONING",
      to: "HEALTH_CHECKING",
      reason: "manual_resource_verified_by_admin",
      idempotencyKey: `manual-delivery-health:${order.id}`,
      actorUserId: params.adminUserId,
    });
    await tx.infrastructureHealthCheck.create({
      data: {
        infrastructureOrderId: order.id,
        cloudInstanceId: instance.id,
        attempt: 1,
        status: InfrastructureHealthCheckStatus.SUCCEEDED,
        providerState: "active",
        expectedIpv4: ipv4,
        observedIpv4: ipv4,
        topologyVerificationMode: "PROVIDER_MANAGED",
        providerObservedAt: now,
        connectivityProtocol: "ADMIN_CONFIRMED",
        resultCode: "manual_delivery_confirmed",
        checkedAt: now,
        finishedAt: now,
        metadata: {
          mode: "MANUAL_ADMIN_DELIVERY",
          containsSecret: false,
        },
      },
    });
    await transitionProductFlowTx(tx, {
      owner,
      from: "HEALTH_CHECKING",
      to: "DELIVERED",
      reason: "manual_delivery_health_confirmed",
      idempotencyKey: `manual-delivery-delivered:${order.id}`,
      actorUserId: params.adminUserId,
    });
    const credential = await tx.instanceCredential.create({
      data: {
        cloudInstanceId: instance.id,
        createdById: params.adminUserId,
        username,
        ...encrypted,
        status: InstanceCredentialStatus.READY,
        expiresAt: credentialExpiresAt,
      },
    });
    await tx.secureDeliveryEvent.create({
      data: {
        infrastructureOrderId: order.id,
        cloudInstanceId: instance.id,
        status: SecureDeliveryStatus.DELIVERED,
        method: "ONE_TIME_ENCRYPTED_CREDENTIAL",
        resultCode: "credential_ready",
        deliveredAt: now,
        metadata: {
          credentialId: credential.id,
          containsSecret: false,
          source: "manual_admin_delivery",
        },
      },
    });
    await transitionProductFlowTx(tx, {
      owner,
      from: "DELIVERED",
      to: "ACTIVE",
      reason: "manual_secure_delivery_completed",
      idempotencyKey: `manual-delivery-active:${order.id}`,
      actorUserId: params.adminUserId,
    });
    await tx.infrastructureOrder.update({
      where: { id: order.id },
      data: { status: InfrastructureOrderStatus.ACTIVE },
    });
    const periodEnd = addBillingMonth(now);
    await tx.serviceSubscription.create({
      data: {
        cloudInstanceId: instance.id,
        sourceOrderId: order.serviceOrderId,
        userId: order.userId,
        planId: order.planId,
        status: SubscriptionStatus.ACTIVE,
        parchinLevel: order.parchinLevel,
        renewalPriceRial:
          order.serviceOrder.recommendationQuote?.renewalAmountRial ??
          order.serviceOrder.amount,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        nextRenewalAt: periodEnd,
        graceEndsAt: addGracePeriod(periodEnd),
      },
    });
    await tx.adminNotification.updateMany({
      where: {
        infrastructureOrderId: order.id,
        type: AdminNotificationType.ORDER_WAITING_PROVIDER_FUNDING,
        status: { in: [AdminNotificationStatus.UNREAD, AdminNotificationStatus.READ] },
      },
      data: { status: AdminNotificationStatus.RESOLVED, resolvedAt: now },
    });
    await tx.provisioningNotificationOutbox.upsert({
      where: { idempotencyKey: `instance-active:${order.id}` },
      update: {},
      create: {
        idempotencyKey: `instance-active:${order.id}`,
        infrastructureOrderId: order.id,
        type: AdminNotificationType.INSTANCE_ACTIVE,
        title: "سرور فعال شد",
        message: `سرور سفارش ${order.serviceOrder.title} با تحویل دستی آماده است.`,
      },
    });
    await writeAuditLog(
      {
        actorUserId: params.adminUserId,
        action: AuditActions.MANUAL_READY_DELIVERY,
        entityType: "infrastructure_order",
        entityId: order.id,
        afterData: {
          providerResourceId,
          ipv4,
          cloudInstanceId: instance.id,
          credentialId: credential.id,
          containsSecret: false,
          reason: command.reason,
        },
        ip: params.ip,
        userAgent: params.userAgent,
        idempotencyKey: `audit:manual-delivery:${params.idempotencyKey}`,
      },
      tx,
    );
    const result: ManualDeliveryResult = {
      infrastructureOrderId: order.id,
      serviceOrderId: order.serviceOrderId,
      cloudInstanceId: instance.id,
      status: "ACTIVE",
    };
    await persistAdminCommandReceiptTx(
      tx,
      command,
      result as unknown as Prisma.InputJsonValue,
    );
    return result;
  });
}
