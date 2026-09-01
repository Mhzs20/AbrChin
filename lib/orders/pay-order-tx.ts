import {
  AdminNotificationStatus,
  AdminNotificationType,
  InfrastructureOrderStatus,
  InfrastructureProvider,
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
} from "@/lib/pricing/plan-pricing";
import { assertProviderRoute } from "@/lib/infrastructure/provider-routing";
import { assertPublicSaleEnabled } from "@/lib/infrastructure/public-sale-policy";
import {
  assertProductFlowOwnerStateTx,
  transitionProductFlowTx,
} from "@/lib/product-flow/service";
import {
  lockReservedInventoryForPaymentTx,
} from "@/lib/infrastructure/preprovisioned-inventory";

export type PayOrderTxOptions = {
  /** Test-only: throw after debit ledger to verify full rollback. */
  testInjectFailureAfterDebit?: boolean;
};

function resolveDesiredInstanceName(input: {
  orderId: string;
  deliveryConfiguration: Prisma.JsonValue | null;
}) {
  if (
    input.deliveryConfiguration &&
    typeof input.deliveryConfiguration === "object" &&
    !Array.isArray(input.deliveryConfiguration)
  ) {
    const serverName = (input.deliveryConfiguration as Record<string, unknown>)
      .serverName;
    if (typeof serverName === "string" && serverName.trim().length >= 2) {
      return serverName.trim().slice(0, 64);
    }
  }
  return `abrchin-${input.orderId.slice(-12)}-1`;
}

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
    await assertProductFlowOwnerStateTx(
      tx,
      {
        recommendationSessionId: quote.sessionId,
        serviceOrderId: order.id,
      },
      "AWAITING_PAYMENT",
    );
  }

  const plan = order.plan;
  if (!plan) {
    throw new WalletError("invalid_plan", "پلن سفارش معتبر نیست.");
  }
  if (plan.billingModel === "PAYG_WALLET") {
    throw new WalletError(
      "direct_checkout_not_allowed",
      "خرید مستقیم سرور ابری PAYG مجاز نیست.",
    );
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
  const preprovisioned =
    plan.offerSource === "PREPROVISIONED_INVENTORY";
  const manualAdmin = plan.offerSource === "MANUAL_ADMIN";
  assertPublicSaleEnabled({
    provider: plan.provider,
    productKind: plan.productKind,
    offerSource: plan.offerSource,
  });
  if (plan.offerSource === "API_CATALOG") {
    const [catalogState, regionSaleEnabled] = await Promise.all([
      tx.providerCatalogState.findUnique({
        where: { provider: plan.provider },
      }),
      plan.provider === InfrastructureProvider.ARVAN
        ? tx.providerRegionConfig.findFirst({
            where: {
              provider: plan.provider,
              apiVersion: plan.providerApiVersion,
              regionCode: plan.regionCode,
              saleEnabled: true,
            },
            select: { id: true },
          })
        : Promise.resolve({ id: "not-required" }),
    ]);
    const lastSync = catalogState?.lastCatalogSync;
    const fresh =
      catalogState?.lastSyncStatus === "SUCCEEDED" &&
      lastSync != null &&
      Date.now() - lastSync.getTime() <=
        (catalogState.freshnessSlaSeconds ?? 900) * 1000;
    if (!regionSaleEnabled || !fresh) {
      throw new WalletError(
        "quote_unavailable",
        "قیمت یا ظرفیت این سفارش تازه نیست؛ مبلغی برداشت نشد.",
      );
    }
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
  const termMonths =
    order.termMonths === 3 ||
    order.termMonths === 6 ||
    order.termMonths === 12
      ? order.termMonths
      : 1;
  const currentPricing =
    (manualAdmin || (pricingConfig?.enabled && productPricing?.enabled)) &&
    parchin?.active
      ? resolvePlanPricing(plan, manualAdmin ? null : pricingConfig, {
          productMarkupBasisPoints: manualAdmin
            ? 0
            : plan.skuMarkupBasisPoints ?? productPricing!.markupBasisPoints,
          taxBasisPoints: commerce?.taxBps ?? 1000,
          parchinLevel,
          parchinPriceRial: parchin.priceRial,
          termMonths,
          couponDiscountBps:
            order.recommendationQuote?.couponDiscountBpsSnapshot ?? null,
          couponCode: order.couponCodeSnapshot,
        })
      : null;
  if (!currentPricing) {
    throw new WalletError(
      "quote_unavailable",
      "ظرفیت این سفارش دیگر موجود نیست؛ پرداخت متوقف شد.",
    );
  }
  // Locked customer amount is authoritative for the 60-minute quote TTL.
  // Live commercial recomputation (markup/tax/Parchin/provider sale price)
  // must not reject payment or change the wallet debit.
  if (order.recommendationQuote) {
    if (order.recommendationQuote.amountRial !== order.amount) {
      throw new WalletError(
        "quote_mismatch",
        "جزئیات سفارش با پیشنهاد قفل‌شده همخوان نیست.",
      );
    }
  }
  if (!samePlanConfigurationSnapshot(plan, currentPricing, order.planSnapshot)) {
    throw new WalletError(
      "quote_configuration_changed",
      "تنظیمات سرور تغییر کرده است؛ پیش از پرداخت پیشنهاد تازه را تأیید کنید.",
    );
  }

  const inventory = preprovisioned
    ? order.recommendationQuote?.preprovisionedInventoryItemId
      ? await lockReservedInventoryForPaymentTx(tx, {
          inventoryItemId:
            order.recommendationQuote.preprovisionedInventoryItemId,
          quoteId: order.recommendationQuote.id,
          orderId: order.id,
          revision: order.productFlowRevision,
          expected: {
            planId: plan.id,
            catalogItemId: plan.catalogItem!.id,
            provider: plan.provider,
            apiVersion: plan.providerApiVersion,
            regionCode: plan.regionCode,
            externalPlanId:
              plan.catalogItem?.externalPlanId ?? plan.sizeCode,
            externalImageId:
              order.recommendationQuote.externalImageId!,
            externalNetworkId:
              order.recommendationQuote.externalNetworkId!,
            externalSecurityId:
              order.recommendationQuote.externalSecurityId!,
          },
        })
      : null
    : null;
  if (
    preprovisioned &&
    (!inventory ||
      inventory.provider !== plan.provider ||
      inventory.apiVersion !== plan.providerApiVersion ||
      inventory.planId !== plan.id ||
      inventory.catalogItemId !== plan.catalogItem?.id ||
      inventory.regionCode !== plan.regionCode ||
      inventory.externalPlanId !==
        (plan.catalogItem?.externalPlanId ?? plan.sizeCode) ||
      inventory.externalImageId !==
        order.recommendationQuote?.externalImageId ||
      inventory.observedNetworkId !==
        order.recommendationQuote?.externalNetworkId ||
      inventory.observedSecurityId !==
        order.recommendationQuote?.externalSecurityId)
  ) {
    throw new WalletError(
      "inventory_snapshot_mismatch",
      "موجودی رزروشده با Snapshot سفارش یکسان نیست؛ مبلغی برداشت نشد.",
    );
  }
  if (manualAdmin) {
    if (!plan.catalogItemId) {
      throw new WalletError(
        "inventory_unavailable",
        "موجودی دستی این سفارش معتبر نیست؛ مبلغی برداشت نشد.",
      );
    }
    const reserved = await tx.providerCatalogItem.updateMany({
      where: {
        id: plan.catalogItemId,
        source: "MANUAL_ADMIN",
        active: true,
        status: "ACTIVE",
        manualAvailableUnits: { gt: 0 },
        manualPriceValidUntil: { gt: new Date() },
      },
      data: {
        manualAvailableUnits: { decrement: 1 },
      },
    });
    if (reserved.count !== 1) {
      throw new WalletError(
        "inventory_unavailable",
        "ظرفیت دستی این سفارش تمام شده است؛ مبلغی برداشت نشد.",
      );
    }
  }

  const amountRial = order.amount;
  if (amountRial <= 1n) {
    throw new WalletError(
      "pricing_unavailable",
      "قیمت این سفارش معتبر نیست؛ مبلغی برداشت نشد.",
    );
  }
  const idempotencyKey = `order_pay_${order.id}`;

  const existingLedger = await tx.walletLedgerEntry.findUnique({ where: { idempotencyKey } });
  if (existingLedger?.status === LedgerStatus.COMPLETED) {
    if (order.couponCodeSnapshot) {
      const { recordCouponRedemptionTx } = await import("@/lib/coupons/service");
      const coupon = await tx.coupon.findUnique({
        where: { code: order.couponCodeSnapshot },
      });
      if (coupon) {
        await recordCouponRedemptionTx(tx, {
          couponId: coupon.id,
          userId,
          serviceOrderId: order.id,
          amountRial: order.amount,
          idempotencyKey: `coupon-order:${order.id}`,
        });
      }
    }
    const paidOrder = await tx.serviceOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { recommendationQuote: true },
    });
    const { postServicePurchaseCompleted } = await import(
      "@/lib/accounting/posting"
    );
    await postServicePurchaseCompleted(paidOrder, tx);
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

  {
    const paidForAccounting = await tx.serviceOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { recommendationQuote: true },
    });
    const { postServicePurchaseCompleted } = await import(
      "@/lib/accounting/posting"
    );
    await postServicePurchaseCompleted(paidForAccounting, tx);
  }

  if (order.couponCodeSnapshot) {
    const { recordCouponRedemptionTx } = await import("@/lib/coupons/service");
    const coupon = await tx.coupon.findUnique({
      where: { code: order.couponCodeSnapshot },
    });
    if (coupon) {
      await recordCouponRedemptionTx(tx, {
        couponId: coupon.id,
        userId,
        serviceOrderId: order.id,
        amountRial,
        idempotencyKey: `coupon-order:${order.id}`,
      });
    }
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
      parchinLevel:
        order.parchinLevel ??
        order.recommendationQuote?.parchinLevel ??
        currentPricing.parchinLevel,
      providerSelectionSnapshot: {
        provider: plan.provider,
        providerApiVersion: plan.providerApiVersion,
        productKind: plan.productKind,
        offerSource: plan.offerSource,
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
        topologyVerificationMode: "STRICT_OBSERVED",
        deliveryConfiguration:
          order.recommendationQuote?.deliveryConfigurationSnapshot ??
          null,
        parchinLevel:
          order.parchinLevel ??
          order.recommendationQuote?.parchinLevel ??
          currentPricing.parchinLevel,
        preprovisionedInventoryItemId: inventory?.id ?? null,
        providerResourceId: inventory?.providerResourceId ?? null,
        manualInventoryReserved: manualAdmin,
      },
      deliveryMode: plan.deliveryMode,
      // Payment only establishes a paid order. Assignment, resource creation,
      // and provider mutation begin exclusively after the first Admin approval.
      status: InfrastructureOrderStatus.WAITING_ADMIN_FUNDING,
      requiredFundingRial: manualAdmin || preprovisioned
        ? 0n
        : currentPricing.providerBasePriceRial,
      desiredInstanceName: resolveDesiredInstanceName({
        orderId: order.id,
        deliveryConfiguration:
          order.recommendationQuote?.deliveryConfigurationSnapshot ?? null,
      }),
      productFlowState: "AWAITING_PAYMENT",
      productFlowRevision: order.productFlowRevision,
      preprovisionedInventoryItemId: inventory?.id ?? null,
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
      title: "سفارش منتظر تأیید ساخت",
      message: `سفارش ${order.title} پرداخت شد و منتظر تأیید اول ادمین برای ساخت است.`,
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
