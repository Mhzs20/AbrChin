import { connect } from "node:net";

import {
  AdminNotificationType,
  CloudInstanceStatus,
  InfrastructureHealthCheckStatus,
  InfrastructureOrderStatus,
  InfrastructureProvider,
  SecureDeliveryStatus,
  SubscriptionStatus,
  type Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import type { ProviderTopologyVerificationMode } from "@/lib/infrastructure/cloud-provider-adapter";
import {
  assertProvisioningJobFenceTx,
  type ProvisioningJobFence,
  WorkerLeaseLostError,
} from "@/lib/infrastructure/worker-fence";
import { transitionProductFlowTx } from "@/lib/product-flow/service";
import { addBillingMonth, addGracePeriod } from "@/lib/subscriptions/period";

const CONNECT_TIMEOUT_MS = 3_000;
const MAX_CONNECT_ATTEMPTS = 3;

export function assessProviderObservation(input: {
  topologyVerificationMode: ProviderTopologyVerificationMode;
  providerState: string | null;
  ipv4: string | null;
  providerObservedAt: Date | null;
  expectedNetworkId: string | null;
  observedNetworkId: string | null;
  expectedSecurityId: string | null;
  observedSecurityId: string | null;
}) {
  if (input.providerState?.toLowerCase() !== "active") {
    return { ready: false as const, code: "provider_state_not_active" };
  }
  if (!input.ipv4) {
    return { ready: false as const, code: "provider_ipv4_missing" };
  }
  if (!input.providerObservedAt) {
    return { ready: false as const, code: "provider_observation_missing" };
  }
  if (input.topologyVerificationMode === "PROVIDER_MANAGED") {
    return {
      ready: true as const,
      code: "provider_managed_topology_verified",
    };
  }
  if (
    input.expectedNetworkId == null ||
    input.observedNetworkId !== input.expectedNetworkId
  ) {
    return { ready: false as const, code: "provider_network_mismatch" };
  }
  if (
    input.expectedSecurityId == null ||
    input.observedSecurityId !== input.expectedSecurityId
  ) {
    return { ready: false as const, code: "provider_security_mismatch" };
  }
  return { ready: true as const, code: "provider_observation_verified" };
}

export type ConnectivityProbe = (input: {
  host: string;
  port: number;
  timeoutMs: number;
  attempt: number;
}) => Promise<boolean>;

export type DurableHealthResult = {
  healthCheckId: string;
  healthy: boolean;
  delivered: boolean;
  resultCode: string;
};

export function parseDurableHealthResult(
  value: Prisma.JsonValue | null | undefined,
): DurableHealthResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  return typeof row.healthCheckId === "string" &&
    typeof row.healthy === "boolean" &&
    typeof row.delivered === "boolean" &&
    typeof row.resultCode === "string"
    ? {
        healthCheckId: row.healthCheckId,
        healthy: row.healthy,
        delivered: row.delivered,
        resultCode: row.resultCode,
      }
    : null;
}

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

export function resolveTopologyVerificationMode(input: {
  provider: InfrastructureProvider;
  snapshot: Prisma.JsonValue | null;
}): ProviderTopologyVerificationMode {
  const selection = asSelection(input.snapshot);
  const delivery = asSelection(
    (selection.deliveryConfiguration ?? null) as Prisma.JsonValue | null,
  );
  const explicit =
    selection.topologyVerificationMode ??
    delivery.topologyVerificationMode;
  const expected =
    input.provider === InfrastructureProvider.PARSPACK
      ? "PROVIDER_MANAGED"
      : "STRICT_OBSERVED";
  if (explicit != null && explicit !== expected) {
    throw new Error("provider_topology_mode_conflict");
  }
  return expected;
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

function deliveryAccessMethod(value: Prisma.JsonValue | null) {
  const selection = asSelection(value);
  const delivery = asSelection(
    (selection.deliveryConfiguration ?? null) as Prisma.JsonValue | null,
  );
  const method = delivery.accessMethod;
  return method === "SSH_KEY" ||
    method === "ONE_TIME_PASSWORD" ||
    method === "WINDOWS_PASSWORD"
    ? method
    : null;
}

async function queueHealthRetryDispatchTx(
  tx: Prisma.TransactionClient,
  input: {
    infrastructureOrderId: string;
    sourceHealthCheckId: string;
  },
) {
  return tx.healthRetryDispatch.upsert({
    where: {
      idempotencyKey: `health-retry-dispatch:${input.sourceHealthCheckId}`,
    },
    update: {},
    create: {
      idempotencyKey: `health-retry-dispatch:${input.sourceHealthCheckId}`,
      infrastructureOrderId: input.infrastructureOrderId,
      sourceHealthCheckId: input.sourceHealthCheckId,
    },
  });
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
  const accessMethod = deliveryAccessMethod(
    order.providerSelectionSnapshot,
  );
  const needsPasswordCredential =
    accessMethod === "ONE_TIME_PASSWORD" ||
    accessMethod === "WINDOWS_PASSWORD";
  if (
    !instance ||
    !instance.ipv4 ||
    !instance.healthCheckedAt ||
    !accessMethod ||
    (needsPasswordCredential &&
      (!instance.credential ||
        instance.credential.status !== "READY"))
  ) {
    throw new Error("secure_delivery_not_ready");
  }
  const deliveryIdentity =
    accessMethod === "SSH_KEY"
      ? `ssh:${order.id}`
      : instance.credential?.id ?? "missing-credential";
  const currentState = order.productFlowState;
  if (currentState === "DELIVERY_RETRYABLE") {
    await transitionProductFlowTx(tx, {
      owner: owner(order),
      from: "DELIVERY_RETRYABLE",
      to: "DELIVERED",
      reason: "secure_delivery_recovered",
      idempotencyKey: `secure-delivery-recovered:${order.id}:${deliveryIdentity}`,
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
      method:
        accessMethod === "SSH_KEY"
          ? "SSH_KEY_NON_SECRET"
          : "ONE_TIME_ENCRYPTED_CREDENTIAL",
      resultCode:
        accessMethod === "SSH_KEY"
          ? "ssh_key_locked"
          : "credential_ready",
      deliveredAt,
      metadata: {
        credentialId: instance.credential?.id ?? null,
        accessMethod,
        containsSecret: false,
      },
    },
  });
  await transitionProductFlowTx(tx, {
    owner: owner(order),
    from: "DELIVERED",
    to: "ACTIVE",
    reason: "secure_delivery_completed",
    idempotencyKey: `service-active:${order.id}:${deliveryIdentity}`,
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
  await tx.provisioningNotificationOutbox.upsert({
    where: { idempotencyKey: `instance-active:${order.id}` },
    update: {},
    create: {
      idempotencyKey: `instance-active:${order.id}`,
      type: AdminNotificationType.INSTANCE_ACTIVE,
      infrastructureOrderId: order.id,
      title: "سرور فعال شد",
      message: `سرور سفارش ${order.serviceOrder.title} آماده است.`,
    },
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
  afterTransition?: () => void | Promise<void>;
  retryTransition?: {
    idempotencyKey: string;
    actorUserId?: string | null;
    from?:
      | "HEALTH_CHECK_FAILED"
      | "PROVISIONING_MANUAL_REVIEW";
    reason?: string;
  };
  workerFence?: ProvisioningJobFence;
  durableJob?: {
    jobId: string;
    workerFence: ProvisioningJobFence;
    automaticRetryDispatch?: boolean;
  };
}) {
  const probe = input.probe ?? tcpConnectivityProbe;
  const maxAttempts = Math.min(
    Math.max(input.maxAttempts ?? MAX_CONNECT_ATTEMPTS, 1),
    MAX_CONNECT_ATTEMPTS,
  );
  const prepared = await prisma.$transaction(async (tx) => {
    if (input.workerFence) {
      await assertProvisioningJobFenceTx(tx, input.workerFence);
    }
    const order = await tx.infrastructureOrder.findUniqueOrThrow({
      where: { id: input.infrastructureOrderId },
      include: {
        cloudInstance: { include: { credential: true } },
        serviceOrder: { include: { recommendationQuote: true } },
      },
    });
    const instance = order.cloudInstance;
    const selection = asSelection(order.providerSelectionSnapshot);
    const topologyVerificationMode =
      resolveTopologyVerificationMode({
        provider: order.provider,
        snapshot: order.providerSelectionSnapshot,
      });
    const expectedNetworkId =
      topologyVerificationMode === "STRICT_OBSERVED" &&
      typeof selection.externalNetworkId === "string"
        ? selection.externalNetworkId
        : null;
    const expectedSecurityId =
      topologyVerificationMode === "STRICT_OBSERVED" &&
      typeof selection.externalSecurityId === "string"
        ? selection.externalSecurityId
        : null;
    if (!instance) throw new Error("provider_resource_not_ready");
    const currentState = order.productFlowState;
    if (currentState === "PROVISIONING") {
      await transitionProductFlowTx(tx, {
        owner: owner(order),
        from: "PROVISIONING",
        to: "HEALTH_CHECKING",
        reason: "provider_resource_active",
        idempotencyKey: `health-start:${order.id}:${instance.providerInstanceId}`,
      });
    } else if (
      currentState === "HEALTH_CHECK_FAILED" ||
      currentState === "PROVISIONING_MANUAL_REVIEW"
    ) {
      if (!input.retryTransition?.idempotencyKey) {
        throw new Error("health_retry_context_required");
      }
      const retryFrom =
        input.retryTransition.from ?? "HEALTH_CHECK_FAILED";
      if (retryFrom !== currentState) {
        throw new Error("health_retry_state_conflict");
      }
      await transitionProductFlowTx(tx, {
        owner: owner(order),
        from: retryFrom,
        to: "HEALTH_CHECKING",
        reason:
          input.retryTransition.reason ?? "health_check_retry",
        idempotencyKey: input.retryTransition.idempotencyKey,
        actorUserId: input.retryTransition.actorUserId ?? null,
      });
    } else if (currentState !== "HEALTH_CHECKING") {
      throw new Error("health_check_state_conflict");
    }
    const durableJob = input.durableJob
      ? await tx.provisioningJob.findUniqueOrThrow({
          where: { id: input.durableJob.jobId },
          select: { healthCheckId: true },
        })
      : null;
    let check = durableJob?.healthCheckId
      ? await tx.infrastructureHealthCheck.findUnique({
          where: { id: durableJob.healthCheckId },
        })
      : null;
    if (check && check.status !== InfrastructureHealthCheckStatus.RUNNING) {
      throw new Error("durable_health_result_requires_finalize");
    }
    if (!check) {
      const prior = await tx.infrastructureHealthCheck.count({
        where: { infrastructureOrderId: order.id },
      });
      check = await tx.infrastructureHealthCheck.create({
        data: {
          infrastructureOrderId: order.id,
          cloudInstanceId: instance.id,
          attempt: prior + 1,
          status: InfrastructureHealthCheckStatus.RUNNING,
          providerState: instance.providerState,
          expectedIpv4: instance.ipv4,
          observedIpv4: instance.ipv4,
          expectedNetworkId,
          observedNetworkId: instance.networkId,
          expectedSecurityId,
          observedSecurityId: instance.securityId,
          topologyVerificationMode,
          providerObservedAt: instance.providerObservedAt,
          connectivityProtocol: instance.image
            .toLowerCase()
            .includes("windows")
            ? "tcp:3389"
            : "tcp:22",
        },
      });
      if (input.durableJob) {
        const linked = await tx.provisioningJob.updateMany({
          where: {
            id: input.durableJob.jobId,
            status: "RUNNING",
            claimToken: input.durableJob.workerFence.claimToken,
            leaseExpiresAt: { gt: new Date() },
          },
          data: {
            phase: "HEALTH",
            healthCheckId: check.id,
          },
        });
        if (linked.count !== 1) {
          throw new WorkerLeaseLostError();
        }
      }
    }
    const observation = assessProviderObservation({
      topologyVerificationMode,
      providerState: instance.providerState,
      ipv4: instance.ipv4,
      providerObservedAt: instance.providerObservedAt,
      expectedNetworkId,
      observedNetworkId: instance.networkId,
      expectedSecurityId,
      observedSecurityId: instance.securityId,
    });
    return {
      order,
      instance,
      check,
      port: instance.image.toLowerCase().includes("windows") ? 3389 : 22,
      providerContractReady: observation.ready,
      providerObservationCode: observation.code,
      topologyVerificationMode,
    };
  });

  try {
    await input.afterTransition?.();
  } catch (error) {
    await prisma.$transaction(async (tx) => {
      if (input.workerFence) {
        await assertProvisioningJobFenceTx(tx, input.workerFence);
      }
      const order = await tx.infrastructureOrder.findUniqueOrThrow({
        where: { id: prepared.order.id },
        include: {
          serviceOrder: { include: { recommendationQuote: true } },
        },
      });
      await tx.infrastructureHealthCheck.updateMany({
        where: {
          id: prepared.check.id,
          status: InfrastructureHealthCheckStatus.RUNNING,
        },
        data: {
          status: InfrastructureHealthCheckStatus.FAILED,
          resultCode: "health_execution_failed",
          finishedAt: new Date(),
          metadata: {
            containsSecret: false,
            topologyVerificationMode:
              prepared.topologyVerificationMode,
            failurePhase: "after_transition",
          },
        },
      });
      if (order.productFlowState === "HEALTH_CHECKING") {
        await transitionProductFlowTx(tx, {
          owner: owner(order),
          from: "HEALTH_CHECKING",
          to: "HEALTH_CHECK_FAILED",
          reason: "health_execution_failed",
          idempotencyKey:
            `health-execution-failed:${prepared.check.id}`,
        });
      }
      if (input.durableJob) {
        const result: DurableHealthResult = {
          healthCheckId: prepared.check.id,
          healthy: false,
          delivered: false,
          resultCode: "health_execution_failed",
        };
        const persisted = await tx.provisioningJob.updateMany({
          where: {
            id: input.durableJob.jobId,
            status: "RUNNING",
            claimToken: input.durableJob.workerFence.claimToken,
            leaseExpiresAt: { gt: new Date() },
          },
          data: {
            phase: "HEALTH_RESULT_PERSISTED",
            healthResultSnapshot:
              result as unknown as Prisma.InputJsonValue,
            healthResultPersistedAt: new Date(),
          },
        });
        if (persisted.count !== 1) {
          throw new WorkerLeaseLostError();
        }
        if (input.durableJob.automaticRetryDispatch !== false) {
          await queueHealthRetryDispatchTx(tx, {
            infrastructureOrderId: order.id,
            sourceHealthCheckId: prepared.check.id,
          });
        }
      }
    });
    throw error;
  }

  const startedAt = Date.now();
  if (!prepared.providerContractReady) {
    return prisma.$transaction(async (tx) => {
      if (input.workerFence) {
        await assertProvisioningJobFenceTx(tx, input.workerFence);
      }
      const order = await tx.infrastructureOrder.findUniqueOrThrow({
        where: { id: prepared.order.id },
        include: {
          serviceOrder: { include: { recommendationQuote: true } },
        },
      });
      await tx.infrastructureHealthCheck.update({
        where: { id: prepared.check.id },
        data: {
          status: InfrastructureHealthCheckStatus.FAILED,
          resultCode: prepared.providerObservationCode,
          durationMs: Date.now() - startedAt,
          finishedAt: new Date(),
          metadata: {
            containsSecret: false,
            topologyVerificationMode:
              prepared.topologyVerificationMode,
            observationCode: prepared.providerObservationCode,
          },
        },
      });
      await transitionProductFlowTx(tx, {
        owner: owner(order),
        from: "HEALTH_CHECKING",
        to: "HEALTH_CHECK_FAILED",
        reason: prepared.providerObservationCode,
        idempotencyKey: `health-observation-failed:${prepared.check.id}`,
      });
      const result: DurableHealthResult = {
        healthCheckId: prepared.check.id,
        healthy: false,
        delivered: false,
        resultCode: prepared.providerObservationCode,
      };
      if (input.durableJob) {
        const persisted = await tx.provisioningJob.updateMany({
          where: {
            id: input.durableJob.jobId,
            status: "RUNNING",
            claimToken: input.durableJob.workerFence.claimToken,
            leaseExpiresAt: { gt: new Date() },
          },
          data: {
            phase: "HEALTH_RESULT_PERSISTED",
            healthResultSnapshot:
              result as unknown as Prisma.InputJsonValue,
            healthResultPersistedAt: new Date(),
          },
        });
        if (persisted.count !== 1) {
          throw new WorkerLeaseLostError();
        }
        if (input.durableJob.automaticRetryDispatch !== false) {
          await queueHealthRetryDispatchTx(tx, {
            infrastructureOrderId: order.id,
            sourceHealthCheckId: prepared.check.id,
          });
        }
      }
      return { healthy: false as const, delivered: false as const };
    });
  }
  let reachable = false;
  let attemptsUsed = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attemptsUsed = attempt;
    try {
      reachable = await probe({
        host: prepared.instance.ipv4!,
        port: prepared.port,
        timeoutMs: CONNECT_TIMEOUT_MS,
        attempt,
      });
    } catch {
      reachable = false;
    }
    if (reachable) break;
  }

  return prisma.$transaction(async (tx) => {
    if (input.workerFence) {
      await assertProvisioningJobFenceTx(tx, input.workerFence);
    }
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
        metadata: {
          attempts: attemptsUsed,
          containsSecret: false,
          topologyVerificationMode:
            prepared.topologyVerificationMode,
          observationCode: prepared.providerObservationCode,
        },
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
      const result: DurableHealthResult = {
        healthCheckId: prepared.check.id,
        healthy: false,
        delivered: false,
        resultCode: "port_unreachable",
      };
      if (input.durableJob) {
        const persisted = await tx.provisioningJob.updateMany({
          where: {
            id: input.durableJob.jobId,
            status: "RUNNING",
            claimToken: input.durableJob.workerFence.claimToken,
            leaseExpiresAt: { gt: new Date() },
          },
          data: {
            phase: "HEALTH_RESULT_PERSISTED",
            healthResultSnapshot:
              result as unknown as Prisma.InputJsonValue,
            healthResultPersistedAt: new Date(),
          },
        });
        if (persisted.count !== 1) {
          throw new WorkerLeaseLostError();
        }
        if (input.durableJob.automaticRetryDispatch !== false) {
          await queueHealthRetryDispatchTx(tx, {
            infrastructureOrderId: order.id,
            sourceHealthCheckId: prepared.check.id,
          });
        }
      }
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
    const accessMethod = deliveryAccessMethod(
      order.providerSelectionSnapshot,
    );
    if (
      accessMethod === "SSH_KEY" ||
      instance.credential?.status === "READY"
    ) {
      await activateDeliveredServiceTx(tx, order.id);
      if (input.durableJob) {
        const result: DurableHealthResult = {
          healthCheckId: prepared.check.id,
          healthy: true,
          delivered: true,
          resultCode: "service_active",
        };
        const persisted = await tx.provisioningJob.updateMany({
          where: {
            id: input.durableJob.jobId,
            status: "RUNNING",
            claimToken: input.durableJob.workerFence.claimToken,
            leaseExpiresAt: { gt: new Date() },
          },
          data: {
            phase: "HEALTH_RESULT_PERSISTED",
            healthResultSnapshot:
              result as unknown as Prisma.InputJsonValue,
            healthResultPersistedAt: new Date(),
          },
        });
        if (persisted.count !== 1) {
          throw new WorkerLeaseLostError();
        }
      }
      return { healthy: true as const, delivered: true as const };
    }
    await tx.secureDeliveryEvent.create({
      data: {
        infrastructureOrderId: order.id,
        cloudInstanceId: instance.id,
        status: SecureDeliveryStatus.PENDING,
        method: "ONE_TIME_ENCRYPTED_CREDENTIAL",
        resultCode: "password_credential_required",
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
    if (input.durableJob) {
      const result: DurableHealthResult = {
        healthCheckId: prepared.check.id,
        healthy: true,
        delivered: false,
        resultCode: "secure_delivery_pending",
      };
      const persisted = await tx.provisioningJob.updateMany({
        where: {
          id: input.durableJob.jobId,
          status: "RUNNING",
          claimToken: input.durableJob.workerFence.claimToken,
          leaseExpiresAt: { gt: new Date() },
        },
        data: {
          phase: "HEALTH_RESULT_PERSISTED",
          healthResultSnapshot:
            result as unknown as Prisma.InputJsonValue,
          healthResultPersistedAt: new Date(),
        },
      });
      if (persisted.count !== 1) {
        throw new WorkerLeaseLostError();
      }
    }
    return { healthy: true as const, delivered: false as const };
  });
}
