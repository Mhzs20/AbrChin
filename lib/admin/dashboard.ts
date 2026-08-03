import {
  AdminNotificationStatus,
  InfrastructureOrderStatus,
  LedgerType,
  PaymentGatewayProvider,
  ProvisioningJobStatus,
  ServiceConnectionName,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { getBillingCatchUpStatus } from "@/lib/billing/worker";
import { isCloudProviderConfigured } from "@/lib/infrastructure/provider-factory";
import { getWorkerHealthStatus } from "@/lib/infrastructure/provisioning-service";
import { ensureGatewayConfigsSeeded } from "@/lib/payments/gateway-config";
import { hasServerCredentials } from "@/lib/payments/provider-factory";
import { catalogItemBasePriceRial } from "@/lib/pricing/plan-pricing";
import { calculateQuotePricing } from "@/lib/pricing/quote-line-items";
import { assessInfrastructureRecoveryActions } from "@/lib/infrastructure/resource-disposition";
import { getOperationalAlertConfigurationStatus } from "@/lib/operations/alert-configuration";
import { listAdminOperationsQueues } from "@/lib/admin/operations";

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
  const [catalogStates, pricingConfigs, connectionChecks] = await Promise.all([
    prisma.providerCatalogState.findMany(),
    prisma.providerPricingConfig.findMany(),
    prisma.serviceConnectionCheck.findMany(),
  ]);
  const catalog = catalogStates.find((item) => item.provider === "PARSPACK");
  const pricing = pricingConfigs.find((item) => item.provider === "PARSPACK");

  const arvanCatalog = catalogStates.find((item) => item.provider === "ARVAN");
  const arvanPricing = pricingConfigs.find((item) => item.provider === "ARVAN");
  const persistedConnection = (
    service: ServiceConnectionName,
    configured: boolean,
  ) => {
    const check = connectionChecks.find((item) => item.service === service);
    return {
      status: !configured
        ? "unconfigured" as const
        : check?.status === "HEALTHY"
          ? "healthy" as const
          : check?.status === "ERROR"
            ? "error" as const
            : "disabled" as const,
      message: !configured
        ? "تنظیم نشده"
        : check?.message ?? "بررسی اتصال اجرا نشده است",
    };
  };
  const parspackConnection = persistedConnection(
    ServiceConnectionName.PARSPACK,
    isCloudProviderConfigured("PARSPACK"),
  );
  const arvanConnection = persistedConnection(
    ServiceConnectionName.ARVAN,
    isCloudProviderConfigured("ARVAN"),
  );

  const providerState = (
    state: (typeof catalogStates)[number] | undefined,
    providerPricing: (typeof pricingConfigs)[number] | undefined,
    status: "healthy" | "unconfigured" | "disabled" | "error",
    message: string,
  ) => ({
    status,
    message,
    apiVersion: state?.apiVersion ?? "v1",
    enabled: state?.enabled ?? true,
    lastHealthCheck: state?.lastHealthCheck?.toISOString() ?? null,
    lastCatalogSync: state?.lastCatalogSync?.toISOString() ?? null,
    regionCount: state?.regionCount ?? 0,
    sizeCount: state?.sizeCount ?? 0,
    imageCount: state?.imageCount ?? 0,
    catalogItemCount: state?.catalogItemCount ?? 0,
    pricedItemCount: state?.pricedItemCount ?? 0,
    unavailableItemCount: state?.unavailableItemCount ?? 0,
    staleItemCount: state?.staleItemCount ?? 0,
    invalidPriceCount: state?.invalidPriceCount ?? 0,
    invalidResourceCount: state?.invalidResourceCount ?? 0,
    networkCount: state?.networkCount ?? 0,
    securityCount: state?.securityCount ?? 0,
    syncDurationMs: state?.lastSyncDurationMs ?? null,
    lastSyncStatus: state?.lastSyncStatus ?? null,
    regionErrors: state?.regionErrors ?? null,
    lastProviderRequestId: state?.lastProviderRequestId ?? null,
    markupBasisPoints: providerPricing?.markupBasisPoints ?? 0,
    sourceMoneyUnit: providerPricing?.sourceMoneyUnit ?? null,
    lastError: state?.lastError ?? null,
  });

  const worker = await getWorkerHealthStatus();
  const workerLabel =
    worker.status === "healthy" ? "سالم" : worker.status === "stale" ? "کهنه" : "قطع";

  const zibal = gateways.find((g) => g.provider === "ZIBAL");
  const zarinpal = gateways.find((g) => g.provider === "ZARINPAL");

  return {
    zibal: {
      enabled: zibal?.enabled ?? false,
      default: zibal?.isDefault ?? false,
      configured: hasServerCredentials(PaymentGatewayProvider.ZIBAL),
    },
    zarinpal: {
      enabled: zarinpal?.enabled ?? false,
      default: zarinpal?.isDefault ?? false,
      configured: hasServerCredentials(PaymentGatewayProvider.ZARINPAL),
    },
    kavenegar: {
      configured: Boolean(process.env.KAVENEGAR_API_KEY),
      operationalAlerts: getOperationalAlertConfigurationStatus(),
    },
    postgres: { configured: Boolean(process.env.DATABASE_URL) },
    parspack: {
      ...providerState(
        catalog,
        pricing,
        parspackConnection.status,
        parspackConnection.message,
      ),
    },
    arvan: providerState(
      arvanCatalog,
      arvanPricing,
      arvanConnection.status,
      arvanConnection.message,
    ),
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

export async function getProviderCatalogAdminView() {
  const [items, pricing, productPricing, commerce, parchinStart] =
    await Promise.all([
    prisma.providerCatalogItem.findMany({
      where: { active: true },
      orderBy: [
        { provider: "asc" },
        { regionCode: "asc" },
        { sizeCode: "asc" },
      ],
      take: 500,
    }),
    prisma.providerPricingConfig.findMany(),
    prisma.productPricingConfig.findMany(),
    prisma.commercePricingConfig.findUnique({ where: { id: "default" } }),
    prisma.parchinPricingConfig.findUnique({
      where: { level: "PARCHIN_START" },
    }),
  ]);
  return items.map((item) => {
    const config = pricing.find((entry) => entry.provider === item.provider);
    const product = productPricing.find(
      (entry) =>
        entry.provider === item.provider &&
        entry.apiVersion === item.apiVersion &&
        entry.productKind === item.productKind,
    );
    const basePriceRial = catalogItemBasePriceRial(item);
    const finalPriceRial =
      basePriceRial == null ||
      !config?.enabled ||
      !product?.enabled ||
      !parchinStart?.active
        ? null
        : calculateQuotePricing({
            providerMonthlyPriceIrr: basePriceRial,
            providerMarkupBps: config.markupBasisPoints,
            productMarkupBps: product.markupBasisPoints,
            parchinLevel: "PARCHIN_START",
            parchinPriceIrr: parchinStart.priceRial,
            taxBps: commerce?.taxBps ?? 1000,
          }).finalPriceIrr;
    return {
      id: item.id,
      provider: item.provider,
      apiVersion: item.apiVersion,
      source: item.source,
      status: item.status,
      regionCode: item.regionCode,
      sizeCode: item.sizeCode,
      vcpu: item.vcpu,
      ramMb: item.ramMb,
      diskGb: item.diskGb,
      available: item.available,
      priced: basePriceRial != null,
      basePriceRial: basePriceRial?.toString() ?? null,
      finalPriceRial: finalPriceRial?.toString() ?? null,
      lastSyncedAt: item.lastSyncedAt.toISOString(),
      manualAvailableUnits: item.manualAvailableUnits,
      manualPriceValidUntil: item.manualPriceValidUntil?.toISOString() ?? null,
    };
  });
}

export async function getProviderSyncRunsAdminView() {
  const runs = await prisma.providerCatalogSyncRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 12,
  });
  return runs.map((run) => ({
    id: run.id,
    provider: run.provider,
    apiVersion: run.apiVersion,
    status: run.status,
    catalogVersion: run.catalogVersion,
    regionCount: run.regionCount,
    successfulRegions: run.successfulRegions,
    failedRegions: run.failedRegions,
    planCount: run.planCount,
    imageCount: run.imageCount,
    durationMs: run.durationMs,
    report: run.report,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  }));
}

export async function getCommercePricingAdminView() {
  const [commerce, productMarkups, parchin] = await Promise.all([
    prisma.commercePricingConfig.findUnique({ where: { id: "default" } }),
    prisma.productPricingConfig.findMany({
      orderBy: [{ provider: "asc" }, { productKind: "asc" }],
    }),
    prisma.parchinPricingConfig.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  return {
    taxBps: commerce?.taxBps ?? 1000,
    productMarkups: productMarkups.map((config) => ({
      provider: config.provider,
      apiVersion: config.apiVersion,
      productKind: config.productKind,
      markupBasisPoints: config.markupBasisPoints,
      enabled: config.enabled,
    })),
    parchin: parchin.map((config) => ({
      level: config.level,
      title: config.title,
      description: config.description,
      priceRial: config.priceRial.toString(),
      active: config.active,
    })),
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

export async function getAdminOperationsCenter() {
  const [system, plans, queues, billingCatchUp] = await Promise.all([
    getSystemStatuses(),
    listAllAdminPlansForOperationsCenter(),
    listAdminOperationsQueues(),
    getBillingCatchUpStatus(),
  ]);

  const publishedSellableSkuCount = plans.filter(
    (plan) =>
      plan.active &&
      plan.publicationStatus === "PUBLISHED" &&
      plan.catalogMappingStatus === "MAPPED" &&
      plan.catalogItem?.status === "ACTIVE" &&
      plan.catalogItem.available &&
      plan.priced,
  ).length;

  const paymentConfigured =
    (system.zibal.enabled && system.zibal.configured) ||
    (system.zarinpal.enabled && system.zarinpal.configured);
  return {
    publishedSellableSkuCount,
    connections: [
      {
        key: "arvan",
        label: "آروان",
        status: system.arvan.status,
        message: system.arvan.message,
        href: "/admin/connections",
      },
      {
        key: "parspack",
        label: "پارس‌پک",
        status: system.parspack.status,
        message: system.parspack.message,
        href: "/admin/connections",
      },
      {
        key: "otp",
        label: "OTP کاوه‌نگار",
        status: system.kavenegar.configured ? "healthy" : "unconfigured",
        message: system.kavenegar.configured ? "تنظیم شده" : "تنظیم نشده",
        href: "/admin/connections",
      },
      {
        key: "payment",
        label: "درگاه پرداخت",
        status: paymentConfigured ? "healthy" : "unconfigured",
        message: paymentConfigured ? "درگاه فعال است" : "درگاه فعال تنظیم نشده است",
        href: "/admin/connections",
      },
      {
        key: "billing-catch-up",
        label: "Billing Catch-up",
        status:
          billingCatchUp.status === "CURRENT" ? "healthy" : "warning",
        message:
          billingCatchUp.status === "CURRENT"
            ? "تمام Periodهای بسته ثبت شده‌اند"
            : `قدیمی‌ترین Period عقب‌افتاده: ${billingCatchUp.cadences
                .find((item) => item.oldestOutstandingPeriod)
                ?.oldestOutstandingPeriod?.periodEnd ?? "نامشخص"}`,
        href: "/admin",
      },
    ],
    queues,
  };
}

async function listAllAdminPlansForOperationsCenter() {
  const [items, pricing, productPricing, commerce, parchinStart] =
    await Promise.all([
      prisma.providerCatalogItem.findMany({ where: { active: true } }),
      prisma.providerPricingConfig.findMany(),
      prisma.productPricingConfig.findMany(),
      prisma.commercePricingConfig.findUnique({ where: { id: "default" } }),
      prisma.parchinPricingConfig.findUnique({ where: { level: "PARCHIN_START" } }),
    ]);
  const plans = await prisma.infrastructurePlan.findMany({
    include: { catalogItem: true },
  });
  return plans.map((plan) => {
    const catalogItem = plan.catalogItem ?? items.find((item) => item.id === plan.catalogItemId) ?? null;
    const config = pricing.find((item) => item.provider === plan.provider);
    const product = productPricing.find(
      (item) =>
        item.provider === plan.provider &&
        item.apiVersion === plan.providerApiVersion &&
        item.productKind === plan.productKind &&
        item.enabled,
    );
    const basePrice = catalogItem ? catalogItemBasePriceRial(catalogItem) : null;
    const priced =
      basePrice != null &&
      (plan.offerSource === "MANUAL_ADMIN" ||
        (Boolean(config?.enabled) && Boolean(product) && Boolean(parchinStart?.active))) &&
      commerce != null;
    return { ...plan, catalogItem, priced };
  });
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
  const orders = await prisma.infrastructureOrder.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      user: true,
      plan: true,
      serviceOrder: true,
      fundingConfirmations: { orderBy: { attempt: "desc" }, take: 1 },
      provisioningJobs: { orderBy: { createdAt: "asc" } },
      cloudInstance: true,
    },
  });
  const auditKeys = orders
    .filter(
      (order) =>
        order.reconcileNoResourceConfirmedJobId &&
        order.reconcileNoResourceConfirmedAttempt != null,
    )
    .map(
      (order) =>
        `provider-absence-confirmed:${order.id}:${order.reconcileNoResourceConfirmedJobId}:${order.reconcileNoResourceConfirmedAttempt}`,
    );
  const audits = auditKeys.length
    ? await prisma.auditLog.findMany({
        where: { idempotencyKey: { in: auditKeys } },
      })
    : [];
  const auditByKey = new Map(
    audits.map((audit) => [audit.idempotencyKey, audit]),
  );
  return orders.map((order) => {
    const auditKey =
      order.reconcileNoResourceConfirmedJobId &&
      order.reconcileNoResourceConfirmedAttempt != null
        ? `provider-absence-confirmed:${order.id}:${order.reconcileNoResourceConfirmedJobId}:${order.reconcileNoResourceConfirmedAttempt}`
        : null;
    return {
      ...order,
      recovery: assessInfrastructureRecoveryActions({
        ...order,
        absenceAudit: auditKey
          ? (auditByKey.get(auditKey) ?? null)
          : null,
      }),
    };
  });
}
