import { InfrastructureOrderStatus, ServiceOrderStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getInfrastructureStage } from "@/lib/labels/infrastructure";
import { ledgerTypeLabel } from "@/lib/labels/ledger";
import { formatTomanFa } from "@/lib/money";

export async function getAccountOverview(userId: string) {
  const utcDayStart = new Date();
  utcDayStart.setUTCHours(0, 0, 0, 0);
  const [wallet, activeServices, pendingOrders, latestOrder, latestService, recentTransactions, todayUsage, latestSettlement, pendingResourceChanges, outstanding] =
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
        include: {
          resourceVersions: {
            where: { effectiveTo: null },
            orderBy: { effectiveFrom: "desc" },
            take: 1,
          },
          billingPolicySnapshots: {
            where: { effectiveTo: null },
            orderBy: { effectiveFrom: "desc" },
            take: 1,
          },
        },
      }),
      prisma.walletLedgerEntry.findMany({
        where: { wallet: { userId } },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.billingInvoice.aggregate({
        where: {
          userId,
          periodEnd: { gt: utcDayStart },
          status: { not: "CALCULATING" },
        },
        _sum: { totalAmountRial: true },
      }),
      prisma.billingInvoice.findFirst({
        where: {
          userId,
          status: {
            in: ["PAID", "PARTIALLY_PAID", "UNPAID", "UNDER_REVIEW"],
          },
        },
        orderBy: { periodEnd: "desc" },
      }),
      prisma.resourceChangeRequest.count({
        where: {
          requestedById: userId,
          status: {
            in: [
              "REQUESTED",
              "CREDIT_REQUIRED",
              "WAITING_ADMIN_APPROVAL",
              "APPROVED",
              "PROVIDER_MUTATION_PENDING",
              "PROVIDER_CONFIRMED",
              "REVIEW",
            ],
          },
        },
      }),
      prisma.outstandingBalance.aggregate({
        where: { userId, status: { in: ["OPEN", "PARTIALLY_PAID"] } },
        _sum: { remainingAmountRial: true },
      }),
    ]);
  const currentResources = latestService?.resourceVersions[0] ?? null;
  const billingSnapshot = latestService?.billingPolicySnapshots[0] ?? null;
  const hourlyEstimateRial =
    billingSnapshot?.hourlyEstimateRial ??
    (billingSnapshot?.dailyEstimateRial != null
      ? billingSnapshot.dailyEstimateRial / 24n
      : null);
  const dailyEstimateRial =
    billingSnapshot?.dailyEstimateRial ??
    (hourlyEstimateRial != null ? hourlyEstimateRial * 24n : null);
  const runwaySeconds =
    wallet && hourlyEstimateRial && hourlyEstimateRial > 0n
      ? (wallet.availableBalance * 3_600n) / hourlyEstimateRial
      : null;

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
    billing: {
      todayUsageRial: todayUsage._sum.totalAmountRial ?? 0n,
      latestSettlement: latestSettlement
        ? {
            periodEnd: latestSettlement.periodEnd,
            status: latestSettlement.status,
            totalAmountRial: latestSettlement.totalAmountRial,
            paidAmountRial: latestSettlement.paidAmountRial,
          }
        : null,
      hourlyEstimateRial,
      dailyEstimateRial,
      runwaySeconds,
      currentResources: currentResources
        ? {
            vcpu: currentResources.vcpu,
            ramMb: currentResources.ramMb,
            diskGb: currentResources.diskGb,
            state: currentResources.state,
          }
        : null,
      pendingResourceChanges,
      outstandingRial: outstanding._sum.remainingAmountRial ?? 0n,
    },
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
        include: {
          plan: true,
          serviceOrder: true,
          provisioningJobs: { orderBy: { createdAt: "asc" } },
        },
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
