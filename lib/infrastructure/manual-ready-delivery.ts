import { isIPv4 } from "node:net";

import {
  CloudInstanceStatus,
  InfrastructureHealthCheckStatus,
  InfrastructureOfferSource,
  InfrastructureOrderStatus,
  InstanceCredentialStatus,
  SecureDeliveryStatus,
  type Prisma,
} from "@prisma/client";

import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { startInitialUsageBillingTx } from "@/lib/billing/start";
import {
  assertAdminActorTx,
  normalizeAdminCommand,
  persistAdminCommandReceiptTx,
  replayAdminCommandTx,
} from "@/lib/admin/command-receipt";
import { prisma } from "@/lib/db";
import { parseLockedProvisioningSelection } from "@/lib/infrastructure/provisioning-service";
import { transitionProductFlowTx } from "@/lib/product-flow/service";
import { isServiceReadyForProvision } from "@/lib/orders/service-lifecycle";
import {
  credentialFingerprint,
  encryptCredential,
} from "@/lib/security/credential-vault";
import { WalletError } from "@/lib/wallet/errors";

const USERNAME_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/i;
const RESOURCE_ID_PATTERN = /^[A-Za-z0-9._:-]{3,160}$/;

type ManualProvisionResult = {
  infrastructureOrderId: string;
  serviceOrderId: string;
  cloudInstanceId: string;
  productFlowState: "WAITING_ADMIN_DELIVERY_APPROVAL";
  containsSecret: false;
};

/**
 * Records an Admin-verified Resource for a command that already passed the
 * first approval. Despite its historical export name, this function never
 * delivers or activates a service; Phase 1.8 owns the second approval.
 */
export async function completeManualReadyDelivery(params: {
  infrastructureOrderId: string;
  adminUserId: string;
  providerResourceId: string;
  ipv4: string;
  region: string;
  externalPlanId: string;
  externalImageId: string;
  username: string;
  secret: string;
  reason: string;
  idempotencyKey: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const providerResourceId = params.providerResourceId.trim();
  const ipv4 = params.ipv4.trim();
  const region = params.region.trim();
  const externalPlanId = params.externalPlanId.trim();
  const externalImageId = params.externalImageId.trim();
  const username = params.username.trim();
  if (!RESOURCE_ID_PATTERN.test(providerResourceId)) {
    throw new WalletError("invalid_resource_id", "شناسه Resource معتبر نیست.");
  }
  if (!isIPv4(ipv4)) {
    throw new WalletError("invalid_ipv4", "IPv4 معتبر نیست.");
  }
  if (
    !region ||
    !externalPlanId ||
    !externalImageId ||
    !USERNAME_PATTERN.test(username) ||
    params.secret.length < 8 ||
    params.secret.length > 4_096
  ) {
    throw new WalletError("invalid_credential", "اطلاعات Provision دستی معتبر نیست.");
  }
  const secretFingerprint = credentialFingerprint(params.secret);
  const command = normalizeAdminCommand({
    operation: "MANUAL_PROVISION",
    idempotencyKey: params.idempotencyKey,
    actorUserId: params.adminUserId,
    infrastructureOrderId: params.infrastructureOrderId,
    reason: params.reason,
    payload: {
      providerResourceId,
      ipv4,
      region,
      externalPlanId,
      externalImageId,
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
    if (replay) return replay as unknown as ManualProvisionResult;

    const order = await tx.infrastructureOrder.findUnique({
      where: { id: params.infrastructureOrderId },
      include: {
        serviceOrder: { include: { recommendationQuote: true } },
        plan: true,
        activationRequest: true,
        cloudInstance: true,
        provisioningJobs: true,
      },
    });
    if (!order) throw new WalletError("not_found", "سفارش زیرساخت پیدا نشد.");
    const approval = await tx.adminCommandReceipt.findFirst({
      where: {
        infrastructureOrderId: order.id,
        operation: "APPROVE_PROVISION",
      },
      orderBy: { createdAt: "desc" },
      select: { resultSnapshot: true },
    });
    const approvalResult =
      approval?.resultSnapshot &&
      typeof approval.resultSnapshot === "object" &&
      !Array.isArray(approval.resultSnapshot)
        ? (approval.resultSnapshot as Record<string, unknown>)
        : null;
    if (approvalResult?.approved !== true) {
      throw new WalletError(
        "invalid_status",
        "Fulfillment فقط پس از ثبت تأیید اول Admin مجاز است.",
      );
    }
    const selection = parseLockedProvisioningSelection({
      snapshot: order.providerSelectionSnapshot,
      provider: order.provider,
      providerApiVersion: order.providerApiVersion,
      productKind: order.productKind,
    });
    if (
      order.plan.offerSource === InfrastructureOfferSource.PREPROVISIONED_INVENTORY ||
      !isServiceReadyForProvision(order.serviceOrder.status) ||
      order.status !== InfrastructureOrderStatus.FUNDING_CONFIRMED ||
      order.productFlowState !== "PROVISION_APPROVED" ||
      order.cloudInstance ||
      order.provisioningJobs.length > 0
    ) {
      throw new WalletError("invalid_status", "این سفارش در مسیر Fulfillment دستی معتبر نیست.");
    }
    if (
      region !== selection.region ||
      externalPlanId !== selection.externalPlanId ||
      externalImageId !== selection.externalImageId
    ) {
      throw new WalletError(
        "provider_snapshot_mismatch",
        "Region، Plan یا Image ثبت‌شده با Snapshot پرداخت یکسان نیست.",
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
        networkId: selection.externalNetworkId,
        securityId: selection.externalSecurityId,
        providerObservedAt: now,
        status: CloudInstanceStatus.PENDING,
        provisionedAt: now,
        healthCheckedAt: now,
      },
    });
    await startInitialUsageBillingTx(tx, {
      cloudInstanceId: instance.id,
      providerConfirmedAt: now,
      providerEventId: `manual-confirmation:${order.id}`,
    });
    const encrypted = encryptCredential(params.secret);
    const credential = await tx.instanceCredential.create({
      data: {
        cloudInstanceId: instance.id,
        createdById: params.adminUserId,
        username,
        ...encrypted,
        status: InstanceCredentialStatus.READY,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
      },
    });
    const owner = {
      recommendationSessionId: order.serviceOrder.recommendationQuote?.sessionId ?? null,
      serviceOrderId: order.serviceOrderId,
      infrastructureOrderId: order.id,
    };
    await transitionProductFlowTx(tx, {
      owner,
      from: "PROVISION_APPROVED",
      to: "PROVISIONING_SUBMITTED",
      reason: "manual_provision_started",
      idempotencyKey: `manual-provision-submitted:${order.id}`,
      actorUserId: params.adminUserId,
    });
    await transitionProductFlowTx(tx, {
      owner,
      from: "PROVISIONING_SUBMITTED",
      to: "PROVISIONING",
      reason: "manual_resource_recorded",
      idempotencyKey: `manual-provision-recorded:${order.id}`,
      actorUserId: params.adminUserId,
    });
    await transitionProductFlowTx(tx, {
      owner,
      from: "PROVISIONING",
      to: "HEALTH_CHECKING",
      reason: "manual_resource_verified_by_admin",
      idempotencyKey: `manual-provision-health:${order.id}`,
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
        expectedNetworkId: selection.externalNetworkId,
        observedNetworkId: selection.externalNetworkId,
        expectedSecurityId: selection.externalSecurityId,
        observedSecurityId: selection.externalSecurityId,
        topologyVerificationMode: selection.topologyVerificationMode,
        providerObservedAt: now,
        connectivityProtocol: "ADMIN_CONFIRMED",
        resultCode: "manual_resource_confirmed",
        checkedAt: now,
        finishedAt: now,
        metadata: { containsSecret: false, source: "manual_fulfillment" },
      },
    });
    await transitionProductFlowTx(tx, {
      owner,
      from: "HEALTH_CHECKING",
      to: "WAITING_ADMIN_DELIVERY_APPROVAL",
      reason: "manual_provision_ready_for_delivery_approval",
      idempotencyKey: `manual-provision-waiting-delivery:${order.id}`,
      actorUserId: params.adminUserId,
    });
    await tx.infrastructureOrder.update({
      where: { id: order.id },
      data: { status: InfrastructureOrderStatus.PROVISIONING },
    });
    await tx.secureDeliveryEvent.create({
      data: {
        infrastructureOrderId: order.id,
        cloudInstanceId: instance.id,
        status: SecureDeliveryStatus.PENDING,
        method: "ONE_TIME_ENCRYPTED_CREDENTIAL",
        resultCode: "waiting_admin_delivery_approval",
        metadata: { credentialId: credential.id, containsSecret: false },
      },
    });
    if (order.activationRequest) {
      await tx.activationRequest.update({
        where: { id: order.activationRequest.id },
        data: {
          status: "WAITING_DELIVERY_APPROVAL",
        },
      });
    }
    await writeAuditLog(
      {
        actorUserId: params.adminUserId,
        action: AuditActions.MANUAL_PROVISION,
        entityType: "infrastructure_order",
        entityId: order.id,
        afterData: {
          providerResourceId,
          ipv4,
          region,
          externalPlanId,
          externalImageId,
          cloudInstanceId: instance.id,
          credentialId: credential.id,
          containsSecret: false,
        },
        ip: params.ip,
        userAgent: params.userAgent,
        idempotencyKey: `audit:${command.receiptKey}`,
      },
      tx,
    );
    const result: ManualProvisionResult = {
      infrastructureOrderId: order.id,
      serviceOrderId: order.serviceOrderId,
      cloudInstanceId: instance.id,
      productFlowState: "WAITING_ADMIN_DELIVERY_APPROVAL",
      containsSecret: false,
    };
    await persistAdminCommandReceiptTx(
      tx,
      command,
      result as unknown as Prisma.InputJsonValue,
    );
    return result;
  });
}
