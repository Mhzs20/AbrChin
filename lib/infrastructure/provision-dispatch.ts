import {
  InfrastructureOfferSource,
  InfrastructureOrderStatus,
  ProvisioningJobStatus,
  type Prisma,
} from "@prisma/client";

import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import {
  assignReservedInventoryTx,
  transferInventoryCredentialToInstanceTx,
} from "@/lib/infrastructure/preprovisioned-inventory";
import { isCloudProviderConfigured } from "@/lib/infrastructure/provider-factory";
import {
  buildDesiredInstanceName,
  parseLockedProvisioningSelection,
} from "@/lib/infrastructure/provisioning-service";
import { transitionProductFlowTx } from "@/lib/product-flow/service";
import { isServiceReadyForProvision } from "@/lib/orders/service-lifecycle";
import { WalletError } from "@/lib/wallet/errors";

type DispatchResult =
  | { state: "DISPATCHED"; jobId: string; operation: string }
  | { state: "ALREADY_DISPATCHED"; jobId: string; operation: string }
  | { state: "MANUAL_FULFILLMENT_REQUIRED" }
  | { state: "NOT_APPROVED" };

function resultRecord(value: Prisma.JsonValue) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function automationEnabled(input: {
  provider: "ARVAN" | "PARSPACK";
  offerSource: InfrastructureOfferSource;
}) {
  if (input.offerSource !== InfrastructureOfferSource.API_CATALOG) return false;
  if (!isCloudProviderConfigured(input.provider)) return false;
  const env = getEnv();
  return input.provider === "ARVAN"
    ? env.arvanMutationsEnabled
    : env.parspackMutationsEnabled;
}

async function loadApprovedOrderTx(tx: Prisma.TransactionClient, infrastructureOrderId: string) {
  await tx.$queryRaw`
    SELECT id FROM "InfrastructureOrder"
    WHERE id = ${infrastructureOrderId}
    FOR UPDATE
  `;
  const order = await tx.infrastructureOrder.findUnique({
    where: { id: infrastructureOrderId },
    include: {
      plan: { include: { catalogItem: true } },
      serviceOrder: { include: { recommendationQuote: true } },
      provisioningJobs: { orderBy: { createdAt: "asc" } },
      preprovisionedInventoryItem: true,
    },
  });
  if (!order) throw new WalletError("not_found", "سفارش زیرساخت پیدا نشد.");
  if (
    order.status !== InfrastructureOrderStatus.FUNDING_CONFIRMED ||
    order.productFlowState !== "PROVISION_APPROVED" ||
    !isServiceReadyForProvision(order.serviceOrder.status)
  ) {
    return { order, approvedById: null };
  }
  const approval = await tx.adminCommandReceipt.findFirst({
    where: {
      infrastructureOrderId: order.id,
      operation: "APPROVE_PROVISION",
    },
    orderBy: { createdAt: "desc" },
  });
  const result = approval ? resultRecord(approval.resultSnapshot) : {};
  return {
    order,
    approvedById: approval && result.approved === true ? approval.actorUserId : null,
  };
}

export async function dispatchApprovedProvision(
  infrastructureOrderId: string,
): Promise<DispatchResult> {
  return prisma.$transaction(async (tx) => {
    const { order, approvedById } = await loadApprovedOrderTx(tx, infrastructureOrderId);
    const existing = order.provisioningJobs.find(
      (job) => job.operation === "create_instance" || job.operation === "adopt_preprovisioned_inventory",
    );
    if (existing) {
      return {
        state: "ALREADY_DISPATCHED",
        jobId: existing.id,
        operation: existing.operation,
      };
    }
    if (!approvedById) return { state: "NOT_APPROVED" };

    const source = order.plan.offerSource;
    if (
      source !== InfrastructureOfferSource.PREPROVISIONED_INVENTORY &&
      !automationEnabled({ provider: order.provider, offerSource: source })
    ) {
      return { state: "MANUAL_FULFILLMENT_REQUIRED" };
    }

    const selection = parseLockedProvisioningSelection({
      snapshot: order.providerSelectionSnapshot,
      provider: order.provider,
      providerApiVersion: order.providerApiVersion,
      productKind: order.productKind,
    });
    const desiredInstanceName = order.desiredInstanceName ?? buildDesiredInstanceName(order.id);
    const owner = {
      recommendationSessionId: order.serviceOrder.recommendationQuote?.sessionId ?? null,
      serviceOrderId: order.serviceOrderId,
      infrastructureOrderId: order.id,
    };
    const idempotencyKey = `provision-dispatch:${order.id}`;
    let operation = "create_instance";

    if (source === InfrastructureOfferSource.PREPROVISIONED_INVENTORY) {
      const inventory = order.preprovisionedInventoryItem;
      if (
        !inventory ||
        !inventory.reservedByQuoteId ||
        inventory.reservedRevision == null ||
        inventory.planId !== order.planId ||
        inventory.catalogItemId !== order.plan.catalogItemId ||
        inventory.provider !== order.provider ||
        inventory.apiVersion !== order.providerApiVersion ||
        inventory.regionCode !== selection.region ||
        inventory.externalPlanId !== selection.externalPlanId ||
        inventory.externalImageId !== selection.externalImageId
      ) {
        throw new WalletError(
          "inventory_assignment_conflict",
          "موجودی رزروشده با Snapshot پرداخت‌شده یکسان نیست.",
        );
      }
      await assignReservedInventoryTx(tx, {
        inventoryItemId: inventory.id,
        quoteId: inventory.reservedByQuoteId,
        orderId: order.serviceOrderId,
        revision: inventory.reservedRevision,
      });
      const instance = await tx.cloudInstance.create({
        data: {
          infrastructureOrderId: order.id,
          userId: order.userId,
          provider: order.provider,
          providerApiVersion: order.providerApiVersion,
          providerInstanceId: inventory.providerResourceId,
          name: desiredInstanceName,
          region: selection.region,
          size: selection.externalPlanId,
          image: selection.externalImageId,
          deliveryMode: order.deliveryMode,
          ipv4: inventory.observedIpv4,
          providerState: inventory.observedState,
          networkId: inventory.observedNetworkId,
          securityId: inventory.observedSecurityId,
          providerObservedAt: inventory.lastObservedAt,
          status: "PENDING",
        },
      });
      await transferInventoryCredentialToInstanceTx(tx, {
        inventoryItemId: inventory.id,
        cloudInstanceId: instance.id,
      });
      operation = "adopt_preprovisioned_inventory";
    }

    const job = await tx.provisioningJob.create({
      data: {
        infrastructureOrderId: order.id,
        operation,
        status: ProvisioningJobStatus.QUEUED,
        idempotencyKey,
        attempt: 1,
        providerResourceId:
          source === InfrastructureOfferSource.PREPROVISIONED_INVENTORY
            ? order.preprovisionedInventoryItem?.providerResourceId ?? null
            : null,
      },
    });
    await tx.infrastructureOrder.update({
      where: { id: order.id },
      data: {
        status: InfrastructureOrderStatus.QUEUED,
        desiredInstanceName,
      },
    });
    await transitionProductFlowTx(tx, {
      owner,
      from: "PROVISION_APPROVED",
      to: "PROVISIONING_SUBMITTED",
      reason:
        operation === "adopt_preprovisioned_inventory"
          ? "approved_inventory_assignment_dispatched"
          : "approved_provider_provision_dispatched",
      idempotencyKey: `provision-dispatched:${order.id}`,
      actorUserId: approvedById,
    });
    await writeAuditLog(
      {
        actorUserId: approvedById,
        action: AuditActions.PROVISION_DISPATCHED,
        entityType: "infrastructure_order",
        entityId: order.id,
        afterData: {
          jobId: job.id,
          operation,
          source,
          containsSecret: false,
        },
        idempotencyKey: `audit:provision-dispatched:${order.id}`,
      },
      tx,
    );
    return { state: "DISPATCHED", jobId: job.id, operation };
  });
}

export async function dispatchApprovedProvisionCommands(limit = 1) {
  const candidates = await prisma.infrastructureOrder.findMany({
    where: {
      status: InfrastructureOrderStatus.FUNDING_CONFIRMED,
      productFlowState: "PROVISION_APPROVED",
      adminCommandReceipts: { some: { operation: "APPROVE_PROVISION" } },
    },
    orderBy: { updatedAt: "asc" },
    take: Math.max(0, Math.min(limit, 20)),
    select: { id: true },
  });
  let dispatched = 0;
  for (const candidate of candidates) {
    const result = await dispatchApprovedProvision(candidate.id);
    if (result.state === "DISPATCHED") dispatched += 1;
  }
  return dispatched;
}
