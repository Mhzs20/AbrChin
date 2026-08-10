import {
  CloudInstanceStatus,
  LedgerDirection,
  LedgerStatus,
  LedgerType,
  Prisma,
  ProductBillingModel,
  ResourceChangeStatus,
  ResourceVersionState,
  ServiceOrderStatus,
  SubscriptionStatus,
  WalletStatus,
} from "@prisma/client";

import { postPrepaidCancellationRefund } from "@/lib/accounting/posting";
import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { recordProviderConfirmedResourceVersion } from "@/lib/billing/resource-timeline";
import { prisma } from "@/lib/db";
import { createCloudProviderAdapter } from "@/lib/infrastructure/provider-factory";
import {
  computePrepaidCancellationPreview,
  serializePrepaidCancellationPreview,
} from "@/lib/orders/prepaid-cancellation";
import { getEnv } from "@/lib/env";
import { WalletError } from "@/lib/wallet/errors";
import { ensureWalletForUser } from "@/lib/wallet/ensure-wallet";

export type CustomerCancelLifecycle =
  | "CANCEL_REQUESTED"
  | "TERMINATING"
  | "TERMINATED"
  | "REFUND_CREDITED"
  | "TERMINATION_FAILED";

function cancelIdempotencyKey(instanceId: string, userId: string) {
  return `customer-cancel:${instanceId}:${userId}`;
}

function refundIdempotencyKey(orderId: string) {
  return `order_cancel_refund_${orderId}`;
}

function mutationsEnabledFor(provider: "ARVAN" | "PARSPACK") {
  const env = getEnv();
  return provider === "ARVAN"
    ? env.arvanMutationsEnabled === true
    : env.parspackMutationsEnabled === true;
}

async function loadCancelContext(instanceId: string, userId: string) {
  const instance = await prisma.cloudInstance.findFirst({
    where: { id: instanceId, userId },
    include: {
      subscription: true,
      infrastructureOrder: {
        include: {
          serviceOrder: {
            include: {
              plan: { select: { billingModel: true, title: true } },
            },
          },
          plan: true,
        },
      },
    },
  });
  if (!instance) {
    throw new WalletError("not_found", "سرور پیدا نشد.");
  }
  const order = instance.infrastructureOrder.serviceOrder;
  const plan = instance.infrastructureOrder.plan;
  if (plan.billingModel === ProductBillingModel.PAYG_WALLET) {
    throw new WalletError(
      "payg_cancel_not_supported",
      "بازگشت وجه برای مصرف PAYG پس از مصرف اعمال نمی‌شود؛ از پشتیبانی استفاده کن.",
    );
  }
  if (order.status !== ServiceOrderStatus.PAID) {
    throw new WalletError(
      "cancel_not_eligible",
      "فقط سفارش پرداخت‌شدهٔ دوره‌ای قابل لغو با بازگشت اعتبار است.",
    );
  }
  const subscription = instance.subscription;
  if (!subscription) {
    throw new WalletError(
      "cancel_not_eligible",
      "اشتراک دوره‌ای برای این سرور پیدا نشد.",
    );
  }
  return { instance, order, plan, subscription };
}

export async function previewCustomerServiceCancellation(input: {
  instanceId: string;
  userId: string;
  asOf?: Date;
}) {
  const { instance, order, subscription } = await loadCancelContext(
    input.instanceId,
    input.userId,
  );
  if (
    instance.status === CloudInstanceStatus.TERMINATED &&
    subscription.status === SubscriptionStatus.TERMINATED
  ) {
    const existing = await prisma.walletLedgerEntry.findUnique({
      where: { idempotencyKey: refundIdempotencyKey(order.id) },
    });
    if (existing) {
      throw new WalletError(
        "already_canceled",
        "این سرویس قبلاً لغو و اعتبار آن به کیف پول برگشته است.",
      );
    }
  }
  if (
    instance.status !== CloudInstanceStatus.ACTIVE &&
    instance.status !== CloudInstanceStatus.TERMINATED
  ) {
    throw new WalletError(
      "cancel_not_eligible",
      "لغو فقط برای سرور فعال یا خاتمه‌یافتهٔ در انتظار بازگشت اعتبار ممکن است.",
    );
  }

  const wallet = await ensureWalletForUser(input.userId);
  const serviceStartedAt =
    subscription.currentPeriodStart ??
    instance.deliveredAt ??
    instance.provisionedAt ??
    order.paidAt ??
    order.createdAt;

  const preview = computePrepaidCancellationPreview({
    originalPaidRial: order.amount,
    termMonths: subscription.termMonths || order.termMonths || 1,
    serviceStartedAt,
    asOf: input.asOf,
    walletBalanceRial: wallet.availableBalance,
  });

  const openRequest = await prisma.resourceChangeRequest.findFirst({
    where: {
      cloudInstanceId: instance.id,
      requestedById: input.userId,
      status: {
        notIn: [
          ResourceChangeStatus.CANCELED,
          ResourceChangeStatus.APPLIED,
        ],
      },
    },
    orderBy: { requestedAt: "desc" },
  });
  const openIsTerminate =
    openRequest &&
    openRequest.requestedResources &&
    typeof openRequest.requestedResources === "object" &&
    !Array.isArray(openRequest.requestedResources) &&
    (openRequest.requestedResources as Record<string, unknown>).action ===
      "TERMINATE"
      ? openRequest
      : null;

  return {
    instanceId: instance.id,
    orderId: order.id,
    serverName: instance.name,
    lifecycle: mapLifecycle({
      instanceStatus: instance.status,
      requestStatus: openIsTerminate?.status ?? null,
      refunded: false,
    }),
    preview,
    publicPreview: serializePrepaidCancellationPreview(preview),
  };
}

function mapLifecycle(input: {
  instanceStatus: CloudInstanceStatus;
  requestStatus: ResourceChangeStatus | null;
  refunded: boolean;
}): CustomerCancelLifecycle {
  if (input.refunded) return "REFUND_CREDITED";
  if (input.instanceStatus === CloudInstanceStatus.TERMINATED) {
    return "TERMINATED";
  }
  if (
    input.requestStatus === ResourceChangeStatus.PROVIDER_MUTATION_PENDING ||
    input.requestStatus === ResourceChangeStatus.APPROVED
  ) {
    return "TERMINATING";
  }
  if (
    input.requestStatus === ResourceChangeStatus.WAITING_ADMIN_APPROVAL ||
    input.requestStatus === ResourceChangeStatus.REQUESTED
  ) {
    return "CANCEL_REQUESTED";
  }
  // Open cancel without a known request status still means cancel requested;
  // subscription.CANCELED is not used at request time — that status would
  // falsely imply termination already completed before provider confirmation.
  return "CANCEL_REQUESTED";
}

export async function requestCustomerServiceCancellation(input: {
  instanceId: string;
  userId: string;
  reason?: string;
  idempotencyKey?: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const previewed = await previewCustomerServiceCancellation({
    instanceId: input.instanceId,
    userId: input.userId,
  });
  const { instance, order, subscription } = await loadCancelContext(
    input.instanceId,
    input.userId,
  );

  const key =
    input.idempotencyKey?.trim() ||
    cancelIdempotencyKey(instance.id, input.userId);

  const existing = await prisma.resourceChangeRequest.findUnique({
    where: { idempotencyKey: key },
  });
  if (
    existing &&
    existing.status !== ResourceChangeStatus.CANCELED &&
    existing.status !== ResourceChangeStatus.APPLIED
  ) {
    return {
      reused: true,
      requestId: existing.id,
      lifecycle: mapLifecycle({
        instanceStatus: instance.status,
        requestStatus: existing.status,
        refunded: false,
      }),
      preview: previewed.publicPreview,
      refund: null as null,
    };
  }

  const reason =
    input.reason?.trim() ||
    "لغو سرویس توسط مشتری و بازگشت اعتبار استفاده‌نشده به کیف پول";

  const created = await prisma.$transaction(async (tx) => {
    // Cancel REQUEST must not mark the subscription CANCELED/TERMINATED.
    // CANCELED would stop renewals AND present the service as already canceled
    // before provider termination is confirmed. Disable autoRenew + stamp
    // canceledAt as intent; terminal status is set only after confirmed
    // termination (see completeCancellationAfterTermination → TERMINATED).
    await tx.serviceSubscription.update({
      where: { id: subscription.id },
      data: {
        canceledAt: subscription.canceledAt ?? new Date(),
        autoRenew: false,
      },
    });
    await tx.parchinEnrollment.updateMany({
      where: { subscriptionId: subscription.id },
      data: { status: "CANCELED", endedAt: new Date() },
    });

    const request = await tx.resourceChangeRequest.create({
      data: {
        cloudInstanceId: instance.id,
        planId: instance.infrastructureOrder.planId,
        requestedById: input.userId,
        requestedResources: {
          action: "TERMINATE",
          source: "CUSTOMER_CANCEL",
          providerMutationExecuted: false,
          orderId: order.id,
        },
        estimateSnapshot: {
          action: "TERMINATE",
          refundPreview: previewed.publicPreview,
          reason,
          lockedAt: new Date().toISOString(),
        },
        incrementalBufferRial: 0n,
        status: ResourceChangeStatus.WAITING_ADMIN_APPROVAL,
        idempotencyKey: existing ? `${key}:${Date.now()}` : key,
      },
    });

    await writeAuditLog(
      {
        actorUserId: input.userId,
        action: AuditActions.RESOURCE_CHANGE_REQUESTED,
        entityType: "ResourceChangeRequest",
        entityId: request.id,
        afterData: {
          action: "TERMINATE",
          lifecycle: "CANCEL_REQUESTED",
          refundPreview: previewed.publicPreview,
          reason,
        },
        ip: input.ip,
        userAgent: input.userAgent,
        idempotencyKey: `audit:customer-cancel:${request.id}`,
      },
      tx,
    );

    return request;
  });

  let lifecycle: CustomerCancelLifecycle = "CANCEL_REQUESTED";
  let terminationError: string | null = null;
  let refund: {
    reused: boolean;
    ledgerEntryId: string | null;
    amountRial: string;
    balanceAfterRial: string;
    createdAt: string;
    orderId: string;
  } | null = null;

  // When mutation gate is open, attempt provider termination immediately.
  if (
    instance.status === CloudInstanceStatus.ACTIVE &&
    mutationsEnabledFor(instance.provider)
  ) {
    try {
      await prisma.resourceChangeRequest.update({
        where: { id: created.id },
        data: { status: ResourceChangeStatus.PROVIDER_MUTATION_PENDING },
      });
      lifecycle = "TERMINATING";
      const adapter = createCloudProviderAdapter(
        instance.provider,
        instance.providerApiVersion,
      );
      await adapter.terminate({
        region: instance.region,
        resourceId: instance.providerInstanceId,
        idempotencyKey: `customer-terminate:${created.id}`,
      });
      refund = await completeCancellationAfterTermination({
        resourceChangeRequestId: created.id,
        actorUserId: input.userId,
        reason,
        ip: input.ip,
        userAgent: input.userAgent,
      });
      lifecycle = "REFUND_CREDITED";
    } catch (error) {
      terminationError =
        error instanceof Error ? error.message : "termination_failed";
      lifecycle = "TERMINATION_FAILED";
      await prisma.resourceChangeRequest.update({
        where: { id: created.id },
        data: {
          status: ResourceChangeStatus.WAITING_ADMIN_APPROVAL,
          estimateSnapshot: {
            action: "TERMINATE",
            refundPreview: previewed.publicPreview,
            reason,
            terminationFailed: true,
            terminationError,
            lockedAt: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
    }
  } else if (instance.status === CloudInstanceStatus.TERMINATED) {
    refund = await completeCancellationAfterTermination({
      resourceChangeRequestId: created.id,
      actorUserId: input.userId,
      reason,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    lifecycle = "REFUND_CREDITED";
  }

  return {
    reused: false,
    requestId: created.id,
    lifecycle,
    preview: previewed.publicPreview,
    refund,
    terminationError,
  };
}

export async function completeCancellationAfterTermination(input: {
  resourceChangeRequestId: string;
  actorUserId: string;
  reason: string;
  ip?: string | null;
  userAgent?: string | null;
  /** When admin fulfills manually, resource quantities for the terminal version. */
  terminalResources?: {
    vcpu: number;
    ramMb: number;
    diskGb: number;
  };
}) {
  const change = await prisma.resourceChangeRequest.findUnique({
    where: { id: input.resourceChangeRequestId },
    include: {
      cloudInstance: {
        include: {
          subscription: true,
          infrastructureOrder: {
            include: {
              serviceOrder: true,
              plan: true,
            },
          },
        },
      },
    },
  });
  if (!change) {
    throw new WalletError("not_found", "درخواست لغو پیدا نشد.");
  }

  const action =
    change.requestedResources &&
    typeof change.requestedResources === "object" &&
    !Array.isArray(change.requestedResources)
      ? (change.requestedResources as Record<string, unknown>).action
      : null;
  if (action !== "TERMINATE") {
    throw new WalletError(
      "cancel_not_eligible",
      "این درخواست لغو سرویس نیست.",
    );
  }

  const instance = change.cloudInstance;
  const order = instance.infrastructureOrder.serviceOrder;
  const subscription = instance.subscription;
  if (!subscription) {
    throw new WalletError("cancel_not_eligible", "اشتراک پیدا نشد.");
  }
  if (
    instance.infrastructureOrder.plan.billingModel ===
    ProductBillingModel.PAYG_WALLET
  ) {
    throw new WalletError(
      "payg_cancel_not_supported",
      "بازگشت وجه PAYG پس از مصرف مجاز نیست.",
    );
  }

  const estimate =
    change.estimateSnapshot &&
    typeof change.estimateSnapshot === "object" &&
    !Array.isArray(change.estimateSnapshot)
      ? (change.estimateSnapshot as Record<string, unknown>)
      : {};
  const lockedPreview = estimate.refundPreview as
    | Record<string, string>
    | undefined;

  let refundableRial = lockedPreview?.refundableRial
    ? BigInt(lockedPreview.refundableRial)
    : null;
  if (refundableRial == null) {
    const wallet = await ensureWalletForUser(instance.userId);
    const preview = computePrepaidCancellationPreview({
      originalPaidRial: order.amount,
      termMonths: subscription.termMonths || order.termMonths || 1,
      serviceStartedAt:
        subscription.currentPeriodStart ??
        instance.deliveredAt ??
        instance.provisionedAt ??
        order.paidAt ??
        order.createdAt,
      walletBalanceRial: wallet.availableBalance,
    });
    refundableRial = preview.refundableRial;
  }

  const resources = input.terminalResources ?? {
    vcpu: instance.infrastructureOrder.plan.vcpu ?? 1,
    ramMb: (instance.infrastructureOrder.plan.ramGb ?? 1) * 1024,
    diskGb: instance.infrastructureOrder.plan.storageGb ?? 0,
  };

  // Timeline termination is its own serializable transaction.
  await recordProviderConfirmedResourceVersion({
    cloudInstanceId: instance.id,
    planId: change.planId,
    state: ResourceVersionState.TERMINATED,
    resources: {
      vcpu: resources.vcpu,
      ramMb: resources.ramMb,
      diskGb: resources.diskGb,
      ipv4Count: 1,
      backupEnabled: false,
      snapshotCount: 0,
    },
    providerEventId: `cancel-terminate:${change.id}`,
    providerConfirmedAt: new Date(),
    idempotencyKey: `cancel-terminate-version:${change.id}`,
    sourceChangeRequestId: change.id,
  });

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "ServiceOrder" WHERE id = ${order.id} FOR UPDATE
    `;

    await tx.serviceSubscription.update({
      where: { id: subscription.id },
      data: {
        status: SubscriptionStatus.TERMINATED,
        canceledAt: subscription.canceledAt ?? new Date(),
        autoRenew: false,
      },
    });

    const already = await tx.walletLedgerEntry.findUnique({
      where: { idempotencyKey: refundIdempotencyKey(order.id) },
    });
    if (already) {
      return {
        reused: true,
        ledgerEntryId: already.id,
        amountRial: already.amount.toString(),
        balanceAfterRial: already.balanceAfter.toString(),
        createdAt: already.createdAt.toISOString(),
        orderId: order.id,
      };
    }

    let ledgerEntryId: string | null = null;
    let amountRial = 0n;
    let balanceAfterRial = 0n;
    let createdAt = new Date();

    if (refundableRial > 0n) {
      const credited = await creditCancellationRefundTx(tx, {
        userId: instance.userId,
        orderId: order.id,
        amountRial: refundableRial,
        reason: input.reason,
        actorUserId: input.actorUserId,
        preview: lockedPreview ?? null,
      });
      ledgerEntryId = credited.id;
      amountRial = credited.amount;
      balanceAfterRial = credited.balanceAfter;
      createdAt = credited.createdAt;

      await postPrepaidCancellationRefund(
        {
          orderId: order.id,
          amountRial: credited.amount,
          ledgerEntryId: credited.id,
          occurredAt: createdAt,
        },
        tx,
      );
    }

    await writeAuditLog(
      {
        actorUserId: input.actorUserId,
        action: AuditActions.REFUND,
        entityType: "service_order",
        entityId: order.id,
        afterData: {
          kind: "prepaid_cancellation_refund",
          lifecycle: "REFUND_CREDITED",
          resourceChangeRequestId: change.id,
          amountRial: amountRial.toString(),
          ledgerEntryId,
          reason: input.reason,
        },
        ip: input.ip,
        userAgent: input.userAgent,
        idempotencyKey: `audit:cancel-refund:${order.id}`,
      },
      tx,
    );

    return {
      reused: false,
      ledgerEntryId,
      amountRial: amountRial.toString(),
      balanceAfterRial: balanceAfterRial.toString(),
      createdAt: createdAt.toISOString(),
      orderId: order.id,
    };
  });
}

async function creditCancellationRefundTx(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    orderId: string;
    amountRial: bigint;
    reason: string;
    actorUserId: string;
    preview: Record<string, string> | null;
  },
) {
  const key = refundIdempotencyKey(input.orderId);
  const existing = await tx.walletLedgerEntry.findUnique({
    where: { idempotencyKey: key },
  });
  if (existing) {
    if (
      existing.status === LedgerStatus.COMPLETED &&
      existing.direction === LedgerDirection.CREDIT &&
      existing.amount === input.amountRial
    ) {
      return existing;
    }
    throw new WalletError(
      "idempotency_conflict",
      "سند بازگشت لغو با مبلغ متفاوت قبلاً ثبت شده است.",
    );
  }

  const wallet = await ensureWalletForUser(input.userId, tx);
  if (wallet.status !== WalletStatus.ACTIVE) {
    throw new WalletError("wallet_frozen", "Wallet is not active");
  }
  await tx.$queryRaw`
    SELECT id FROM "Wallet" WHERE id = ${wallet.id} FOR UPDATE
  `;
  const updated = await tx.wallet.update({
    where: { id: wallet.id },
    data: { availableBalance: { increment: input.amountRial } },
  });
  return tx.walletLedgerEntry.create({
    data: {
      walletId: wallet.id,
      direction: LedgerDirection.CREDIT,
      type: LedgerType.REFUND,
      amount: input.amountRial,
      status: LedgerStatus.COMPLETED,
      referenceType: "order",
      referenceId: input.orderId,
      idempotencyKey: key,
      balanceAfter: updated.availableBalance,
      description: input.reason,
      metadata: {
        kind: "prepaid_cancellation",
        actorUserId: input.actorUserId,
        refundPreview: input.preview,
      },
    },
  });
}
