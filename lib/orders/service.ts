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
import { transitionProductFlowTx } from "@/lib/product-flow/service";
import {
  CloudInstanceStatus,
  InfrastructureOrderStatus,
  LedgerDirection,
  LedgerStatus,
  LedgerType,
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
}) {
  if (!plan.catalogItem?.providerMonthlyPriceIrr) {
    throw new WalletError(
      "quote_unavailable",
      "قیمت ارائه‌دهنده برای این سفارش قدیمی قابل تأیید نیست.",
    );
  }
  const defaults =
    plan.provider === "ARVAN"
      ? await resolveProviderSelectionDefaults({
          provider: plan.provider,
          providerApiVersion: plan.providerApiVersion,
          productKind: plan.productKind,
          region: plan.regionCode,
        })
      : null;
  const current = await revalidateLockedSelection({
    provider: plan.provider,
    providerApiVersion: plan.providerApiVersion,
    productKind: plan.productKind,
    region: plan.regionCode,
    externalPlanId: plan.catalogItem.externalPlanId ?? plan.sizeCode,
    externalImageId: plan.imageCode,
    externalNetworkId: defaults?.externalNetworkId ?? null,
    externalSecurityId: defaults?.externalSecurityId ?? null,
  });
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
  options?: PayOrderTxOptions,
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
      const current = await revalidateLockedSelection({
        provider: quote.provider,
        providerApiVersion: quote.providerApiVersion,
        productKind: quote.productKind,
        region: quote.providerRegion,
        externalPlanId: quote.externalPlanId,
        externalImageId: quote.externalImageId,
        externalNetworkId: quote.externalNetworkId,
        externalSecurityId: quote.externalSecurityId,
      });
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
      await lockAndRevalidateLegacyOrder(existing.plan);
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
