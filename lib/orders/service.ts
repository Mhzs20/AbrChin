import { type Prisma } from "@prisma/client";

import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { getActivePlanByCode, getActivePlanById, toPlanSnapshot } from "@/lib/orders/plans";
import {
  executePayOrderWithWalletTx,
  type PayOrderTxOptions,
} from "@/lib/orders/pay-order-tx";
import { ensureWalletForUser } from "@/lib/wallet/ensure-wallet";
import { WalletError } from "@/lib/wallet/errors";
import {
  CloudInstanceStatus,
  InfrastructureOrderStatus,
  LedgerDirection,
  LedgerStatus,
  LedgerType,
  ServiceOrderStatus,
} from "@prisma/client";

const QUOTE_VALIDITY_MS = 10 * 60 * 1000;

export async function createServiceOrder(userId: string, planCode: string) {
  const plan = await getActivePlanByCode(planCode);
  if (!plan) {
    throw new WalletError("invalid_plan", "بسته انتخاب‌شده معتبر نیست.");
  }

  await ensureWalletForUser(userId);
  const snapshot = toPlanSnapshot(plan);

  return prisma.serviceOrder.create({
    data: {
      userId,
      title: plan.title,
      description: plan.description,
      amount: plan.salePriceRial,
      currency: "IRR",
      status: ServiceOrderStatus.PENDING_PAYMENT,
      planCode: plan.code,
      planId: plan.id,
      planSnapshot: snapshot,
      quoteExpiresAt: new Date(Date.now() + QUOTE_VALIDITY_MS),
    },
  });
}

export async function createServiceOrderByPlanId(userId: string, planId: string) {
  const plan = await getActivePlanById(planId);
  if (!plan) {
    throw new WalletError("invalid_plan", "بسته انتخاب‌شده معتبر نیست.");
  }
  return createServiceOrder(userId, plan.code);
}

export async function payOrderWithWallet(
  userId: string,
  orderId: string,
  options?: PayOrderTxOptions,
) {
  return prisma.$transaction(async (tx) => executePayOrderWithWalletTx(tx, userId, orderId, options));
}

export async function refundOrder(params: {
  orderId: string;
  actorUserId: string;
  reason: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.serviceOrder.findUnique({ where: { id: params.orderId } });
    if (!order) throw new WalletError("not_found", "سفارش پیدا نشد.");
    if (order.status === ServiceOrderStatus.REFUNDED) return order;
    if (order.status !== ServiceOrderStatus.PAID) {
      throw new WalletError("invalid_status", "فقط سفارش پرداخت‌شده قابل بازگشت است.");
    }

    const infra = await tx.infrastructureOrder.findUnique({
      where: { serviceOrderId: order.id },
      include: { cloudInstance: true },
    });
    if (infra) {
      const blockedStatuses: InfrastructureOrderStatus[] = [
        InfrastructureOrderStatus.PROVISIONING,
        InfrastructureOrderStatus.ACTIVE,
        InfrastructureOrderStatus.NEEDS_RECONCILIATION,
      ];
      if (blockedStatuses.includes(infra.status)) {
        throw new WalletError(
          "refund_blocked",
          "بازگشت وجه برای سفارش با منبع فعال یا در حال آماده‌سازی مجاز نیست.",
        );
      }
      if (infra.cloudInstance && infra.cloudInstance.status !== CloudInstanceStatus.TERMINATED) {
        throw new WalletError(
          "refund_blocked",
          "تا زمان خاتمه سرور، بازگشت وجه مجاز نیست.",
        );
      }
    }

    const debit = await tx.walletLedgerEntry.findFirst({
      where: {
        referenceType: "order",
        referenceId: order.id,
        type: LedgerType.SERVICE_PURCHASE,
        status: LedgerStatus.COMPLETED,
        direction: LedgerDirection.DEBIT,
      },
    });
    if (!debit) throw new WalletError("missing_debit", "سند بدهکار سفارش پیدا نشد.");

    const refundKey = `order_refund_${order.id}`;
    const existingRefund = await tx.walletLedgerEntry.findUnique({ where: { idempotencyKey: refundKey } });
    if (!existingRefund) {
      const priorReverse = await tx.walletLedgerEntry.findFirst({
        where: {
          reversedEntryId: debit.id,
          type: LedgerType.REFUND,
          status: LedgerStatus.COMPLETED,
        },
      });
      if (priorReverse) {
        throw new WalletError("already_refunded", "این سفارش قبلاً بازگشت داده شده است.");
      }

      const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: debit.walletId } });
      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { availableBalance: { increment: debit.amount } },
      });
      await tx.walletLedgerEntry.create({
        data: {
          walletId: wallet.id,
          direction: LedgerDirection.CREDIT,
          type: LedgerType.REFUND,
          amount: debit.amount,
          status: LedgerStatus.COMPLETED,
          referenceType: "ledger",
          referenceId: debit.id,
          idempotencyKey: refundKey,
          balanceAfter: updated.availableBalance,
          description: params.reason || "بازگشت وجه سفارش",
          metadata: { actorUserId: params.actorUserId },
          reversedEntryId: debit.id,
        },
      });
    }

    await tx.serviceOrder.update({
      where: { id: order.id },
      data: { status: ServiceOrderStatus.REFUNDED },
    });

    if (infra) {
      await tx.infrastructureOrder.update({
        where: { id: infra.id },
        data: {
          status:
            infra.status === InfrastructureOrderStatus.ACTIVE
              ? InfrastructureOrderStatus.REFUNDED
              : InfrastructureOrderStatus.CANCELED,
        },
      });
    }

    await writeAuditLog(
      {
        actorUserId: params.actorUserId,
        action: AuditActions.REFUND,
        entityType: "service_order",
        entityId: order.id,
        afterData: { reason: params.reason } as Prisma.InputJsonValue,
        ip: params.ip,
        userAgent: params.userAgent,
      },
      tx,
    );

    return tx.serviceOrder.findUniqueOrThrow({ where: { id: order.id } });
  });
}
