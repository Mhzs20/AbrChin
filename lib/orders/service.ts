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
  resolvePlanPricing,
  samePlanConfigurationSnapshot,
  samePriceSnapshot,
} from "@/lib/pricing/plan-pricing";
import { refreshProviderCatalogForPricing } from "@/lib/infrastructure/catalog-service";
import { refreshMultiProviderCatalog } from "@/lib/infrastructure/multi-provider-catalog-service";
import { assertProviderRoute } from "@/lib/infrastructure/provider-routing";
import {
  CloudInstanceStatus,
  InfrastructureOrderStatus,
  InfrastructureProvider,
  LedgerDirection,
  LedgerStatus,
  LedgerType,
  RecommendationFlowStatus,
  RecommendationQuoteStatus,
  ServiceOrderStatus,
} from "@prisma/client";

const QUOTE_VALIDITY_MS = 10 * 60 * 1000;
const PURCHASABLE_QUOTE_STATUSES: RecommendationQuoteStatus[] = [
  RecommendationQuoteStatus.ACTIVE,
  RecommendationQuoteStatus.SELECTED,
];

async function refreshCatalogForProvider(provider: InfrastructureProvider) {
  if (provider === InfrastructureProvider.ARVAN) {
    await refreshMultiProviderCatalog(InfrastructureProvider.ARVAN);
    return;
  }
  await refreshProviderCatalogForPricing();
}

export async function createServiceOrder(userId: string, planCode: string) {
  const route = await prisma.infrastructurePlan.findUnique({
    where: { code: planCode },
    select: { provider: true },
  });
  if (!route) {
    throw new WalletError("invalid_plan", "بسته انتخاب‌شده معتبر نیست.");
  }
  await refreshCatalogForProvider(route.provider);
  const plan = await getActivePlanByCode(planCode);
  if (!plan) {
    throw new WalletError("invalid_plan", "بسته انتخاب‌شده معتبر نیست.");
  }
  assertProviderRoute({
    productKind: plan.productKind,
    provider: plan.provider,
    apiVersion: plan.providerApiVersion,
  });

  await ensureWalletForUser(userId);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + QUOTE_VALIDITY_MS);
  const snapshot = toPlanSnapshot(plan, { createdAt, expiresAt });

  return prisma.serviceOrder.create({
    data: {
      userId,
      title: plan.title,
      description: plan.description,
      amount: plan.pricing.finalPriceRial,
      currency: "IRR",
      status: ServiceOrderStatus.PENDING_PAYMENT,
      planCode: plan.code,
      planId: plan.id,
      planSnapshot: snapshot,
      quoteExpiresAt: expiresAt,
      provider: plan.provider,
      providerApiVersion: plan.providerApiVersion,
      productKind: plan.productKind,
      parchinLevel: plan.pricing.parchinLevel,
      productFlowState: "AWAITING_PAYMENT",
    },
  });
}

export async function createServiceOrderByPlanId(userId: string, planId: string) {
  const route = await prisma.infrastructurePlan.findUnique({
    where: { id: planId },
    select: { provider: true },
  });
  if (!route) throw new WalletError("invalid_plan", "بسته انتخاب‌شده معتبر نیست.");
  await refreshCatalogForProvider(route.provider);
  const plan = await getActivePlanById(planId);
  if (!plan) throw new WalletError("invalid_plan", "بسته انتخاب‌شده معتبر نیست.");
  assertProviderRoute({
    productKind: plan.productKind,
    provider: plan.provider,
    apiVersion: plan.providerApiVersion,
  });
  await ensureWalletForUser(userId);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + QUOTE_VALIDITY_MS);
  return prisma.serviceOrder.create({
    data: {
      userId,
      title: plan.title,
      description: plan.description,
      amount: plan.pricing.finalPriceRial,
      currency: "IRR",
      status: ServiceOrderStatus.PENDING_PAYMENT,
      planCode: plan.code,
      planId: plan.id,
      planSnapshot: toPlanSnapshot(plan, { createdAt, expiresAt }),
      quoteExpiresAt: expiresAt,
      provider: plan.provider,
      providerApiVersion: plan.providerApiVersion,
      productKind: plan.productKind,
      parchinLevel: plan.pricing.parchinLevel,
      productFlowState: "AWAITING_PAYMENT",
    },
  });
}

export async function createServiceOrderFromQuote(userId: string, quoteId: string) {
  const route = await prisma.recommendationQuote.findUnique({
    where: { id: quoteId },
    select: {
      provider: true,
      plan: { select: { provider: true } },
    },
  });
  if (!route) {
    throw new WalletError("invalid_quote", "پیشنهاد انتخاب‌شده پیدا نشد.");
  }
  await refreshCatalogForProvider(route.provider ?? route.plan.provider);
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
    if (quote.session.userId && quote.session.userId !== userId) {
      throw new WalletError("quote_claimed", "این پیشنهاد به حساب دیگری تعلق دارد.");
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
        productFlowState: "AWAITING_PAYMENT",
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
        userId,
        status: RecommendationFlowStatus.CHECKOUT,
        productFlowState: "AWAITING_PAYMENT",
      },
    });
    await tx.productFlowTransition.create({
      data: {
        recommendationSessionId: quote.sessionId,
        serviceOrderId: order.id,
        fromState: "QUOTED",
        toState: "AWAITING_PAYMENT",
        reason: "quote_selected_for_checkout",
        idempotencyKey: `quote-checkout:${quote.id}`,
        actorUserId: userId,
      },
    });

    return order;
  });
}

export async function payOrderWithWallet(
  userId: string,
  orderId: string,
  options?: PayOrderTxOptions,
) {
  const existing = await prisma.serviceOrder.findFirst({
    where: { id: orderId, userId },
    select: { status: true, provider: true },
  });
  if (existing?.status !== ServiceOrderStatus.PAID) {
    if (existing?.provider === "ARVAN") {
      await refreshMultiProviderCatalog("ARVAN");
    } else {
      await refreshProviderCatalogForPricing();
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
