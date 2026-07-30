import {
  AdminNotificationStatus,
  AdminNotificationType,
  InfrastructureOrderStatus,
  LedgerDirection,
  LedgerStatus,
  LedgerType,
  RecommendationFlowStatus,
  RecommendationQuoteStatus,
  ServiceOrderStatus,
  WalletStatus,
  type Prisma,
} from "@prisma/client";

import { ensureWalletForUser } from "@/lib/wallet/ensure-wallet";
import { WalletError } from "@/lib/wallet/errors";
import {
  resolvePlanPricing,
  samePlanConfigurationSnapshot,
  samePriceSnapshot,
} from "@/lib/pricing/plan-pricing";
import { assertProviderRoute } from "@/lib/infrastructure/provider-routing";
import { transitionProductFlowTx } from "@/lib/product-flow/service";

export type PayOrderTxOptions = {
  /** Test-only: throw after debit ledger to verify full rollback. */
  testInjectFailureAfterDebit?: boolean;
};

const PAYABLE_QUOTE_STATUSES: RecommendationQuoteStatus[] = [
  RecommendationQuoteStatus.ACTIVE,
  RecommendationQuoteStatus.SELECTED,
];

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
  const order = await tx.serviceOrder.findUnique({
    where: { id: orderId },
    include: {
      plan: { include: { catalogItem: true } },
      recommendationQuote: { include: { session: true } },
    },
  });
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
    if (
      order.productFlowState === "REQUIREMENTS_COMPLETE" ||
      order.productFlowState === "QUOTE_EXPIRED"
    ) {
      throw new WalletError(
        "quote_refresh_required",
        "این سفارش قدیمی به انتخاب دوبارهٔ تنظیمات تحویل و Quote جدید نیاز دارد.",
      );
    }
    throw new WalletError("invalid_status", "این سفارش قابل پرداخت نیست.");
  }
  if (order.quoteExpiresAt && order.quoteExpiresAt.getTime() <= Date.now()) {
    throw new WalletError(
      "quote_expired",
      "اعتبار قیمت این سفارش تمام شده؛ قیمت را دوباره دریافت کنید.",
    );
  }
  if (order.recommendationQuote) {
    const quote = order.recommendationQuote;
    if (!PAYABLE_QUOTE_STATUSES.includes(quote.status)) {
      throw new WalletError("invalid_quote_status", "این پیشنهاد دیگر قابل پرداخت نیست.");
    }
    if (
      quote.expiresAt.getTime() <= Date.now() ||
      quote.session.expiresAt.getTime() <= Date.now()
    ) {
      throw new WalletError(
        "quote_expired",
        "اعتبار قیمت این سفارش تمام شده؛ قیمت را دوباره دریافت کنید.",
      );
    }
    if (quote.amountRial !== order.amount || quote.planId !== order.planId) {
      throw new WalletError("quote_mismatch", "جزئیات سفارش با پیشنهاد قفل‌شده همخوان نیست.");
    }
  }

  const plan = order.plan;
  if (!plan) {
    throw new WalletError("invalid_plan", "پلن سفارش معتبر نیست.");
  }
  assertProviderRoute({
    productKind: plan.productKind,
    provider: plan.provider,
    apiVersion: plan.providerApiVersion,
  });
  if (
    order.provider != null &&
    (order.provider !== plan.provider ||
      order.providerApiVersion !== plan.providerApiVersion ||
      order.productKind !== plan.productKind)
  ) {
    throw new WalletError(
      "order_provider_mismatch",
      "ارائه‌دهندهٔ قفل‌شدهٔ سفارش تغییر کرده است.",
    );
  }
  if (plan.provider === "ARVAN") {
    // The v1 lifecycle contract and fake orchestrator are implemented, but
    // real mutations are intentionally outside this task. Never debit a
    // customer for an Arvan order until the approved staging rollout wires
    // the adapter into the production worker.
    throw new WalletError(
      "provider_provisioning_not_enabled",
      "ساخت این سرور هنوز برای پرداخت فعال نشده است؛ مبلغی برداشت نشد.",
    );
  }
  const pricingConfig = await tx.providerPricingConfig.findUnique({
    where: { provider: plan.provider },
  });
  const parchinLevel =
    order.parchinLevel ??
    order.recommendationQuote?.parchinLevel ??
    plan.minimumParchinLevel ??
    "PARCHIN_START";
  const [productPricing, commerce, parchin] = await Promise.all([
    tx.productPricingConfig.findUnique({
      where: {
        provider_apiVersion_productKind: {
          provider: plan.provider,
          apiVersion: plan.providerApiVersion,
          productKind: plan.productKind,
        },
      },
    }),
    tx.commercePricingConfig.findUnique({ where: { id: "default" } }),
    tx.parchinPricingConfig.findUnique({ where: { level: parchinLevel } }),
  ]);
  const currentPricing =
    pricingConfig?.enabled &&
    productPricing?.enabled &&
    parchin?.active
      ? resolvePlanPricing(plan, pricingConfig, {
          productMarkupBasisPoints: productPricing.markupBasisPoints,
          taxBasisPoints: commerce?.taxBps ?? 1000,
          parchinLevel,
          parchinPriceRial: parchin.priceRial,
        })
      : null;
  if (!currentPricing) {
    throw new WalletError(
      "quote_unavailable",
      "ظرفیت این سفارش دیگر موجود نیست؛ پرداخت متوقف شد.",
    );
  }
  const snapshot = (order.planSnapshot ?? {}) as Record<string, unknown>;
  const lockedSnapshot = order.recommendationQuote
    ? order.recommendationQuote
    : {
        catalogItemId:
          typeof snapshot.catalogItemId === "string" ? snapshot.catalogItemId : null,
        providerBasePriceRialSnapshot:
          typeof snapshot.providerBasePriceRialSnapshot === "string"
            ? BigInt(snapshot.providerBasePriceRialSnapshot)
            : null,
        markupBasisPointsSnapshot:
          typeof snapshot.markupBasisPointsSnapshot === "number"
            ? snapshot.markupBasisPointsSnapshot
            : null,
        finalPriceRialSnapshot:
          typeof snapshot.finalPriceRialSnapshot === "string"
            ? BigInt(snapshot.finalPriceRialSnapshot)
            : null,
        currencySnapshot:
          typeof snapshot.currency === "string" ? snapshot.currency : null,
        parchinLevel:
          typeof snapshot.parchinLevel === "string"
            ? (snapshot.parchinLevel as typeof parchinLevel)
            : null,
        parchinPriceIrr:
          typeof snapshot.parchinPriceRialSnapshot === "string"
            ? BigInt(snapshot.parchinPriceRialSnapshot)
            : null,
        taxBasisPointsSnapshot:
          typeof snapshot.taxBasisPointsSnapshot === "number"
            ? snapshot.taxBasisPointsSnapshot
            : null,
        taxAmountIrr:
          typeof snapshot.taxAmountRialSnapshot === "string"
            ? BigInt(snapshot.taxAmountRialSnapshot)
            : null,
      };
  if (
    !samePriceSnapshot(currentPricing, lockedSnapshot) ||
    currentPricing.finalPriceRial !== order.amount
  ) {
    throw new WalletError(
      "quote_price_changed",
      "قیمت تغییر کرده است؛ پیش از پرداخت قیمت تازه را تأیید کنید.",
    );
  }
  if (!samePlanConfigurationSnapshot(plan, currentPricing, order.planSnapshot)) {
    throw new WalletError(
      "quote_configuration_changed",
      "تنظیمات سرور تغییر کرده است؛ پیش از پرداخت پیشنهاد تازه را تأیید کنید.",
    );
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
    data: {
      status: ServiceOrderStatus.PAID,
      paidAt: new Date(),
    },
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
      providerApiVersion: plan.providerApiVersion,
      productKind: plan.productKind,
      parchinLevel: currentPricing.parchinLevel,
      providerSelectionSnapshot: {
        provider: plan.provider,
        providerApiVersion: plan.providerApiVersion,
        productKind: plan.productKind,
        catalogItemId: currentPricing.catalogItemId,
        region: plan.regionCode,
        externalPlanId:
          plan.catalogItem?.externalPlanId ?? plan.sizeCode,
        externalImageId:
          order.recommendationQuote?.externalImageId ?? plan.imageCode,
        externalNetworkId:
          order.recommendationQuote?.externalNetworkId ?? null,
        externalSecurityId:
          order.recommendationQuote?.externalSecurityId ?? null,
        deliveryConfiguration:
          order.recommendationQuote?.deliveryConfigurationSnapshot ??
          null,
        parchinLevel: currentPricing.parchinLevel,
      },
      deliveryMode: plan.deliveryMode,
      status: InfrastructureOrderStatus.WAITING_ADMIN_FUNDING,
      requiredFundingRial: currentPricing.providerBasePriceRial,
      desiredInstanceName: `abrchin-${order.id.slice(-12)}-1`,
      productFlowState: "AWAITING_PAYMENT",
      productFlowRevision: order.productFlowRevision,
    },
  });
  await transitionProductFlowTx(tx, {
    owner: {
      recommendationSessionId:
        order.recommendationQuote?.sessionId ?? null,
      serviceOrderId: order.id,
      infrastructureOrderId: infrastructureOrder.id,
    },
    from: "AWAITING_PAYMENT",
    to: "PAID",
    reason: "wallet_payment_completed",
    idempotencyKey: `order-paid:${order.id}`,
    actorUserId: userId,
  });
  await tx.adminNotification.create({
    data: {
      type: AdminNotificationType.ORDER_WAITING_PROVIDER_FUNDING,
      infrastructureOrderId: infrastructureOrder.id,
      title: "سفارش منتظر تأمین زیرساخت",
      message: `سفارش ${order.title} پرداخت شد و منتظر تأمین زیرساخت است.`,
      status: AdminNotificationStatus.UNREAD,
    },
  });

  if (order.recommendationQuote) {
    await tx.recommendationQuote.update({
      where: { id: order.recommendationQuote.id },
      data: {
        status: RecommendationQuoteStatus.CONVERTED,
        convertedAt: new Date(),
      },
    });
    await tx.recommendationSession.update({
      where: { id: order.recommendationQuote.sessionId },
      data: {
        status: RecommendationFlowStatus.CONVERTED,
      },
    });
  }

  const paidOrder = await tx.serviceOrder.findUniqueOrThrow({ where: { id: order.id } });
  return { order: paidOrder, infrastructureOrder };
}
