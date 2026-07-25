import { LedgerType, ServiceOrderStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { tomanToRial } from "@/lib/money";
import { getServicePlan } from "@/lib/orders/plans";
import { debitWallet, reverseLedgerEntry, WalletError } from "@/lib/wallet/ledger";
import { ensureWalletForUser } from "@/lib/wallet/ensure-wallet";

export async function createServiceOrder(userId: string, planCode: string) {
  const plan = getServicePlan(planCode);
  if (!plan) {
    throw new WalletError("invalid_plan", "بسته انتخاب‌شده معتبر نیست.");
  }

  await ensureWalletForUser(userId);

  return prisma.serviceOrder.create({
    data: {
      userId,
      title: plan.title,
      description: plan.description,
      amount: tomanToRial(plan.amountToman),
      currency: "IRR",
      status: ServiceOrderStatus.PENDING_PAYMENT,
      planCode: plan.code,
    },
  });
}

export async function payOrderWithWallet(userId: string, orderId: string) {
  const order = await prisma.serviceOrder.findUnique({ where: { id: orderId } });
  if (!order || order.userId !== userId) {
    throw new WalletError("not_found", "سفارش پیدا نشد.");
  }
  if (order.status === ServiceOrderStatus.PAID) {
    return order;
  }
  if (order.status !== ServiceOrderStatus.PENDING_PAYMENT) {
    throw new WalletError("invalid_status", "این سفارش قابل پرداخت نیست.");
  }

  const ledger = await debitWallet({
    userId,
    amountRial: order.amount,
    type: LedgerType.SERVICE_PURCHASE,
    idempotencyKey: `order_pay_${order.id}`,
    referenceType: "order",
    referenceId: order.id,
    description: `پرداخت سفارش ${order.title}`,
  });

  const paid = await prisma.serviceOrder.updateMany({
    where: { id: order.id, status: ServiceOrderStatus.PENDING_PAYMENT },
    data: { status: ServiceOrderStatus.PAID, paidAt: new Date() },
  });

  if (paid.count !== 1) {
    // Another concurrent pay won; ledger debit is idempotent on retry.
    return prisma.serviceOrder.findUniqueOrThrow({ where: { id: order.id } });
  }

  void ledger;
  return prisma.serviceOrder.findUniqueOrThrow({ where: { id: order.id } });
}

export async function refundOrder(params: {
  orderId: string;
  actorUserId: string;
  reason: string;
}) {
  const order = await prisma.serviceOrder.findUnique({ where: { id: params.orderId } });
  if (!order) {
    throw new WalletError("not_found", "سفارش پیدا نشد.");
  }
  if (order.status === ServiceOrderStatus.REFUNDED) {
    return order;
  }
  if (order.status !== ServiceOrderStatus.PAID) {
    throw new WalletError("invalid_status", "فقط سفارش پرداخت‌شده قابل بازگشت است.");
  }

  const debit = await prisma.walletLedgerEntry.findFirst({
    where: {
      referenceType: "order",
      referenceId: order.id,
      type: LedgerType.SERVICE_PURCHASE,
      status: "COMPLETED",
      direction: "DEBIT",
    },
  });
  if (!debit) {
    throw new WalletError("missing_debit", "سند بدهکار سفارش پیدا نشد.");
  }

  await reverseLedgerEntry({
    userId: order.userId,
    originalEntryId: debit.id,
    idempotencyKey: `order_refund_${order.id}`,
    description: params.reason || "بازگشت وجه سفارش",
    metadata: { actorUserId: params.actorUserId },
  });

  await prisma.serviceOrder.update({
    where: { id: order.id },
    data: { status: ServiceOrderStatus.REFUNDED },
  });

  return prisma.serviceOrder.findUniqueOrThrow({ where: { id: order.id } });
}
