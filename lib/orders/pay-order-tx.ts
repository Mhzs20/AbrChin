import {
  AdminNotificationStatus,
  AdminNotificationType,
  InfrastructureOrderStatus,
  LedgerDirection,
  LedgerStatus,
  LedgerType,
  ServiceOrderStatus,
  WalletStatus,
  type Prisma,
} from "@prisma/client";

import { ensureWalletForUser } from "@/lib/wallet/ensure-wallet";
import { WalletError } from "@/lib/wallet/errors";

export type PayOrderTxOptions = {
  /** Test-only: throw after debit ledger to verify full rollback. */
  testInjectFailureAfterDebit?: boolean;
};

export type PayOrderTxResult = {
  order: {
    id: string;
    userId: string;
    title: string;
    amount: bigint;
    status: ServiceOrderStatus;
    paidAt: Date | null;
  };
  infrastructureOrder: {
    id: string;
    status: InfrastructureOrderStatus;
  } | null;
};

export async function executePayOrderWithWalletTx(
  tx: Prisma.TransactionClient,
  userId: string,
  orderId: string,
  options?: PayOrderTxOptions,
): Promise<PayOrderTxResult> {
  const order = await tx.serviceOrder.findUnique({ where: { id: orderId } });
  if (!order || order.userId !== userId) {
    throw new WalletError("not_found", "سفارش پیدا نشد.");
  }
  if (order.status === ServiceOrderStatus.PAID) {
    const existingInfra = await tx.infrastructureOrder.findUnique({
      where: { serviceOrderId: order.id },
    });
    return { order, infrastructureOrder: existingInfra };
  }
  if (order.status !== ServiceOrderStatus.PENDING_PAYMENT) {
    throw new WalletError("invalid_status", "این سفارش قابل پرداخت نیست.");
  }
  if (order.quoteExpiresAt && order.quoteExpiresAt.getTime() <= Date.now()) {
    throw new WalletError(
      "quote_expired",
      "اعتبار قیمت این سفارش تمام شده؛ قیمت را دوباره دریافت کنید.",
    );
  }

  const plan = order.planId
    ? await tx.infrastructurePlan.findUnique({ where: { id: order.planId } })
    : null;
  if (!plan || !plan.active) {
    throw new WalletError("invalid_plan", "پلن سفارش معتبر نیست.");
  }

  const amountRial = order.amount;
  const idempotencyKey = `order_pay_${order.id}`;

  const existingLedger = await tx.walletLedgerEntry.findUnique({ where: { idempotencyKey } });
  if (existingLedger?.status === LedgerStatus.COMPLETED) {
    const paidOrder = await tx.serviceOrder.findUniqueOrThrow({ where: { id: order.id } });
    const infra = await tx.infrastructureOrder.findUnique({ where: { serviceOrderId: order.id } });
    return { order: paidOrder, infrastructureOrder: infra };
  }

  const wallet = await ensureWalletForUser(userId, tx);
  if (wallet.status !== WalletStatus.ACTIVE) {
    throw new WalletError("wallet_frozen", "کیف پول فعال نیست.");
  }

  const updated = await tx.wallet.updateMany({
    where: {
      id: wallet.id,
      availableBalance: { gte: amountRial },
      status: WalletStatus.ACTIVE,
    },
    data: { availableBalance: { decrement: amountRial } },
  });
  if (updated.count !== 1) {
    throw new WalletError("insufficient_funds", "موجودی کافی نیست.");
  }

  const freshWallet = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
  await tx.walletLedgerEntry.create({
    data: {
      walletId: wallet.id,
      direction: LedgerDirection.DEBIT,
      type: LedgerType.SERVICE_PURCHASE,
      amount: amountRial,
      status: LedgerStatus.COMPLETED,
      referenceType: "order",
      referenceId: order.id,
      idempotencyKey,
      balanceAfter: freshWallet.availableBalance,
      description: `پرداخت سفارش ${order.title}`,
    },
  });

  if (options?.testInjectFailureAfterDebit) {
    throw new WalletError("test_inject", "Injected failure after debit");
  }

  const paid = await tx.serviceOrder.updateMany({
    where: { id: order.id, status: ServiceOrderStatus.PENDING_PAYMENT },
    data: { status: ServiceOrderStatus.PAID, paidAt: new Date() },
  });
  if (paid.count !== 1) {
    throw new WalletError("invalid_status", "این سفارش قابل پرداخت نیست.");
  }

  const existingInfra = await tx.infrastructureOrder.findUnique({
    where: { serviceOrderId: order.id },
  });
  if (existingInfra) {
    const paidOrder = await tx.serviceOrder.findUniqueOrThrow({ where: { id: order.id } });
    return { order: paidOrder, infrastructureOrder: existingInfra };
  }

  const infrastructureOrder = await tx.infrastructureOrder.create({
    data: {
      serviceOrderId: order.id,
      userId,
      planId: plan.id,
      provider: plan.provider,
      deliveryMode: plan.deliveryMode,
      status: InfrastructureOrderStatus.WAITING_ADMIN_FUNDING,
      requiredFundingRial: plan.estimatedProviderCostRial,
      desiredInstanceName: `abrchin-${order.id.slice(-12)}`,
    },
  });

  await tx.adminNotification.create({
    data: {
      type: AdminNotificationType.ORDER_WAITING_PROVIDER_FUNDING,
      infrastructureOrderId: infrastructureOrder.id,
      title: "سفارش منتظر شارژ پارس‌پک",
      message: `سفارش ${order.title} پرداخت شد و منتظر تأمین زیرساخت است.`,
      status: AdminNotificationStatus.UNREAD,
    },
  });

  const paidOrder = await tx.serviceOrder.findUniqueOrThrow({ where: { id: order.id } });
  return { order: paidOrder, infrastructureOrder };
}
