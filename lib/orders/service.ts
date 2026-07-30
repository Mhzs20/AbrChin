import { type Prisma } from "@prisma/client";

import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import {
  executePayOrderWithWalletTx,
  type PayOrderTxOptions,
} from "@/lib/orders/pay-order-tx";
import { ensureWalletForUser } from "@/lib/wallet/ensure-wallet";
import { WalletError } from "@/lib/wallet/errors";
import {
  resolvePlanPricing,
  samePlanConfigurationSnapshot,
  samePriceSnapshot,
} from "@/lib/pricing/plan-pricing";
import { assertProviderRoute } from "@/lib/infrastructure/provider-routing";
import {
  resolveProviderSelectionDefaults,
  revalidateLockedSelection,
} from "@/lib/infrastructure/selection-revalidation";
import type { CloudProviderAdapter } from "@/lib/infrastructure/cloud-provider-adapter";
import { assessRefundResourceSafety } from "@/lib/infrastructure/resource-disposition";
import {
  assertProductFlowOwnerStateTx,
  transitionProductFlowTx,
} from "@/lib/product-flow/service";
import {
  InfrastructureOrderStatus,
  LedgerDirection,
  LedgerStatus,
  LedgerType,
  ProvisioningJobStatus,
  RecommendationFlowStatus,
  RecommendationQuoteStatus,
  ServiceOrderStatus,
} from "@prisma/client";

const PURCHASABLE_QUOTE_STATUSES: RecommendationQuoteStatus[] = [
  RecommendationQuoteStatus.ACTIVE,
  RecommendationQuoteStatus.SELECTED,
];

async function lockAndRevalidateLegacyOrder(plan: {
  provider: "ARVAN" | "PARSPACK";
  providerApiVersion: string;
  productKind: "CLOUD_SERVER" | "READY_INSTANT_SERVER";
  regionCode: string;
  sizeCode: string;
  imageCode: string;
  catalogItem: {
    externalPlanId: string | null;
    providerMonthlyPriceIrr: bigint | null;
  } | null;
}, adapterOverride?: CloudProviderAdapter) {
  if (!plan.catalogItem?.providerMonthlyPriceIrr) {
    throw new WalletError(
      "quote_unavailable",
      "قیمت ارائه‌دهنده برای این سفارش قدیمی قابل تأیید نیست.",
    );
  }
  const defaults =
    plan.provider === "ARVAN"
      ? adapterOverride
        ? await adapterOverride.resolveSelectionDefaults(plan.regionCode)
        : await resolveProviderSelectionDefaults({
            provider: plan.provider,
            providerApiVersion: plan.providerApiVersion,
            productKind: plan.productKind,
            region: plan.regionCode,
          })
      : null;
  const current = await revalidateLockedSelection(
    {
      provider: plan.provider,
      providerApiVersion: plan.providerApiVersion,
      productKind: plan.productKind,
      region: plan.regionCode,
      externalPlanId: plan.catalogItem.externalPlanId ?? plan.sizeCode,
      externalImageId: plan.imageCode,
      externalNetworkId: defaults?.externalNetworkId ?? null,
      externalSecurityId: defaults?.externalSecurityId ?? null,
    },
    adapterOverride,
  );
  if (
    current.monthlyPriceIrr !== plan.catalogItem.providerMonthlyPriceIrr
  ) {
    throw new WalletError(
      "quote_price_changed",
      "قیمت این سفارش قدیمی تغییر کرده و باید Quote تازه ساخته شود.",
    );
  }
}

export async function createServiceOrder(userId: string, planCode: string) {
  const route = await prisma.infrastructurePlan.findUnique({
    where: { code: planCode },
    select: { id: true },
  });
  if (!route) {
    throw new WalletError("invalid_plan", "بسته انتخاب‌شده معتبر نیست.");
  }
  return createServiceOrderByPlanId(userId, route.id);
}

export async function createServiceOrderByPlanId(
  userId: string,
  planId: string,
): Promise<never> {
  void userId;
  void planId;
  throw new WalletError(
    "delivery_configuration_required",
    "ابتدا سیستم‌عامل، روش دسترسی و تنظیمات تحویل را تأیید کنید.",
  );
}

export async function createServiceOrderFromQuote(userId: string, quoteId: string) {
  const preflight = await prisma.recommendationQuote.findUnique({
    where: { id: quoteId },
    select: {
      provider: true,
      providerApiVersion: true,
      productKind: true,
      providerRegion: true,
      externalPlanId: true,
      externalImageId: true,
      externalNetworkId: true,
      externalSecurityId: true,
      providerMonthlyPriceIrr: true,
      session: { select: { userId: true } },
    },
  });
  if (
    !preflight ||
    preflight.session.userId !== userId ||
    !preflight.provider ||
    !preflight.providerApiVersion ||
    !preflight.productKind ||
    !preflight.providerRegion ||
    !preflight.externalPlanId ||
    !preflight.externalImageId
  ) {
    throw new WalletError("invalid_quote", "پیشنهاد انتخاب‌شده پیدا نشد.");
  }
  const livePrice = await revalidateLockedSelection({
    provider: preflight.provider,
    providerApiVersion: preflight.providerApiVersion,
    productKind: preflight.productKind,
    region: preflight.providerRegion,
    externalPlanId: preflight.externalPlanId,
    externalImageId: preflight.externalImageId,
    externalNetworkId: preflight.externalNetworkId,
    externalSecurityId: preflight.externalSecurityId,
  });
  if (
    preflight.providerMonthlyPriceIrr == null ||
    livePrice.monthlyPriceIrr !== preflight.providerMonthlyPriceIrr
  ) {
    throw new WalletError(
      "quote_price_changed",
      "قیمت این پیشنهاد تغییر کرده؛ پیشنهاد تازه را دریافت کنید.",
    );
  }
  return prisma.$transaction(async (tx) => {
    const quote = await tx.recommendationQuote.findUnique({
      where: { id: quoteId },
      include: {
        plan: { include: { catalogItem: true } },
        session: true,
        serviceOrder: true,
      },
    });

    if (!quote) {
      throw new WalletError("invalid_quote", "پیشنهاد انتخاب‌شده پیدا نشد.");
    }
    if (quote.session.userId !== userId) {
      throw new WalletError(
        "quote_claimed",
        "ابتدا این پیشنهاد را صریحاً به حساب خود متصل کن.",
      );
    }
    if (quote.serviceOrder) {
      if (quote.serviceOrder.userId !== userId) {
        throw new WalletError("quote_claimed", "این پیشنهاد قبلاً استفاده شده است.");
      }
      return quote.serviceOrder;
    }
    if (!PURCHASABLE_QUOTE_STATUSES.includes(quote.status)) {
      throw new WalletError("invalid_quote_status", "این پیشنهاد دیگر قابل خرید نیست.");
    }
    if (quote.expiresAt.getTime() <= Date.now() || quote.session.expiresAt.getTime() <= Date.now()) {
      throw new WalletError(
        "quote_expired",
        "اعتبار این پیشنهاد تمام شده؛ قیمت و ظرفیت را دوباره دریافت کن.",
      );
    }
    if (!quote.plan.active) {
      throw new WalletError("invalid_plan", "ظرفیت این چینش دیگر فعال نیست.");
    }
    assertProviderRoute({
      productKind: quote.plan.productKind,
      provider: quote.plan.provider,
      apiVersion: quote.plan.providerApiVersion,
    });
    if (
      quote.provider != null &&
      (quote.provider !== quote.plan.provider ||
        quote.providerApiVersion !== quote.plan.providerApiVersion ||
        quote.productKind !== quote.plan.productKind)
    ) {
      throw new WalletError(
        "quote_provider_mismatch",
        "ارائه‌دهندهٔ قفل‌شده با سفارش همخوان نیست.",
      );
    }
    const pricingConfig = await tx.providerPricingConfig.findUnique({
      where: { provider: quote.plan.provider },
    });
    const [productPricing, commerce, parchin] = await Promise.all([
      tx.productPricingConfig.findUnique({
        where: {
          provider_apiVersion_productKind: {
            provider: quote.plan.provider,
            apiVersion: quote.plan.providerApiVersion,
            productKind: quote.plan.productKind,
          },
        },
      }),
      tx.commercePricingConfig.findUnique({ where: { id: "default" } }),
      tx.parchinPricingConfig.findUnique({
        where: {
          level:
            quote.parchinLevel ??
            quote.plan.minimumParchinLevel ??
            "PARCHIN_START",
        },
      }),
    ]);
    const currentPricing =
      pricingConfig?.enabled &&
      productPricing?.enabled &&
      parchin?.active
        ? resolvePlanPricing(quote.plan, pricingConfig, {
            productMarkupBasisPoints: productPricing.markupBasisPoints,
            taxBasisPoints: commerce?.taxBps ?? 1000,
            parchinLevel: parchin.level,
            parchinPriceRial: parchin.priceRial,
          })
        : null;
    if (!currentPricing) {
      throw new WalletError(
        "quote_unavailable",
        "ظرفیت این پیشنهاد دیگر موجود نیست؛ پرداخت متوقف شد.",
      );
    }
    if (!samePriceSnapshot(currentPricing, quote)) {
      throw new WalletError(
        "quote_price_changed",
        "قیمت این پیشنهاد تغییر کرده؛ پیشنهاد تازه را دریافت کنید.",
      );
    }
    if (!samePlanConfigurationSnapshot(quote.plan, currentPricing, quote.planSnapshot)) {
      throw new WalletError(
        "quote_configuration_changed",
        "تنظیمات این پیشنهاد تغییر کرده؛ پیشنهاد تازه را دریافت کنید.",
      );
    }

    await ensureWalletForUser(userId, tx);
    const snapshot = quote.planSnapshot as Prisma.InputJsonValue;
    const order = await tx.serviceOrder.create({
      data: {
        userId,
        title: quote.plan.title,
        description: quote.plan.description,
        amount: quote.amountRial,
        currency: "IRR",
        status: ServiceOrderStatus.PENDING_PAYMENT,
        planCode: quote.plan.code,
        planId: quote.plan.id,
        planSnapshot: snapshot,
        recommendationQuoteId: quote.id,
        quoteExpiresAt: quote.expiresAt,
        provider: quote.plan.provider,
        providerApiVersion: quote.plan.providerApiVersion,
        productKind: quote.plan.productKind,
        parchinLevel: currentPricing.parchinLevel,
        productFlowState: "QUOTED",
        productFlowRevision: quote.session.productFlowRevision,
      },
    });

    await tx.recommendationQuote.update({
      where: { id: quote.id },
      data: {
        status: RecommendationQuoteStatus.SELECTED,
        selectedAt: new Date(),
      },
    });
    await tx.recommendationSession.update({
      where: { id: quote.sessionId },
      data: {
        status: RecommendationFlowStatus.CHECKOUT,
      },
    });
    await transitionProductFlowTx(tx, {
      owner: {
        recommendationSessionId: quote.sessionId,
        serviceOrderId: order.id,
      },
      from: "QUOTED",
      to: "AWAITING_PAYMENT",
      reason: "quote_selected_for_checkout",
      idempotencyKey: `quote-checkout:${quote.id}`,
      actorUserId: userId,
    });

    return order;
  });
}

export async function payOrderWithWallet(
  userId: string,
  orderId: string,
  options?: PayOrderTxOptions & {
    /** Test-only provider fixture; production calls never pass this. */
    providerAdapter?: CloudProviderAdapter;
  },
) {
  const existing = await prisma.serviceOrder.findFirst({
    where: { id: orderId, userId },
    include: {
      recommendationQuote: true,
      plan: { include: { catalogItem: true } },
    },
  });
  if (existing?.status !== ServiceOrderStatus.PAID) {
    const quote = existing?.recommendationQuote;
    if (
      quote?.provider &&
      quote.providerApiVersion &&
      quote.productKind &&
      quote.providerRegion &&
      quote.externalPlanId &&
      quote.externalImageId
    ) {
      const current = await revalidateLockedSelection(
        {
          provider: quote.provider,
          providerApiVersion: quote.providerApiVersion,
          productKind: quote.productKind,
          region: quote.providerRegion,
          externalPlanId: quote.externalPlanId,
          externalImageId: quote.externalImageId,
          externalNetworkId: quote.externalNetworkId,
          externalSecurityId: quote.externalSecurityId,
        },
        options?.providerAdapter,
      );
      if (
        quote.providerMonthlyPriceIrr == null ||
        current.monthlyPriceIrr !== quote.providerMonthlyPriceIrr
      ) {
        throw new WalletError(
          "quote_price_changed",
          "قیمت این پیشنهاد تغییر کرده؛ پیشنهاد تازه را دریافت کنید.",
        );
      }
    } else if (existing?.plan?.catalogItem) {
      await lockAndRevalidateLegacyOrder(
        existing.plan,
        options?.providerAdapter,
      );
    }
  }
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
    const reason = params.reason.trim();
    if (reason.length < 3 || reason.length > 500) {
      throw new WalletError(
        "invalid_reason",
        "دلیل بازگشت وجه باید بین ۳ تا ۵۰۰ کاراکتر باشد.",
      );
    }
    await tx.$queryRaw`
      SELECT id
      FROM "ServiceOrder"
      WHERE id = ${params.orderId}
      FOR UPDATE
    `;
    const order = await tx.serviceOrder.findUnique({
      where: { id: params.orderId },
      include: {
        recommendationQuote: { select: { sessionId: true } },
      },
    });
    if (!order) throw new WalletError("not_found", "سفارش پیدا نشد.");
    if (order.status === ServiceOrderStatus.REFUNDED) return order;
    if (order.status !== ServiceOrderStatus.PAID) {
      throw new WalletError("invalid_status", "فقط سفارش پرداخت‌شده قابل بازگشت است.");
    }

    let infra = await tx.infrastructureOrder.findUnique({
      where: { serviceOrderId: order.id },
      include: {
        cloudInstance: true,
        provisioningJobs: { orderBy: { createdAt: "asc" } },
      },
    });
    if (infra) {
      await tx.$queryRaw`
        SELECT id
        FROM "InfrastructureOrder"
        WHERE id = ${infra.id}
        FOR UPDATE
      `;
      infra = await tx.infrastructureOrder.findUniqueOrThrow({
        where: { id: infra.id },
        include: {
          cloudInstance: true,
          provisioningJobs: { orderBy: { createdAt: "asc" } },
        },
      });
    }
    const sessionId = order.recommendationQuote?.sessionId ?? null;
    if (sessionId) {
      await tx.$queryRaw`
        SELECT id
        FROM "RecommendationSession"
        WHERE id = ${sessionId}
        FOR UPDATE
      `;
    }
    if (infra) {
      const refundableStatuses: InfrastructureOrderStatus[] = [
        InfrastructureOrderStatus.WAITING_ADMIN_FUNDING,
        InfrastructureOrderStatus.BLOCKED_PROVIDER_BALANCE,
        InfrastructureOrderStatus.MANUAL_REVIEW,
        InfrastructureOrderStatus.FAILED,
        InfrastructureOrderStatus.CANCELED,
      ];
      if (!refundableStatuses.includes(infra.status)) {
        throw new WalletError(
          "refund_blocked",
          "بازگشت وجه برای سفارش با منبع فعال یا در حال آماده‌سازی مجاز نیست.",
        );
      }
      const activeJob = await tx.provisioningJob.findFirst({
        where: {
          infrastructureOrderId: infra.id,
          status: {
            in: [
              ProvisioningJobStatus.QUEUED,
              ProvisioningJobStatus.RUNNING,
            ],
          },
        },
        select: { id: true },
      });
      if (activeJob) {
        throw new WalletError(
          "refund_blocked",
          "تا پایان یا لغو قطعی عملیات Provider، بازگشت وجه مجاز نیست.",
        );
      }
      const absenceAuditKey =
        infra.reconcileNoResourceConfirmedJobId &&
        infra.reconcileNoResourceConfirmedAttempt != null
          ? `provider-absence-confirmed:${infra.id}:${infra.reconcileNoResourceConfirmedJobId}:${infra.reconcileNoResourceConfirmedAttempt}`
          : null;
      const absenceAudit = absenceAuditKey
        ? await tx.auditLog.findUnique({
            where: { idempotencyKey: absenceAuditKey },
          })
        : null;
      const absenceAuditData =
        absenceAudit?.afterData &&
        typeof absenceAudit.afterData === "object" &&
        !Array.isArray(absenceAudit.afterData)
          ? (absenceAudit.afterData as Record<string, unknown>)
          : {};
      const absenceAuditMatches = Boolean(
        absenceAudit &&
          absenceAudit.action === AuditActions.RECONCILIATION &&
          absenceAudit.entityType === "infrastructure_order" &&
          absenceAudit.entityId === infra.id &&
          absenceAuditData.noResourceConfirmed === true &&
          absenceAuditData.provisioningJobId ===
            infra.reconcileNoResourceConfirmedJobId &&
          absenceAuditData.attempt ===
            infra.reconcileNoResourceConfirmedAttempt,
      );
      const resourceSafety = assessRefundResourceSafety({
        jobs: infra.provisioningJobs,
        cloudInstance: infra.cloudInstance,
        reconcileNoResourceConfirmedAt:
          infra.reconcileNoResourceConfirmedAt,
        reconcileNoResourceConfirmedJobId:
          infra.reconcileNoResourceConfirmedJobId,
        reconcileNoResourceConfirmedAttempt:
          infra.reconcileNoResourceConfirmedAttempt,
        absenceAuditMatches,
      });
      if (!resourceSafety.safe) {
        throw new WalletError(
          "refund_blocked",
          "تا تعیین قطعی نبود یا خاتمه Resource در Provider، بازگشت وجه مجاز نیست.",
        );
      }
    }

    const flowState = order.productFlowState;
    const refundableFlowStates = new Set([
      "PAID",
      "PROVISIONING_RETRYABLE",
      "PROVISIONING_MANUAL_REVIEW",
      "HEALTH_CHECK_FAILED",
      "DELIVERY_RETRYABLE",
      "CANCELLED",
    ]);
    if (!flowState || !refundableFlowStates.has(flowState)) {
      throw new WalletError(
        "refund_blocked",
        "وضعیت جریان سفارش برای بازگشت وجه قطعی نیست.",
      );
    }
    const liveSibling = sessionId
      ? await tx.serviceOrder.findFirst({
          where: {
            id: { not: order.id },
            recommendationQuote: { sessionId },
            status: {
              notIn: [
                ServiceOrderStatus.REFUNDED,
                ServiceOrderStatus.CANCELED,
              ],
            },
          },
          select: { id: true },
        })
      : null;
    const flowOwner = {
      recommendationSessionId: liveSibling ? null : sessionId,
      serviceOrderId: order.id,
      infrastructureOrderId: infra?.id ?? null,
    };
    await assertProductFlowOwnerStateTx(
      tx,
      flowOwner,
      flowState as
        | "PAID"
        | "PROVISIONING_RETRYABLE"
        | "PROVISIONING_MANUAL_REVIEW"
        | "HEALTH_CHECK_FAILED"
        | "DELIVERY_RETRYABLE"
        | "CANCELLED",
    );

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
    const priorReverse =
      existingRefund ??
      (await tx.walletLedgerEntry.findFirst({
        where: {
          reversedEntryId: debit.id,
          type: LedgerType.REFUND,
          status: LedgerStatus.COMPLETED,
        },
      }));
    if (
      priorReverse &&
      (priorReverse.walletId !== debit.walletId ||
        priorReverse.direction !== LedgerDirection.CREDIT ||
        priorReverse.type !== LedgerType.REFUND ||
        priorReverse.status !== LedgerStatus.COMPLETED ||
        priorReverse.amount !== debit.amount ||
        priorReverse.reversedEntryId !== debit.id)
    ) {
      throw new WalletError(
        "idempotency_conflict",
        "سند بازگشت وجه با سفارش مطابقت ندارد.",
      );
    }
    let refundEntry = priorReverse;
    if (!refundEntry) {
      await tx.$queryRaw`
        SELECT id
        FROM "Wallet"
        WHERE id = ${debit.walletId}
        FOR UPDATE
      `;
      const wallet = await tx.wallet.findUniqueOrThrow({
        where: { id: debit.walletId },
      });
      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { availableBalance: { increment: debit.amount } },
      });
      refundEntry = await tx.walletLedgerEntry.create({
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
          description: reason,
          metadata: { actorUserId: params.actorUserId },
          reversedEntryId: debit.id,
        },
      });
    }

    if (flowState !== "CANCELLED") {
      await transitionProductFlowTx(tx, {
        owner: flowOwner,
        from: flowState as
          | "PAID"
          | "PROVISIONING_RETRYABLE"
          | "PROVISIONING_MANUAL_REVIEW"
          | "HEALTH_CHECK_FAILED"
          | "DELIVERY_RETRYABLE",
        to: "CANCELLED",
        reason: "wallet_refund_completed",
        idempotencyKey: `refund-flow:${order.id}`,
        actorUserId: params.actorUserId,
        metadata: {
          refundLedgerEntryId: refundEntry.id,
          reason,
          containsSecret: false,
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
        data: { status: InfrastructureOrderStatus.REFUNDED },
      });
    }

    await writeAuditLog(
      {
        actorUserId: params.actorUserId,
        action: AuditActions.REFUND,
        entityType: "service_order",
        entityId: order.id,
        beforeData: {
          serviceOrderStatus: order.status,
          infrastructureOrderStatus: infra?.status ?? null,
          productFlowState: flowState,
        },
        afterData: {
          reason,
          serviceOrderStatus: ServiceOrderStatus.REFUNDED,
          infrastructureOrderStatus: infra
            ? InfrastructureOrderStatus.REFUNDED
            : null,
          productFlowState: "CANCELLED",
          refundLedgerEntryId: refundEntry.id,
          amountRial: refundEntry.amount.toString(),
          containsSecret: false,
        } as Prisma.InputJsonValue,
        ip: params.ip,
        userAgent: params.userAgent,
        idempotencyKey: `audit:refund:${order.id}`,
      },
      tx,
    );

    return tx.serviceOrder.findUniqueOrThrow({ where: { id: order.id } });
  });
}
