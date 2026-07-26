import {
  AdminNotificationStatus,
  InfrastructureOrderStatus,
  LedgerType,
  ProvisioningJobStatus,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { isProviderConfigured } from "@/lib/infrastructure/provider-factory";
import { getWorkerHealthStatus } from "@/lib/infrastructure/provisioning-service";
import { ensureGatewayConfigsSeeded } from "@/lib/payments/gateway-config";

export async function getAdminDashboardStats() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    waitingFunding,
    queuedOrders,
    provisioningJobs,
    failedJobs,
    blockedOrders,
    reconciliationOrders,
    activeInstances,
    totalUsers,
    newUsersToday,
    topUpsToday,
    purchasesToday,
    failedTransactionsToday,
    unreadNotifications,
  ] = await Promise.all([
    prisma.infrastructureOrder.count({ where: { status: InfrastructureOrderStatus.WAITING_ADMIN_FUNDING } }),
    prisma.infrastructureOrder.count({ where: { status: InfrastructureOrderStatus.QUEUED } }),
    prisma.provisioningJob.count({ where: { status: ProvisioningJobStatus.RUNNING } }),
    prisma.provisioningJob.count({ where: { status: ProvisioningJobStatus.FAILED } }),
    prisma.infrastructureOrder.count({ where: { status: InfrastructureOrderStatus.BLOCKED_PROVIDER_BALANCE } }),
    prisma.infrastructureOrder.count({ where: { status: InfrastructureOrderStatus.NEEDS_RECONCILIATION } }),
    prisma.cloudInstance.count({ where: { status: "ACTIVE" } }),
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.walletLedgerEntry.aggregate({
      where: { type: LedgerType.TOP_UP, createdAt: { gte: todayStart }, status: "COMPLETED" },
      _sum: { amount: true },
    }),
    prisma.walletLedgerEntry.aggregate({
      where: { type: LedgerType.SERVICE_PURCHASE, createdAt: { gte: todayStart }, status: "COMPLETED" },
      _sum: { amount: true },
    }),
    prisma.walletLedgerEntry.count({
      where: { status: "FAILED", createdAt: { gte: todayStart } },
    }),
    prisma.adminNotification.count({ where: { status: AdminNotificationStatus.UNREAD } }),
  ]);

  return {
    waitingFunding,
    queuedOrders,
    provisioningJobs,
    failedJobs,
    blockedOrders,
    reconciliationOrders,
    activeInstances,
    totalUsers,
    newUsersToday,
    topUpsTodayRial: topUpsToday._sum.amount ?? 0n,
    purchasesTodayRial: purchasesToday._sum.amount ?? 0n,
    failedTransactionsToday,
    unreadNotifications,
  };
}

export async function getSystemStatuses() {
  await ensureGatewayConfigsSeeded();
  const gateways = await prisma.paymentGatewayConfig.findMany();
  const catalog = await prisma.providerCatalogState.findUnique({ where: { provider: "PARSPACK" } });

  let parspackStatus: "healthy" | "unconfigured" | "disabled" | "error" = "unconfigured";
  let parspackMessage = "تنظیم نشده";
  if (isProviderConfigured()) {
    try {
      const { createInfrastructureProvider } = await import("@/lib/infrastructure/provider-factory");
      const provider = createInfrastructureProvider();
      const health = await provider.checkConnection();
      parspackStatus = health.ok ? "healthy" : "error";
      parspackMessage = health.message;
    } catch {
      parspackStatus = "disabled";
      parspackMessage = "غیرفعال";
    }
  }

  const worker = await getWorkerHealthStatus();
  const workerLabel =
    worker.status === "healthy" ? "سالم" : worker.status === "stale" ? "کهنه" : "قطع";

  const zibal = gateways.find((g) => g.provider === "ZIBAL");
  const zarinpal = gateways.find((g) => g.provider === "ZARINPAL");

  return {
    zibal: { enabled: zibal?.enabled ?? false, default: zibal?.isDefault ?? false },
    zarinpal: { enabled: zarinpal?.enabled ?? false, default: zarinpal?.isDefault ?? false },
    kavenegar: { configured: Boolean(process.env.KAVENEGAR_API_KEY) },
    postgres: { configured: Boolean(process.env.DATABASE_URL) },
    parspack: {
      status: parspackStatus,
      message: parspackMessage,
      lastHealthCheck: catalog?.lastHealthCheck?.toISOString() ?? null,
      lastCatalogSync: catalog?.lastCatalogSync?.toISOString() ?? null,
      regionCount: catalog?.regionCount ?? 0,
      sizeCount: catalog?.sizeCount ?? 0,
      imageCount: catalog?.imageCount ?? 0,
      lastError: catalog?.lastError ?? null,
    },
    worker: {
      status: worker.status,
      label: workerLabel,
      workerId: worker.workerId,
      lastSeenAt: worker.lastSeenAt,
      lastCycleAt: worker.lastCycleAt,
      cyclesTotal: worker.cyclesTotal ?? 0,
    },
  };
}

export async function getRecentAdminOperations() {
  const [waitingOrders, failedJobs, recentTransactions, recentNotifications] = await Promise.all([
    prisma.infrastructureOrder.findMany({
      where: { status: InfrastructureOrderStatus.WAITING_ADMIN_FUNDING },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { user: true, plan: true, serviceOrder: true },
    }),
    prisma.provisioningJob.findMany({
      where: { status: { in: [ProvisioningJobStatus.FAILED, ProvisioningJobStatus.NEEDS_RECONCILIATION] } },
      orderBy: { updatedAt: "desc" },
      take: 5,
      include: { infrastructureOrder: { include: { serviceOrder: true } } },
    }),
    prisma.walletLedgerEntry.findMany({ orderBy: { createdAt: "desc" }, take: 8, include: { wallet: { include: { user: true } } } }),
    prisma.adminNotification.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
  ]);

  return { waitingOrders, failedJobs, recentTransactions, recentNotifications };
}

export async function listAdminUsers(search?: string) {
  const where = search
    ? {
        OR: [
          { mobile: { contains: search } },
          { displayName: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : undefined;

  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      wallet: true,
      _count: { select: { orders: true, cloudInstances: true } },
    },
  });
  return users;
}

export async function getAdminUserDetail(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      wallet: { include: { ledgerEntries: { orderBy: { createdAt: "desc" }, take: 20 } } },
      orders: { orderBy: { createdAt: "desc" }, take: 10, include: { infrastructureOrder: true } },
      cloudInstances: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
}

export async function listInfrastructureOrders() {
  return prisma.infrastructureOrder.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      user: true,
      plan: true,
      serviceOrder: true,
      fundingConfirmations: { orderBy: { attempt: "desc" }, take: 1 },
      cloudInstance: true,
    },
  });
}
