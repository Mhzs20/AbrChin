import { InfrastructureOrderStatus, ServiceOrderStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getInfrastructureStage } from "@/lib/labels/infrastructure";
import { ledgerTypeLabel } from "@/lib/labels/ledger";
import { formatTomanFa } from "@/lib/money";

export async function getAccountOverview(userId: string) {
  const [wallet, activeServices, pendingOrders, latestOrder, latestService, recentTransactions] =
    await Promise.all([
      prisma.wallet.findUnique({ where: { userId } }),
      prisma.cloudInstance.count({ where: { userId, status: "ACTIVE" } }),
      prisma.infrastructureOrder.count({
        where: {
          userId,
          status: {
            notIn: [
              InfrastructureOrderStatus.ACTIVE,
              InfrastructureOrderStatus.CANCELED,
              InfrastructureOrderStatus.REFUNDED,
              InfrastructureOrderStatus.FAILED,
            ],
          },
        },
      }),
      prisma.serviceOrder.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: { infrastructureOrder: true },
      }),
      prisma.cloudInstance.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.walletLedgerEntry.findMany({
        where: { wallet: { userId } },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

  return {
    walletBalanceRial: wallet?.availableBalance ?? 0n,
    activeServices,
    pendingOrders,
    latestOrder: latestOrder
      ? {
          id: latestOrder.id,
          title: latestOrder.title,
          status: latestOrder.status,
          stage: latestOrder.infrastructureOrder
            ? getInfrastructureStage(latestOrder.infrastructureOrder.status)
            : null,
        }
      : null,
    latestService,
    recentTransactions: recentTransactions.map((tx) => ({
      id: tx.id,
      type: ledgerTypeLabel[tx.type],
      amountTomanFa: formatTomanFa(tx.amount),
      description: tx.description,
      createdAt: tx.createdAt.toISOString(),
    })),
    isNewUser: activeServices === 0 && !latestOrder,
  };
}

export async function getUserOrders(userId: string) {
  const orders = await prisma.serviceOrder.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { infrastructureOrder: { include: { plan: true } } },
  });
  return orders;
}

export async function getUserServices(userId: string) {
  return prisma.cloudInstance.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      infrastructureOrder: {
        include: { plan: true, provisioningJobs: { orderBy: { createdAt: "asc" } } },
      },
    },
  });
}

export async function getUserTransactions(userId: string, take = 50) {
  return prisma.walletLedgerEntry.findMany({
    where: { wallet: { userId } },
    orderBy: { createdAt: "desc" },
    take,
  });
}

export async function countPaidOrders(userId: string) {
  return prisma.serviceOrder.count({
    where: { userId, status: ServiceOrderStatus.PAID },
  });
}
