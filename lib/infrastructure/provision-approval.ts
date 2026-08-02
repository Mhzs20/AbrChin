import {
  AdminNotificationStatus,
  AdminNotificationType,
  InfrastructureOfferSource,
  InfrastructureOrderStatus,
  InfrastructureProvider,
  ProviderSyncStatus,
  ServiceOrderStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import {
  assertAdminActorTx,
  normalizeAdminCommand,
  persistAdminCommandReceiptTx,
  replayAdminCommandTx,
} from "@/lib/admin/command-receipt";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { isCloudProviderConfigured } from "@/lib/infrastructure/provider-factory";
import { catalogItemBasePriceRial } from "@/lib/pricing/plan-pricing";
import { transitionProductFlowTx } from "@/lib/product-flow/service";
import { WalletError } from "@/lib/wallet/errors";

type Db = PrismaClient | Prisma.TransactionClient;

type ProvisioningMode =
  | "AUTOMATED_PROVIDER"
  | "MANUAL_FULFILLMENT"
  | "ABRCHIN_INVENTORY_ASSIGN";

type ReviewIssue = {
  code: string;
  message: string;
};

const provisionApprovalStatuses: InfrastructureOrderStatus[] = [
  InfrastructureOrderStatus.WAITING_ADMIN_FUNDING,
  InfrastructureOrderStatus.MANUAL_REVIEW,
  InfrastructureOrderStatus.BLOCKED_PROVIDER_BALANCE,
];

function asRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function bigintSnapshot(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function provisioningMode(input: {
  provider: InfrastructureProvider;
  offerSource: InfrastructureOfferSource;
}): ProvisioningMode {
  if (input.offerSource === InfrastructureOfferSource.PREPROVISIONED_INVENTORY) {
    return "ABRCHIN_INVENTORY_ASSIGN";
  }
  if (input.offerSource === InfrastructureOfferSource.MANUAL_ADMIN) {
    return "MANUAL_FULFILLMENT";
  }
  const env = getEnv();
  const mutationsEnabled =
    input.provider === InfrastructureProvider.ARVAN
      ? env.arvanMutationsEnabled
      : env.parspackMutationsEnabled;
  return isCloudProviderConfigured(input.provider) && mutationsEnabled
    ? "AUTOMATED_PROVIDER"
    : "MANUAL_FULFILLMENT";
}

function sourceLabel(source: InfrastructureOfferSource) {
  if (source === InfrastructureOfferSource.PREPROVISIONED_INVENTORY) {
    return "موجودی تأییدشدهٔ ابرچین";
  }
  if (source === InfrastructureOfferSource.MANUAL_ADMIN) {
    return "تأمین دستی کنترل‌شده";
  }
  if (source === InfrastructureOfferSource.MANUAL_API_BACKED) {
    return "Provider با مسیر دستی";
  }
  return "Catalog Provider";
}

function modeLabel(mode: ProvisioningMode) {
  if (mode === "AUTOMATED_PROVIDER") return "Provision خودکار پس از فرمان مرحلهٔ بعد";
  if (mode === "ABRCHIN_INVENTORY_ASSIGN") return "تخصیص موجودی ابرچین در مرحلهٔ بعد";
  return "Fulfillment دستی کنترل‌شده در مرحلهٔ بعد";
}

async function loadOrderForReview(db: Db, infrastructureOrderId: string) {
  return db.infrastructureOrder.findUnique({
    where: { id: infrastructureOrderId },
    include: {
      user: { select: { id: true, mobile: true, displayName: true } },
      plan: { include: { catalogItem: true } },
      serviceOrder: {
        include: {
          recommendationQuote: true,
          orderPayment: true,
        },
      },
      preprovisionedInventoryItem: {
        include: { credential: { select: { status: true } } },
      },
      provisioningJobs: { select: { id: true } },
      cloudInstance: { select: { id: true } },
    },
  });
}

export type ProvisionApprovalReview = {
  infrastructureOrderId: string;
  serviceOrderId: string;
  customer: { mobile: string; displayName: string | null };
  payment: {
    amountRial: string;
    paidAt: string | null;
    gateway: string | null;
    reference: string | null;
  };
  sku: {
    title: string;
    code: string;
    source: string;
    provider: string;
    region: string;
    plan: string;
    image: string;
  };
  pricing: {
    providerCostSnapshotRial: string | null;
    providerCostCurrentRial: string | null;
    markupBasisPointsSnapshot: number | null;
    expectedMarginRial: string | null;
    currentMarginRial: string | null;
  };
  availability: {
    available: boolean;
    fresh: boolean;
    checkedAt: string | null;
    freshnessSlaSeconds: number | null;
  };
  balance: {
    status: "MANUAL_REQUIRED" | "NOT_APPLICABLE";
    message: string;
    requiresConfirmation: boolean;
  };
  provisioning: { mode: ProvisioningMode; label: string };
  differences: ReviewIssue[];
  blockingIssues: ReviewIssue[];
  canApprove: boolean;
};

async function buildProvisionApprovalReview(
  db: Db,
  infrastructureOrderId: string,
): Promise<ProvisionApprovalReview> {
  const order = await loadOrderForReview(db, infrastructureOrderId);
  if (!order) throw new WalletError("not_found", "سفارش زیرساخت پیدا نشد.");

  const [catalogState, pricing, productPricing, commerce, parchin] =
    await Promise.all([
      db.providerCatalogState.findUnique({ where: { provider: order.provider } }),
      db.providerPricingConfig.findUnique({ where: { provider: order.provider } }),
      db.productPricingConfig.findUnique({
        where: {
          provider_apiVersion_productKind: {
            provider: order.provider,
            apiVersion: order.providerApiVersion,
            productKind: order.productKind,
          },
        },
      }),
      db.commercePricingConfig.findUnique({ where: { id: "default" } }),
      db.parchinPricingConfig.findUnique({
        where: { level: order.parchinLevel ?? "PARCHIN_START" },
      }),
    ]);

  const snapshot = asRecord(order.serviceOrder.planSnapshot);
  const selection = asRecord(order.providerSelectionSnapshot);
  const snapshotCost = bigintSnapshot(snapshot.providerBasePriceRialSnapshot);
  const snapshotMarkup =
    typeof snapshot.markupBasisPointsSnapshot === "number"
      ? snapshot.markupBasisPointsSnapshot
      : null;
  const catalogItem = order.plan.catalogItem;
  const currentCost = catalogItem ? catalogItemBasePriceRial(catalogItem) : null;
  const currentMarkup = pricing && productPricing
    ? pricing.markupBasisPoints +
      (order.plan.skuMarkupBasisPoints ?? productPricing.markupBasisPoints)
    : null;
  const mode = provisioningMode({
    provider: order.provider,
    offerSource: order.plan.offerSource,
  });
  const requiresBalanceConfirmation =
    order.plan.offerSource === InfrastructureOfferSource.API_CATALOG ||
    order.plan.offerSource === InfrastructureOfferSource.MANUAL_API_BACKED;
  const now = Date.now();
  const catalogLastSync = catalogState?.lastCatalogSync ?? null;
  const catalogFresh =
    catalogState?.enabled === true &&
    catalogState.lastSyncStatus === ProviderSyncStatus.SUCCEEDED &&
    catalogLastSync != null &&
    now - catalogLastSync.getTime() <= (catalogState.freshnessSlaSeconds ?? 900) * 1000;
  const manualPriceFresh =
    order.plan.offerLastVerifiedAt != null &&
    order.plan.offerPriceValidUntil != null &&
    order.plan.offerPriceValidUntil.getTime() > now;
  const inventory = order.preprovisionedInventoryItem;
  const inventoryAvailable =
    inventory?.inventoryStatus === "RESERVED" &&
    inventory.reservedByOrderId === order.serviceOrderId &&
    inventory.healthStatus === "HEALTHY" &&
    inventory.credential?.status === "READY";
  const fresh =
    order.plan.offerSource === InfrastructureOfferSource.PREPROVISIONED_INVENTORY
      ? Boolean(inventoryAvailable)
      : order.plan.offerSource === InfrastructureOfferSource.MANUAL_ADMIN
        ? manualPriceFresh
        : catalogFresh;
  const available =
    order.plan.offerSource === InfrastructureOfferSource.PREPROVISIONED_INVENTORY
      ? Boolean(inventoryAvailable)
      : Boolean(
          catalogItem &&
            catalogItem.active &&
            catalogItem.available &&
            catalogItem.status === "ACTIVE",
        );

  const currentConfigurationMatches =
    asString(snapshot.provider) === order.provider &&
    (asString(snapshot.providerApiVersion) ?? "v1") === order.providerApiVersion &&
    asString(snapshot.productKind) === order.productKind &&
    asString(snapshot.regionCode) === order.plan.regionCode &&
    asString(snapshot.sizeCode) === order.plan.sizeCode &&
    asString(snapshot.imageCode) === order.plan.imageCode &&
    (asString(selection.catalogItemId) == null ||
      asString(selection.catalogItemId) === order.plan.catalogItemId) &&
    (asString(selection.externalPlanId) == null ||
      asString(selection.externalPlanId) ===
        (catalogItem?.externalPlanId ?? order.plan.sizeCode));

  const differences: ReviewIssue[] = [];
  const blockingIssues: ReviewIssue[] = [];
  const addBlocking = (code: string, message: string) => {
    const issue = { code, message };
    differences.push(issue);
    blockingIssues.push(issue);
  };
  if (!snapshotCost) {
    addBlocking("snapshot_cost_missing", "Snapshot هزینهٔ Provider کامل نیست.");
  }
  if (snapshotCost != null && currentCost != null && snapshotCost !== currentCost) {
    addBlocking("provider_price_changed", "هزینهٔ فعلی Provider با Snapshot پرداخت متفاوت است.");
  }
  if (currentCost == null) {
    addBlocking("provider_price_unavailable", "قیمت معتبر فعلی Provider در Catalog موجود نیست.");
  }
  if (!available) {
    addBlocking("provider_unavailable", "موجودی یا Availability فعلی برای این Source تأیید نشده است.");
  }
  if (!fresh) {
    addBlocking("catalog_stale", "Freshness دادهٔ موردنیاز برای تصمیم Provision تأیید نشده است.");
  }
  if (!currentConfigurationMatches) {
    addBlocking("configuration_changed", "SKU یا Configuration فعلی با Snapshot پرداخت‌شده یکسان نیست.");
  }
  if (
    currentMarkup != null &&
    snapshotMarkup != null &&
    currentMarkup !== snapshotMarkup
  ) {
    differences.push({
      code: "markup_changed",
      message: "Markup فعلی با Snapshot پرداخت متفاوت است؛ مبلغ سفارش تغییر داده نمی‌شود.",
    });
  }
  if (!parchin?.active || !commerce ||
      (order.plan.offerSource !== InfrastructureOfferSource.MANUAL_ADMIN &&
        (!pricing?.enabled || !productPricing?.enabled))) {
    differences.push({
      code: "pricing_configuration_changed",
      message: "تنظیمات قیمت فعلی برای فروش جدید قابل اتکا نیست؛ مبلغ پرداخت‌شده حفظ شده است.",
    });
  }

  const checkedAt =
    order.plan.offerSource === InfrastructureOfferSource.PREPROVISIONED_INVENTORY
      ? inventory?.lastObservedAt ?? null
      : order.plan.offerSource === InfrastructureOfferSource.MANUAL_ADMIN
        ? order.plan.offerLastVerifiedAt ?? null
        : catalogLastSync;
  const expectedMargin =
    snapshotCost == null ? null : order.serviceOrder.amount - snapshotCost;
  const currentMargin =
    currentCost == null ? null : order.serviceOrder.amount - currentCost;

  return {
    infrastructureOrderId: order.id,
    serviceOrderId: order.serviceOrderId,
    customer: {
      mobile: order.user.mobile,
      displayName: order.user.displayName,
    },
    payment: {
      amountRial: order.serviceOrder.amount.toString(),
      paidAt: order.serviceOrder.paidAt?.toISOString() ?? null,
      gateway: order.serviceOrder.orderPayment?.gateway ?? null,
      reference:
        order.serviceOrder.orderPayment?.gatewayReference ??
        order.serviceOrder.orderPayment?.authority ??
        null,
    },
    sku: {
      title: order.plan.title,
      code: order.plan.code,
      source: sourceLabel(order.plan.offerSource),
      provider: order.provider,
      region: order.plan.regionCode,
      plan: catalogItem?.externalPlanId ?? order.plan.sizeCode,
      image: order.serviceOrder.recommendationQuote?.externalImageId ?? order.plan.imageCode,
    },
    pricing: {
      providerCostSnapshotRial: snapshotCost?.toString() ?? null,
      providerCostCurrentRial: currentCost?.toString() ?? null,
      markupBasisPointsSnapshot: snapshotMarkup,
      expectedMarginRial: expectedMargin?.toString() ?? null,
      currentMarginRial: currentMargin?.toString() ?? null,
    },
    availability: {
      available,
      fresh,
      checkedAt: checkedAt?.toISOString() ?? null,
      freshnessSlaSeconds:
        order.plan.offerSource === InfrastructureOfferSource.API_CATALOG ||
        order.plan.offerSource === InfrastructureOfferSource.MANUAL_API_BACKED
          ? catalogState?.freshnessSlaSeconds ?? 900
          : null,
    },
    balance: requiresBalanceConfirmation
      ? {
          status: "MANUAL_REQUIRED",
          message: "API معتبر برای موجودی کیف پول Provider ثبت نشده است؛ پیش از تأیید، موجودی یا شارژ را دستی در پنل Provider بررسی کنید.",
          requiresConfirmation: true,
        }
      : {
          status: "NOT_APPLICABLE",
          message: "این Source برای تأیید اول به بررسی شارژ Provider نیاز ندارد.",
          requiresConfirmation: false,
        },
    provisioning: { mode, label: modeLabel(mode) },
    differences,
    blockingIssues,
    canApprove: blockingIssues.length === 0,
  };
}

export async function getProvisionApprovalReview(infrastructureOrderId: string) {
  return buildProvisionApprovalReview(prisma, infrastructureOrderId);
}

function assertProvisionApprovalState(order: {
  status: InfrastructureOrderStatus;
  productFlowState: string | null;
  serviceOrder: { status: ServiceOrderStatus };
  cloudInstance: { id: string } | null;
  provisioningJobs: { id: string }[];
}) {
  if (
    !provisionApprovalStatuses.includes(order.status) ||
    order.productFlowState !== "PAID" ||
    order.serviceOrder.status !== ServiceOrderStatus.PAID ||
    order.cloudInstance ||
    order.provisioningJobs.length > 0
  ) {
    throw new WalletError("invalid_status", "این سفارش در صف تأیید ساخت نیست.");
  }
}

export async function approveProvision(params: {
  infrastructureOrderId: string;
  adminUserId: string;
  reason: string;
  providerBalanceConfirmed: boolean;
  idempotencyKey: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const command = normalizeAdminCommand({
    operation: "APPROVE_PROVISION",
    idempotencyKey: params.idempotencyKey,
    actorUserId: params.adminUserId,
    infrastructureOrderId: params.infrastructureOrderId,
    reason: params.reason,
    payload: { providerBalanceConfirmed: params.providerBalanceConfirmed },
  });
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "InfrastructureOrder"
      WHERE id = ${params.infrastructureOrderId}
      FOR UPDATE
    `;
    await assertAdminActorTx(tx, params.adminUserId);
    const replay = await replayAdminCommandTx(tx, command);
    if (replay) return replay;

    const order = await loadOrderForReview(tx, params.infrastructureOrderId);
    if (!order) throw new WalletError("not_found", "سفارش زیرساخت پیدا نشد.");
    assertProvisionApprovalState(order);
    const review = await buildProvisionApprovalReview(tx, order.id);
    if (review.balance.requiresConfirmation && !params.providerBalanceConfirmed) {
      throw new WalletError(
        "provider_balance_confirmation_required",
        "بررسی دستی موجودی یا شارژ Provider باید توسط Admin تأیید شود.",
      );
    }
    if (!review.canApprove) {
      await tx.infrastructureOrder.update({
        where: { id: order.id },
        data: { status: InfrastructureOrderStatus.MANUAL_REVIEW },
      });
      await writeAuditLog(
        {
          actorUserId: params.adminUserId,
          action: AuditActions.PROVISION_APPROVAL_BLOCKED,
          entityType: "infrastructure_order",
          entityId: order.id,
          afterData: {
            status: InfrastructureOrderStatus.MANUAL_REVIEW,
            blockingCodes: review.blockingIssues.map((issue) => issue.code),
            containsSecret: false,
          },
          ip: params.ip,
          userAgent: params.userAgent,
          idempotencyKey: `audit:provision-approval-blocked:${order.id}:${review.blockingIssues.map((issue) => issue.code).join(",")}`,
        },
        tx,
      );
      return {
        infrastructureOrderId: order.id,
        status: InfrastructureOrderStatus.MANUAL_REVIEW,
        productFlowState: "PAID",
        approved: false,
        review,
      };
    }

    await tx.infrastructureOrder.update({
      where: { id: order.id },
      data: { status: InfrastructureOrderStatus.FUNDING_CONFIRMED },
    });
    await transitionProductFlowTx(tx, {
      owner: {
        recommendationSessionId: order.serviceOrder.recommendationQuote?.sessionId ?? null,
        serviceOrderId: order.serviceOrderId,
        infrastructureOrderId: order.id,
      },
      from: "PAID",
      to: "PROVISION_APPROVED",
      reason: "admin_provision_approved",
      idempotencyKey: `provision-approved:${order.id}`,
      actorUserId: params.adminUserId,
    });
    await tx.adminNotification.updateMany({
      where: {
        infrastructureOrderId: order.id,
        type: {
          in: [
            AdminNotificationType.ORDER_WAITING_PROVIDER_FUNDING,
            AdminNotificationType.PROVIDER_BALANCE_BLOCKED,
          ],
        },
        status: { in: [AdminNotificationStatus.UNREAD, AdminNotificationStatus.READ] },
      },
      data: { status: AdminNotificationStatus.RESOLVED, resolvedAt: new Date() },
    });
    const result = {
      infrastructureOrderId: order.id,
      status: InfrastructureOrderStatus.FUNDING_CONFIRMED,
      productFlowState: "PROVISION_APPROVED",
      approved: true,
      provisioningMode: review.provisioning.mode,
      containsSecret: false,
    };
    await writeAuditLog(
      {
        actorUserId: params.adminUserId,
        action: AuditActions.PROVISION_APPROVED,
        entityType: "infrastructure_order",
        entityId: order.id,
        afterData: result,
        ip: params.ip,
        userAgent: params.userAgent,
        idempotencyKey: `audit:${command.receiptKey}`,
      },
      tx,
    );
    await persistAdminCommandReceiptTx(tx, command, result);
    return result;
  });
}

export async function holdProvisionApproval(params: {
  infrastructureOrderId: string;
  adminUserId: string;
  reason: string;
  idempotencyKey: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const command = normalizeAdminCommand({
    operation: "HOLD_PROVISION",
    idempotencyKey: params.idempotencyKey,
    actorUserId: params.adminUserId,
    infrastructureOrderId: params.infrastructureOrderId,
    reason: params.reason,
  });
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "InfrastructureOrder"
      WHERE id = ${params.infrastructureOrderId}
      FOR UPDATE
    `;
    await assertAdminActorTx(tx, params.adminUserId);
    const replay = await replayAdminCommandTx(tx, command);
    if (replay) return replay;
    const order = await loadOrderForReview(tx, params.infrastructureOrderId);
    if (!order) throw new WalletError("not_found", "سفارش زیرساخت پیدا نشد.");
    assertProvisionApprovalState(order);
    await tx.infrastructureOrder.update({
      where: { id: order.id },
      data: { status: InfrastructureOrderStatus.MANUAL_REVIEW },
    });
    const result = {
      infrastructureOrderId: order.id,
      status: InfrastructureOrderStatus.MANUAL_REVIEW,
      productFlowState: "PAID",
      held: true,
      containsSecret: false,
    };
    await writeAuditLog(
      {
        actorUserId: params.adminUserId,
        action: AuditActions.PROVISION_HELD,
        entityType: "infrastructure_order",
        entityId: order.id,
        afterData: result,
        ip: params.ip,
        userAgent: params.userAgent,
        idempotencyKey: `audit:${command.receiptKey}`,
      },
      tx,
    );
    await persistAdminCommandReceiptTx(tx, command, result);
    return result;
  });
}
