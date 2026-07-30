import { connect } from "node:net";

import {
  CloudInstanceStatus,
  InfrastructureHealthCheckStatus,
  InfrastructureOrderStatus,
  SecureDeliveryStatus,
  SubscriptionStatus,
  type Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { transitionProductFlowTx } from "@/lib/product-flow/service";
import { addBillingMonth, addGracePeriod } from "@/lib/subscriptions/period";

const CONNECT_TIMEOUT_MS = 3_000;
const MAX_CONNECT_ATTEMPTS = 3;

export type ConnectivityProbe = (input: {
  host: string;
  port: number;
  timeoutMs: number;
  attempt: number;
}) => Promise<boolean>;

export const tcpConnectivityProbe: ConnectivityProbe = ({
  host,
  port,
  timeoutMs,
}) =>
  new Promise((resolve) => {
    const socket = connect({ host, port });
    let completed = false;
    const finish = (value: boolean) => {
      if (completed) return;
      completed = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });

function asSelection(value: Prisma.JsonValue | null) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function owner(order: {
  id: string;
  serviceOrderId: string;
  serviceOrder: {
    recommendationQuote: { sessionId: string } | null;
  };
}) {
  return {
    recommendationSessionId:
      order.serviceOrder.recommendationQuote?.sessionId ?? null,
    serviceOrderId: order.serviceOrderId,
    infrastructureOrderId: order.id,
  };
}

function renewalPrice(order: {
  serviceOrder: { planSnapshot: Prisma.JsonValue; amount: bigint };
}) {
  const snapshot = asSelection(order.serviceOrder.planSnapshot);
  return typeof snapshot.finalPriceRialSnapshot === "string"
    ? BigInt(snapshot.finalPriceRialSnapshot)
    : order.serviceOrder.amount;
}

async function activateDeliveredServiceTx(
  tx: Prisma.TransactionClient,
  infrastructureOrderId: string,
) {
  const order = await tx.infrastructureOrder.findUniqueOrThrow({
    where: { id: infrastructureOrderId },
    include: {
      cloudInstance: { include: { credential: true } },
      serviceOrder: { include: { recommendationQuote: true } },
    },
  });
  const instance = order.cloudInstance;
  if (
    !instance ||
    !instance.ipv4 ||
    !instance.healthCheckedAt ||
    !instance.credential ||
    instance.credential.status !== "READY"
  ) {
    throw new Error("secure_delivery_not_ready");
  }
  const currentState = order.productFlowState;
  if (currentState === "DELIVERY_RETRYABLE") {
    await transitionProductFlowTx(tx, {
      owner: owner(order),
      from: "DELIVERY_RETRYABLE",
      to: "DELIVERED",
      reason: "secure_delivery_recovered",
      idempotencyKey: `secure-delivery-recovered:${order.id}:${instance.credential.id}`,
    });
  } else if (currentState !== "DELIVERED") {
    throw new Error("secure_delivery_state_conflict");
  }

  const deliveredAt = new Date();
  await tx.secureDeliveryEvent.create({
    data: {
      infrastructureOrderId: order.id,
      cloudInstanceId: instance.id,
      status: SecureDeliveryStatus.DELIVERED,
      method: "ONE_TIME_ENCRYPTED_CREDENTIAL",
      resultCode: "credential_ready",
      deliveredAt,
      metadata: {
        credentialId: instance.credential.id,
        containsSecret: false,
      },
    },
  });
  await transitionProductFlowTx(tx, {
    owner: owner(order),
    from: "DELIVERED",
    to: "ACTIVE",
    reason: "secure_delivery_completed",
    idempotencyKey: `service-active:${order.id}:${instance.credential.id}`,
  });
  await tx.cloudInstance.update({
    where: { id: instance.id },
    data: {
      status: CloudInstanceStatus.ACTIVE,
      deliveredAt,
      provisionedAt: deliveredAt,
    },
  });
  await tx.infrastructureOrder.update({
    where: { id: order.id },
    data: { status: InfrastructureOrderStatus.ACTIVE },
  });
  const periodEnd = addBillingMonth(deliveredAt);
  await tx.serviceSubscription.upsert({
    where: { cloudInstanceId: instance.id },
    update: {},
    create: {
      cloudInstanceId: instance.id,
      sourceOrderId: order.serviceOrderId,
      userId: order.userId,
      planId: order.planId,
      status: SubscriptionStatus.ACTIVE,
      parchinLevel: order.parchinLevel,
      renewalPriceRial: renewalPrice(order),
      currentPeriodStart: deliveredAt,
      currentPeriodEnd: periodEnd,
      nextRenewalAt: periodEnd,
      graceEndsAt: addGracePeriod(periodEnd),
    },
  });
}

export async function completeSecureDelivery(
  infrastructureOrderId: string,
) {
  return prisma.$transaction((tx) =>
    activateDeliveredServiceTx(tx, infrastructureOrderId),
  );
}

export async function runInfrastructureHealthCheck(input: {
  infrastructureOrderId: string;
  probe?: ConnectivityProbe;
  maxAttempts?: number;
}) {
  const probe = input.probe ?? tcpConnectivityProbe;
  const maxAttempts = Math.min(
    Math.max(input.maxAttempts ?? MAX_CONNECT_ATTEMPTS, 1),
    MAX_CONNECT_ATTEMPTS,
  );
  const prepared = await prisma.$transaction(async (tx) => {
    const order = await tx.infrastructureOrder.findUniqueOrThrow({
      where: { id: input.infrastructureOrderId },
      include: {
        cloudInstance: { include: { credential: true } },
        serviceOrder: { include: { recommendationQuote: true } },
      },
    });
    const instance = order.cloudInstance;
    const selection = asSelection(order.providerSelectionSnapshot);
    const expectedNetworkId =
      typeof selection.externalNetworkId === "string"
        ? selection.externalNetworkId
        : null;
    if (
      !instance ||
      instance.providerState?.toLowerCase() !== "active" ||
      !instance.ipv4 ||
      (expectedNetworkId != null &&
        instance.networkId !== expectedNetworkId)
    ) {
      throw new Error("provider_resource_not_ready");
    }
    const currentState = order.productFlowState;
    if (currentState === "PROVISIONING") {
      await transitionProductFlowTx(tx, {
        owner: owner(order),
        from: "PROVISIONING",
        to: "HEALTH_CHECKING",
        reason: "provider_resource_active",
        idempotencyKey: `health-start:${order.id}:${instance.providerInstanceId}`,
      });
    } else if (currentState === "HEALTH_CHECK_FAILED") {
      await transitionProductFlowTx(tx, {
        owner: owner(order),
        from: "HEALTH_CHECK_FAILED",
        to: "HEALTH_CHECKING",
        reason: "health_check_retry",
        idempotencyKey: `health-retry:${order.id}:${Date.now()}`,
      });
    } else if (currentState !== "HEALTH_CHECKING") {
      throw new Error("health_check_state_conflict");
    }
    const prior = await tx.infrastructureHealthCheck.count({
      where: { infrastructureOrderId: order.id },
    });
    const check = await tx.infrastructureHealthCheck.create({
      data: {
        infrastructureOrderId: order.id,
        cloudInstanceId: instance.id,
        attempt: prior + 1,
        status: InfrastructureHealthCheckStatus.RUNNING,
        providerState: instance.providerState,
        expectedIpv4: instance.ipv4,
        observedIpv4: instance.ipv4,
        expectedNetworkId,
        connectivityProtocol: instance.image
          .toLowerCase()
          .includes("windows")
          ? "tcp:3389"
          : "tcp:22",
      },
    });
    return {
      order,
      instance,
      check,
      port: instance.image.toLowerCase().includes("windows") ? 3389 : 22,
    };
  });

  const startedAt = Date.now();
  let reachable = false;
  let attemptsUsed = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attemptsUsed = attempt;
    reachable = await probe({
      host: prepared.instance.ipv4!,
      port: prepared.port,
      timeoutMs: CONNECT_TIMEOUT_MS,
      attempt,
    });
    if (reachable) break;
  }

  return prisma.$transaction(async (tx) => {
    const order = await tx.infrastructureOrder.findUniqueOrThrow({
      where: { id: prepared.order.id },
      include: {
        cloudInstance: { include: { credential: true } },
        serviceOrder: { include: { recommendationQuote: true } },
      },
    });
    const instance = order.cloudInstance!;
    await tx.infrastructureHealthCheck.update({
      where: { id: prepared.check.id },
      data: {
        status: reachable
          ? InfrastructureHealthCheckStatus.SUCCEEDED
          : InfrastructureHealthCheckStatus.FAILED,
        resultCode: reachable ? "port_reachable" : "port_unreachable",
        durationMs: Date.now() - startedAt,
        finishedAt: new Date(),
        metadata: { attempts: attemptsUsed, containsSecret: false },
      },
    });
    if (!reachable) {
      await transitionProductFlowTx(tx, {
        owner: owner(order),
        from: "HEALTH_CHECKING",
        to: "HEALTH_CHECK_FAILED",
        reason: "connectivity_check_failed",
        idempotencyKey: `health-failed:${prepared.check.id}`,
      });
      return { healthy: false as const, delivered: false as const };
    }

    await tx.cloudInstance.update({
      where: { id: instance.id },
      data: { healthCheckedAt: new Date() },
    });
    await transitionProductFlowTx(tx, {
      owner: owner(order),
      from: "HEALTH_CHECKING",
      to: "DELIVERED",
      reason: "health_check_succeeded",
      idempotencyKey: `health-succeeded:${prepared.check.id}`,
    });
    if (instance.credential?.status === "READY") {
      await activateDeliveredServiceTx(tx, order.id);
      return { healthy: true as const, delivered: true as const };
    }
    await tx.secureDeliveryEvent.create({
      data: {
        infrastructureOrderId: order.id,
        cloudInstanceId: instance.id,
        status: SecureDeliveryStatus.PENDING,
        method: "ONE_TIME_ENCRYPTED_CREDENTIAL",
        resultCode: "credential_required",
        metadata: { containsSecret: false },
      },
    });
    await transitionProductFlowTx(tx, {
      owner: owner(order),
      from: "DELIVERED",
      to: "DELIVERY_RETRYABLE",
      reason: "secure_delivery_pending",
      idempotencyKey: `delivery-pending:${prepared.check.id}`,
    });
    return { healthy: true as const, delivered: false as const };
  });
}
