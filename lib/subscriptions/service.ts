import {
  AdminNotificationStatus,
  AdminNotificationType,
  LedgerDirection,
  LedgerStatus,
  LedgerType,
  RenewalQuoteStatus,
  SubscriptionStatus,
  WalletStatus,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  resolvePlanPricing,
  samePriceSnapshot,
} from "@/lib/pricing/plan-pricing";
import { getLifecyclePolicy } from "@/lib/billing/lifecycle-policy";
import { addBillingMonth, addGracePeriod } from "@/lib/subscriptions/period";
import { processLifecycleNotices } from "@/lib/subscriptions/lifecycle-notices";
import { ensureWalletForUser } from "@/lib/wallet/ensure-wallet";
import { WalletError } from "@/lib/wallet/errors";
import {
  resolveProviderSelectionDefaults,
  revalidateLockedSelection,
} from "@/lib/infrastructure/selection-revalidation";
import { serializeQuoteLineItems } from "@/lib/pricing/quote-line-items";
import { activateParchinEnrollmentTx } from "@/lib/parchin/operations";
import {
  snapshotParchinServiceContract,
  toParchinServiceContract,
} from "@/lib/parchin/service-contract";

export const RENEWAL_QUOTE_VALIDITY_MS = 10 * 60 * 1000;

const RENEWABLE_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAST_DUE,
  SubscriptionStatus.SUSPENDED,
];

async function revalidateRenewalSelection(subscription: {
  plan: {
    provider: "ARVAN";
    providerApiVersion: string;
    productKind: "CLOUD_SERVER" | "READY_INSTANT_SERVER";
    regionCode: string;
    sizeCode: string;
    imageCode: string;
    catalogItem: {
      externalPlanId: string | null;
      providerMonthlyPriceIrr: bigint | null;
    } | null;
  };
  sourceOrder: {
    recommendationQuote: {
      externalNetworkId: string | null;
      externalSecurityId: string | null;
    } | null;
  };
}) {
  const item = subscription.plan.catalogItem;
  if (!item?.providerMonthlyPriceIrr) {
    throw new WalletError(
      "renewal_unavailable",
      "قیمت فعلی زیرساخت قابل تأیید نیست.",
    );
  }
  const defaults =
    subscription.plan.provider === "ARVAN" &&
    !subscription.sourceOrder.recommendationQuote?.externalNetworkId
      ? await resolveProviderSelectionDefaults({
          provider: subscription.plan.provider,
          providerApiVersion: subscription.plan.providerApiVersion,
          productKind: subscription.plan.productKind,
          region: subscription.plan.regionCode,
        })
      : null;
  const current = await revalidateLockedSelection({
    provider: subscription.plan.provider,
    providerApiVersion: subscription.plan.providerApiVersion,
    productKind: subscription.plan.productKind,
    region: subscription.plan.regionCode,
    externalPlanId:
      subscription.plan.catalogItem?.externalPlanId ??
      subscription.plan.sizeCode,
    externalImageId: subscription.plan.imageCode,
    externalNetworkId:
      subscription.sourceOrder.recommendationQuote?.externalNetworkId ??
      defaults?.externalNetworkId ??
      null,
    externalSecurityId:
      subscription.sourceOrder.recommendationQuote?.externalSecurityId ??
      defaults?.externalSecurityId ??
      null,
  });
  if (current.monthlyPriceIrr !== item.providerMonthlyPriceIrr) {
    throw new WalletError(
      "renewal_price_changed",
      "قیمت زیرساخت تغییر کرده؛ Quote تمدید تازه دریافت کن.",
    );
  }
  return current;
}

export function toPublicRenewalQuote(quote: {
  id: string;
  finalPriceRialSnapshot: bigint;
  currency: string;
  providerPriceCheckedAt: Date;
  periodStartSnapshot: Date;
  periodEndSnapshot: Date;
  expiresAt: Date;
}) {
  return {
    id: quote.id,
    finalPriceRial: quote.finalPriceRialSnapshot.toString(),
    currency: quote.currency,
    providerPriceCheckedAt: quote.providerPriceCheckedAt.toISOString(),
    periodStart: quote.periodStartSnapshot.toISOString(),
    periodEnd: quote.periodEndSnapshot.toISOString(),
    expiresAt: quote.expiresAt.toISOString(),
  };
}

export async function createRenewalQuote(params: {
  instanceId: string;
  userId: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const subscription = await prisma.serviceSubscription.findUnique({
    where: { cloudInstanceId: params.instanceId },
    include: {
      cloudInstance: true,
      plan: { include: { catalogItem: true } },
      sourceOrder: { include: { recommendationQuote: true } },
    },
  });
  if (!subscription || subscription.userId !== params.userId) {
    throw new WalletError("not_found", "اشتراک این سرور پیدا نشد.");
  }
  if (!RENEWABLE_STATUSES.includes(subscription.status)) {
    throw new WalletError("invalid_status", "این اشتراک قابل تمدید نیست.");
  }
  if (subscription.cloudInstance.status === "TERMINATED") {
    throw new WalletError("instance_terminated", "سرور خاتمه یافته و قابل تمدید نیست.");
  }
  const providerPrice = await revalidateRenewalSelection(subscription);
  const config = await prisma.providerPricingConfig.findUnique({
    where: { provider: subscription.plan.provider },
  });
  const parchinLevel =
    subscription.parchinLevel ??
    subscription.plan.minimumParchinLevel ??
    "PARCHIN_START";
  const [productConfig, commerce, parchin] = await Promise.all([
    prisma.productPricingConfig.findUnique({
      where: {
        provider_apiVersion_productKind: {
          provider: subscription.plan.provider,
          apiVersion: subscription.plan.providerApiVersion,
          productKind: subscription.plan.productKind,
        },
      },
    }),
    prisma.commercePricingConfig.findUnique({ where: { id: "default" } }),
    prisma.parchinPricingConfig.findUnique({
      where: { level: parchinLevel },
    }),
  ]);
  const currentPricing =
    config?.enabled && productConfig?.enabled && parchin?.active
      ? resolvePlanPricing(subscription.plan, config, {
          productMarkupBasisPoints:
            subscription.plan.skuMarkupBasisPoints ??
            productConfig.markupBasisPoints,
          taxBasisPoints: commerce?.taxBps ?? 1000,
          parchinLevel,
          parchinPriceRial: parchin.priceRial,
        })
      : null;
  if (!currentPricing) {
    throw new WalletError(
      "renewal_unavailable",
      "قیمت یا ظرفیت فعلی این سرور قابل تأیید نیست؛ تمدید متوقف شد.",
    );
  }
  const periodStart = subscription.currentPeriodEnd;
  const periodEnd = addBillingMonth(periodStart);
  const expiresAt = new Date(now.getTime() + RENEWAL_QUOTE_VALIDITY_MS);

  return prisma.$transaction(async (tx) => {
    await tx.serviceRenewalQuote.updateMany({
      where: {
        subscriptionId: subscription.id,
        status: RenewalQuoteStatus.ACTIVE,
      },
      data: { status: RenewalQuoteStatus.INVALIDATED },
    });
    return tx.serviceRenewalQuote.create({
      data: {
        subscriptionId: subscription.id,
        userId: params.userId,
        catalogItemId: currentPricing.catalogItemId,
        status: RenewalQuoteStatus.ACTIVE,
        providerBasePriceRialSnapshot: currentPricing.providerBasePriceRial,
        markupBasisPointsSnapshot: currentPricing.markupBasisPoints,
        finalPriceRialSnapshot: currentPricing.finalPriceRial,
        currency: currentPricing.currency,
        providerPriceCheckedAt: providerPrice.checkedAt,
        provider: subscription.plan.provider,
        providerApiVersion: subscription.plan.providerApiVersion,
        productKind: subscription.plan.productKind,
        parchinLevel: currentPricing.parchinLevel,
        parchinPriceIrrSnapshot: currentPricing.parchinPriceRial,
        taxBasisPointsSnapshot: currentPricing.taxBasisPoints,
        taxAmountIrrSnapshot: currentPricing.taxAmountRial,
        lineItemsSnapshot: serializeQuoteLineItems(
          currentPricing.lineItems,
        ),
        periodStartSnapshot: periodStart,
        periodEndSnapshot: periodEnd,
        expiresAt,
      },
    });
  });
}

export async function payRenewalQuote(params: {
  instanceId: string;
  userId: string;
  renewalQuoteId: string;
}) {
  const preflight = await prisma.serviceRenewalQuote.findUnique({
    where: { id: params.renewalQuoteId },
    include: {
      subscription: {
        include: {
          plan: { include: { catalogItem: true } },
          sourceOrder: { include: { recommendationQuote: true } },
        },
      },
    },
  });
  if (!preflight || preflight.userId !== params.userId) {
    throw new WalletError("not_found", "پیشنهاد تمدید پیدا نشد.");
  }
  const providerPrice = await revalidateRenewalSelection(
    preflight.subscription,
  );
  if (
    providerPrice.monthlyPriceIrr !==
    preflight.providerBasePriceRialSnapshot
  ) {
    throw new WalletError(
      "renewal_price_changed",
      "قیمت زیرساخت تغییر کرده؛ Quote تمدید تازه دریافت کن.",
    );
  }
  return prisma.$transaction(async (tx) => {
    const quote = await tx.serviceRenewalQuote.findUnique({
      where: { id: params.renewalQuoteId },
      include: {
        subscription: {
          include: {
            cloudInstance: true,
            plan: { include: { catalogItem: true } },
          },
        },
      },
    });
    if (
      !quote ||
      quote.userId !== params.userId ||
      quote.subscription.cloudInstanceId !== params.instanceId
    ) {
      throw new WalletError("not_found", "پیشنهاد تمدید پیدا نشد.");
    }
    if (quote.status === RenewalQuoteStatus.PAID) {
      return quote.subscription;
    }
    if (quote.status !== RenewalQuoteStatus.ACTIVE) {
      throw new WalletError("invalid_quote_status", "این پیشنهاد تمدید معتبر نیست.");
    }
    if (quote.expiresAt.getTime() <= Date.now()) {
      throw new WalletError(
        "quote_expired",
        "اعتبار قیمت تمدید تمام شده؛ قیمت تازه را دریافت کنید.",
      );
    }
    const subscription = quote.subscription;
    if (!RENEWABLE_STATUSES.includes(subscription.status)) {
      throw new WalletError("invalid_status", "این اشتراک قابل تمدید نیست.");
    }
    if (subscription.cloudInstance.status === "TERMINATED") {
      throw new WalletError("instance_terminated", "سرور خاتمه یافته و قابل تمدید نیست.");
    }

    const config = await tx.providerPricingConfig.findUnique({
      where: { provider: subscription.plan.provider },
    });
    const parchinLevel =
      quote.parchinLevel ??
      subscription.parchinLevel ??
      subscription.plan.minimumParchinLevel ??
      "PARCHIN_START";
    const [productConfig, commerce, parchin] = await Promise.all([
      tx.productPricingConfig.findUnique({
        where: {
          provider_apiVersion_productKind: {
            provider: subscription.plan.provider,
            apiVersion: subscription.plan.providerApiVersion,
            productKind: subscription.plan.productKind,
          },
        },
      }),
      tx.commercePricingConfig.findUnique({ where: { id: "default" } }),
      tx.parchinPricingConfig.findUnique({ where: { level: parchinLevel } }),
    ]);
    const currentPricing =
      config?.enabled && productConfig?.enabled && parchin?.active
        ? resolvePlanPricing(subscription.plan, config, {
            productMarkupBasisPoints:
              subscription.plan.skuMarkupBasisPoints ??
              productConfig.markupBasisPoints,
            taxBasisPoints: commerce?.taxBps ?? 1000,
            parchinLevel,
            parchinPriceRial: parchin.priceRial,
          })
        : null;
    if (!currentPricing) {
      throw new WalletError(
        "renewal_unavailable",
        "ظرفیت فعلی ناموجود شده و تمدید متوقف شد.",
      );
    }
    if (
      !samePriceSnapshot(currentPricing, {
        catalogItemId: quote.catalogItemId,
        providerBasePriceRialSnapshot: quote.providerBasePriceRialSnapshot,
        markupBasisPointsSnapshot: quote.markupBasisPointsSnapshot,
        finalPriceRialSnapshot: quote.finalPriceRialSnapshot,
        currencySnapshot: quote.currency,
        parchinLevel: quote.parchinLevel,
        parchinPriceIrr: quote.parchinPriceIrrSnapshot,
        taxBasisPointsSnapshot: quote.taxBasisPointsSnapshot,
        taxAmountIrr: quote.taxAmountIrrSnapshot,
      })
    ) {
      throw new WalletError(
        "quote_price_changed",
        "قیمت تمدید تغییر کرده؛ قیمت تازه را تأیید کنید.",
      );
    }
    if (
      quote.periodStartSnapshot.getTime() !== subscription.currentPeriodEnd.getTime()
    ) {
      throw new WalletError("renewal_period_changed", "دوره اشتراک قبلاً تغییر کرده است.");
    }

    const idempotencyKey = `renewal_quote_pay_${quote.id}`;
    const existingLedger = await tx.walletLedgerEntry.findUnique({
      where: { idempotencyKey },
    });
    if (existingLedger?.status === LedgerStatus.COMPLETED) {
      const { postServiceRenewalCompleted } = await import(
        "@/lib/accounting/posting"
      );
      await postServiceRenewalCompleted(quote, tx);
      return tx.serviceSubscription.findUniqueOrThrow({
        where: { id: subscription.id },
      });
    }
    const wallet = await ensureWalletForUser(params.userId, tx);
    if (wallet.status !== WalletStatus.ACTIVE) {
      throw new WalletError("wallet_frozen", "کیف پول فعال نیست.");
    }
    const debited = await tx.wallet.updateMany({
      where: {
        id: wallet.id,
        status: WalletStatus.ACTIVE,
        availableBalance: { gte: quote.finalPriceRialSnapshot },
      },
      data: {
        availableBalance: { decrement: quote.finalPriceRialSnapshot },
      },
    });
    if (debited.count !== 1) {
      throw new WalletError("insufficient_funds", "موجودی برای تمدید کافی نیست.");
    }
    const freshWallet = await tx.wallet.findUniqueOrThrow({
      where: { id: wallet.id },
    });
    await tx.walletLedgerEntry.create({
      data: {
        walletId: wallet.id,
        direction: LedgerDirection.DEBIT,
        type: LedgerType.SERVICE_RENEWAL,
        amount: quote.finalPriceRialSnapshot,
        status: LedgerStatus.COMPLETED,
        referenceType: "renewal_quote",
        referenceId: quote.id,
        idempotencyKey,
        balanceAfter: freshWallet.availableBalance,
        description: `تمدید سرور ${subscription.cloudInstance.name}`,
        metadata: {
          subscriptionId: subscription.id,
          renewalQuoteId: quote.id,
          markupBasisPointsSnapshot: quote.markupBasisPointsSnapshot,
        },
      },
    });

    const renewed = await tx.serviceSubscription.update({
      where: { id: subscription.id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        parchinLevel,
        renewalPriceRial: quote.finalPriceRialSnapshot,
        currentPeriodStart: quote.periodStartSnapshot,
        currentPeriodEnd: quote.periodEndSnapshot,
        nextRenewalAt: quote.periodEndSnapshot,
        graceEndsAt: addGracePeriod(quote.periodEndSnapshot),
        autoRenew: false,
      },
    });
    if (parchin?.active) {
      await activateParchinEnrollmentTx(tx, {
        userId: subscription.userId,
        cloudInstanceId: subscription.cloudInstanceId,
        serviceOrderId: subscription.sourceOrderId,
        subscriptionId: subscription.id,
        level: parchinLevel,
        contractSnapshot: snapshotParchinServiceContract(
          toParchinServiceContract(parchin),
        ),
        activatedAt: quote.periodStartSnapshot,
        quotaPeriodStart: quote.periodStartSnapshot,
        quotaPeriodEnd: quote.periodEndSnapshot,
      });
    }
    const paidQuote = await tx.serviceRenewalQuote.update({
      where: { id: quote.id },
      data: {
        status: RenewalQuoteStatus.PAID,
        paidAt: new Date(),
      },
    });
    const { postServiceRenewalCompleted } = await import(
      "@/lib/accounting/posting"
    );
    await postServiceRenewalCompleted(paidQuote, tx);
    await tx.adminNotification.create({
      data: {
        type: AdminNotificationType.RENEWAL_PAID,
        title: "تمدید سرور پرداخت شد",
        message: `اشتراک سرور ${subscription.cloudInstance.name} تا ${quote.periodEndSnapshot.toISOString()} تمدید شد.`,
        status: AdminNotificationStatus.UNREAD,
      },
    });
    return renewed;
  });
}

async function markSubscriptionPastDue(
  subscription: {
    id: string;
    currentPeriodEnd: Date;
    user?: { mobile: string | null } | null;
    cloudInstance: { infrastructureOrderId: string; name: string };
  },
  now: Date,
  graceDays: number,
) {
  const ok = await prisma.$transaction(async (tx) => {
    const changed = await tx.serviceSubscription.updateMany({
      where: {
        id: subscription.id,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: { lte: now },
      },
      data: {
        status: SubscriptionStatus.PAST_DUE,
        autoRenew: false,
        graceEndsAt: addGracePeriod(subscription.currentPeriodEnd, graceDays),
      },
    });
    if (changed.count !== 1) return false;

    await tx.parchinEnrollment.updateMany({
      where: { subscriptionId: subscription.id, status: "ACTIVE" },
      data: { status: "PAST_DUE" },
    });

    await tx.adminNotification.create({
      data: {
        type: AdminNotificationType.RENEWAL_DUE,
        infrastructureOrderId: subscription.cloudInstance.infrastructureOrderId,
        title: "تمدید سرور سررسید شد",
        message: `اشتراک سرور ${subscription.cloudInstance.name} وارد مهلت پرداخت شد.`,
        status: AdminNotificationStatus.UNREAD,
      },
    });
    return true;
  });
  if (ok && subscription.user?.mobile) {
    try {
      const { sendLifecycleSms } = await import(
        "@/lib/subscriptions/lifecycle-notices"
      );
      await sendLifecycleSms({
        mobile: subscription.user.mobile,
        serverName: subscription.cloudInstance.name,
        kind: "past_due",
      });
    } catch (error) {
      console.error(
        "[lifecycle:past-due-sms]",
        error instanceof Error ? error.message : "unknown",
      );
    }
  }
  return ok;
}

async function markSubscriptionSuspended(
  subscription: {
    id: string;
    user?: { mobile: string | null } | null;
    cloudInstance: { infrastructureOrderId: string; name: string };
  },
  now: Date,
) {
  const ok = await prisma.$transaction(async (tx) => {
    const changed = await tx.serviceSubscription.updateMany({
      where: {
        id: subscription.id,
        status: SubscriptionStatus.PAST_DUE,
        graceEndsAt: { lte: now },
      },
      data: {
        status: SubscriptionStatus.SUSPENDED,
        autoRenew: false,
        suspendedAt: now,
      },
    });
    if (changed.count !== 1) return false;

    await tx.parchinEnrollment.updateMany({
      where: { subscriptionId: subscription.id, status: "PAST_DUE" },
      data: { status: "SUSPENDED" },
    });

    await tx.adminNotification.create({
      data: {
        type: AdminNotificationType.RENEWAL_DUE,
        infrastructureOrderId: subscription.cloudInstance.infrastructureOrderId,
        title: "مهلت تمدید سرور تمام شد",
        message: `اشتراک سرور ${subscription.cloudInstance.name} معلق شد و نیاز به بررسی عملیاتی دارد.`,
        status: AdminNotificationStatus.UNREAD,
      },
    });
    return true;
  });
  if (ok && subscription.user?.mobile) {
    try {
      const { sendLifecycleSms } = await import(
        "@/lib/subscriptions/lifecycle-notices"
      );
      await sendLifecycleSms({
        mobile: subscription.user.mobile,
        serverName: subscription.cloudInstance.name,
        kind: "suspended",
      });
    } catch (error) {
      console.error(
        "[lifecycle:suspend-sms]",
        error instanceof Error ? error.message : "unknown",
      );
    }
  }
  return ok;
}

export async function processSubscriptionLifecycle(now = new Date()) {
  const policy = await getLifecyclePolicy();
  const notices = await processLifecycleNotices(now);

  const due = await prisma.serviceSubscription.findMany({
    where: {
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: { lte: now },
    },
    include: {
      user: { select: { mobile: true } },
      cloudInstance: {
        select: { infrastructureOrderId: true, name: true },
      },
    },
    orderBy: { currentPeriodEnd: "asc" },
    take: 50,
  });

  let pastDue = 0;
  for (const subscription of due) {
    if (
      await markSubscriptionPastDue(
        subscription,
        now,
        policy.suspendGraceDaysAfterZero,
      )
    ) {
      pastDue += 1;
    }
  }

  const graceExpired = await prisma.serviceSubscription.findMany({
    where: {
      status: SubscriptionStatus.PAST_DUE,
      graceEndsAt: { lte: now },
    },
    include: {
      user: { select: { mobile: true } },
      cloudInstance: {
        select: { infrastructureOrderId: true, name: true },
      },
    },
    orderBy: { graceEndsAt: "asc" },
    take: 50,
  });

  let suspended = 0;
  for (const subscription of graceExpired) {
    if (await markSubscriptionSuspended(subscription, now)) suspended += 1;
  }

  return {
    renewed: 0,
    pastDue,
    suspended,
    reminders: notices.reminders,
    deleteReviews: notices.deleteReviews,
  };
}
