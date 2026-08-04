import { createHash, randomBytes } from "node:crypto";

import {
  LedgerDirection,
  LedgerStatus,
  LedgerType,
  type OrderPayment,
  OrderPaymentStatus,
  type PaymentGatewayEnvironment,
  WalletStatus,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { assertServerSecrets } from "@/lib/env";
import { assertPublicSaleEnabled } from "@/lib/infrastructure/public-sale-policy";
import { executePayOrderWithWalletTx } from "@/lib/orders/pay-order-tx";
import { PaymentError } from "@/lib/payments/errors";
import {
  resolveDefaultPaymentGateway,
  resolveProviderForTopUp,
} from "@/lib/payments/gateway-resolver";
import type { GatewayConfigSnapshot } from "@/lib/payments/gateway-config";
import { providerEnumToSlug } from "@/lib/payments/types";
import type { VerifyPaymentResult } from "@/lib/payments/types";
import { ensureWalletForUser } from "@/lib/wallet/ensure-wallet";
import { WalletError } from "@/lib/wallet/errors";

const ORDER_PAYMENT_TTL_MS = 15 * 60 * 1000;

function hashCallbackToken(token: string, secret: string) {
  return createHash("sha256").update(`${secret}:${token}`).digest("hex");
}

function generateCallbackToken() {
  return randomBytes(24).toString("base64url");
}

function snapshotEnvironment(snapshot: GatewayConfigSnapshot | null | undefined):
  | PaymentGatewayEnvironment
  | undefined {
  return snapshot?.environment;
}

function asGatewaySnapshot(value: unknown): GatewayConfigSnapshot | null {
  return value && typeof value === "object"
    ? (value as GatewayConfigSnapshot)
    : null;
}

export async function createOrderPaymentIntent(input: {
  userId: string;
  orderId: string;
  idempotencyKey: string;
}) {
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(input.idempotencyKey)) {
    throw new WalletError("invalid_idempotency_key", "شناسه یکتای پرداخت معتبر نیست.");
  }
  const env = assertServerSecrets();
  const [resolved, order, wallet] = await Promise.all([
    resolveDefaultPaymentGateway(),
    prisma.serviceOrder.findFirst({
      where: { id: input.orderId, userId: input.userId },
      include: {
        orderPayment: true,
        plan: { include: { catalogItem: true } },
        recommendationQuote: { include: { session: true } },
      },
    }),
    ensureWalletForUser(input.userId),
  ]);
  if (!order) throw new WalletError("not_found", "سفارش پیدا نشد.");
  if (order.plan?.billingModel === "PAYG_WALLET") {
    throw new WalletError(
      "direct_checkout_not_allowed",
      "درگاه بانکی برای سرور ابری فقط Wallet را شارژ می‌کند.",
    );
  }
  if (order.plan) {
    assertPublicSaleEnabled({
      provider: order.plan.provider,
      productKind: order.plan.productKind,
      offerSource: order.plan.offerSource,
    });
    if (order.plan.offerSource === "API_CATALOG") {
      const [catalogState, regionSaleEnabled] = await Promise.all([
        prisma.providerCatalogState.findUnique({
          where: { provider: order.plan.provider },
        }),
        order.plan.provider === "ARVAN"
          ? prisma.providerRegionConfig.findFirst({
              where: {
                provider: order.plan.provider,
                apiVersion: order.plan.providerApiVersion,
                regionCode: order.plan.regionCode,
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
      if (
        !fresh ||
        !regionSaleEnabled ||
        order.plan.catalogItem?.status !== "ACTIVE" ||
        !order.plan.catalogItem.available
      ) {
        throw new WalletError(
          "quote_unavailable",
          "قیمت یا ظرفیت این سفارش تازه نیست؛ ایجاد پرداخت متوقف شد.",
        );
      }
    }
  }
  if (wallet.status !== WalletStatus.ACTIVE) {
    throw new WalletError("wallet_frozen", "حساب پرداخت فعال نیست.");
  }
  if (order.status === "PAID") {
    return { payment: order.orderPayment, redirectUrl: null, alreadyPaid: true as const };
  }
  if (order.status !== "PENDING_PAYMENT") {
    throw new WalletError("invalid_status", "این سفارش قابل پرداخت نیست.");
  }
  const now = new Date();
  if (order.quoteExpiresAt && order.quoteExpiresAt <= now) {
    throw new WalletError(
      "quote_expired",
      "اعتبار قیمت این سفارش تمام شده است؛ پرداخت ایجاد نشد.",
    );
  }
  if (
    order.recommendationQuote &&
    (!["ACTIVE", "SELECTED"].includes(
      order.recommendationQuote.status,
    ) ||
      order.recommendationQuote.expiresAt <= now ||
      order.recommendationQuote.session.expiresAt <= now ||
      order.recommendationQuote.amountRial !== order.amount ||
      order.recommendationQuote.planId !== order.planId)
  ) {
    throw new WalletError(
      "quote_expired",
      "Estimate قفل‌شده معتبر نیست؛ پرداخت ایجاد نشد.",
    );
  }

  const byKey = await prisma.orderPayment.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (byKey) {
    if (byKey.serviceOrderId !== order.id || byKey.amount !== order.amount) {
      throw new WalletError("idempotency_conflict", "شناسه یکتا با پرداخت دیگری استفاده شده است.");
    }
    if (!byKey.redirectUrl && byKey.status !== OrderPaymentStatus.SUCCEEDED) {
      throw new WalletError("request_in_progress", "پرداخت در حال آماده‌سازی است؛ کمی بعد دوباره تلاش کنید.");
    }
    return { payment: byKey, redirectUrl: byKey.redirectUrl, alreadyPaid: false as const };
  }
  if (order.orderPayment) {
    if (order.orderPayment.status === OrderPaymentStatus.PENDING && order.orderPayment.redirectUrl) {
      return {
        payment: order.orderPayment,
        redirectUrl: order.orderPayment.redirectUrl,
        alreadyPaid: false as const,
      };
    }
    if (order.orderPayment.status === OrderPaymentStatus.REVIEW) {
      throw new WalletError("payment_review", "پرداخت دریافت شده و در انتظار بررسی است.");
    }
    throw new WalletError("payment_exists", "برای این سفارش یک پرداخت قبلی ثبت شده است.");
  }

  const callbackToken = generateCallbackToken();
  let payment: OrderPayment;
  try {
    payment = await prisma.orderPayment.create({
      data: {
        serviceOrderId: order.id,
        amount: order.amount,
        gateway: resolved.config.provider,
        idempotencyKey: input.idempotencyKey,
        callbackTokenHash: hashCallbackToken(callbackToken, env.sessionSecret),
        gatewayConfigSnapshot: resolved.snapshot,
        expiresAt: new Date(Date.now() + ORDER_PAYMENT_TTL_MS),
      },
    });
  } catch (error) {
    const existing = await prisma.orderPayment.findUnique({
      where: { serviceOrderId: order.id },
    });
    if (!existing) throw error;
    if (existing.idempotencyKey !== input.idempotencyKey) {
      throw new WalletError("payment_exists", "برای این سفارش یک پرداخت قبلی ثبت شده است.");
    }
    if (!existing.redirectUrl) {
      throw new WalletError("request_in_progress", "پرداخت در حال آماده‌سازی است؛ کمی بعد دوباره تلاش کنید.");
    }
    return { payment: existing, redirectUrl: existing.redirectUrl, alreadyPaid: false as const };
  }
  const callbackUrl = new URL(
    `/api/payments/${providerEnumToSlug(payment.gateway)}/callback?paymentId=${payment.id}&token=${callbackToken}`,
    env.paymentCallbackBaseUrl,
  ).toString();

  try {
    const created = await resolved.provider.createPayment({
      amountRial: payment.amount,
      description: `پرداخت سفارش ${order.title}`,
      callbackUrl,
      metadata: { orderPaymentId: payment.id, orderId: order.id },
    });
    const pending = await prisma.orderPayment.update({
      where: { id: payment.id },
      data: {
        status: OrderPaymentStatus.PENDING,
        authority: created.authority,
        gatewayReference: created.gatewayReference ?? created.authority,
        redirectUrl: created.redirectUrl,
      },
    });
    return { payment: pending, redirectUrl: pending.redirectUrl, alreadyPaid: false as const };
  } catch (error) {
    await prisma.orderPayment.update({
      where: { id: payment.id },
      data: {
        // A failed create call can mean a network timeout after the gateway
        // accepted it, so it is never treated as safely retryable by default.
        status: OrderPaymentStatus.REVIEW,
        failureCode: error instanceof PaymentError ? error.code : "provider_error",
        failureMessage: "ایجاد پرداخت ممکن نشد",
      },
    });
    throw error;
  }
}

export async function finalizeOrderPaymentFromCallback(input: {
  expectedGateway: "ZIBAL" | "ZARINPAL" | "MOCK";
  paymentId: string;
  token: string;
  authority?: string | null;
  statusHint?: string | null;
}) {
  const env = assertServerSecrets();
  const payment = await prisma.orderPayment.findUnique({
    where: { id: input.paymentId },
    include: { serviceOrder: true },
  });
  if (!payment || payment.callbackTokenHash !== hashCallbackToken(input.token, env.sessionSecret)) {
    throw new WalletError("invalid_callback", "بازگشت پرداخت معتبر نیست.");
  }
  if (payment.gateway !== input.expectedGateway) {
    throw new WalletError("gateway_mismatch", "بازگشت پرداخت معتبر نیست.");
  }
  if (payment.status === OrderPaymentStatus.SUCCEEDED) {
    return { payment, order: payment.serviceOrder, alreadySettled: true as const };
  }
  if (payment.status === OrderPaymentStatus.REVIEW) {
    return { payment, order: payment.serviceOrder, alreadySettled: false as const, review: true as const };
  }
  if (payment.status === OrderPaymentStatus.EXPIRED || payment.expiresAt.getTime() <= Date.now()) {
    const expired = await prisma.orderPayment.update({
      where: { id: payment.id },
      data: { status: OrderPaymentStatus.EXPIRED, failureCode: "expired", failureMessage: "مهلت پرداخت تمام شده است" },
    });
    return { payment: expired, order: payment.serviceOrder, alreadySettled: false as const, failed: true as const };
  }
  if (payment.status === OrderPaymentStatus.FAILED || payment.status === OrderPaymentStatus.CANCELED) {
    return { payment, order: payment.serviceOrder, alreadySettled: false as const, failed: true as const };
  }
  const authority = input.authority || payment.authority;
  if (!authority) throw new WalletError("missing_authority", "شناسه پرداخت موجود نیست.");

  let verified: VerifyPaymentResult;
  try {
    const provider = await resolveProviderForTopUp(
      payment.gateway,
      snapshotEnvironment(asGatewaySnapshot(payment.gatewayConfigSnapshot)),
    );
    verified = await provider.verifyPayment({
      authority,
      expectedAmountRial: payment.amount,
      statusHint: input.statusHint,
    });
  } catch (error) {
    const review = await prisma.orderPayment.update({
      where: { id: payment.id },
      data: {
        status: OrderPaymentStatus.REVIEW,
        failureCode: error instanceof PaymentError ? error.code : "verify_unavailable",
        failureMessage: "تأیید پرداخت نیازمند بررسی است",
      },
    });
    return { payment: review, order: payment.serviceOrder, alreadySettled: false as const, review: true as const };
  }
  if (!verified.ok) {
    const failed = await prisma.orderPayment.update({
      where: { id: payment.id },
      data: {
        status: verified.code === "canceled" ? OrderPaymentStatus.CANCELED : OrderPaymentStatus.FAILED,
        failureCode: verified.code,
        failureMessage: "پرداخت تأیید نشد",
      },
    });
    return { payment: failed, order: payment.serviceOrder, alreadySettled: false as const, failed: true as const };
  }
  if (verified.amountRial !== payment.amount || verified.currency !== "IRR") {
    const review = await prisma.orderPayment.update({
      where: { id: payment.id },
      data: {
        status: OrderPaymentStatus.REVIEW,
        failureCode: "amount_mismatch",
        failureMessage: "مبلغ پرداخت‌شده نیازمند بررسی است",
      },
    });
    return { payment: review, order: payment.serviceOrder, alreadySettled: false as const, review: true as const };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const claimed = await tx.orderPayment.updateMany({
        where: { id: payment.id, status: { in: [OrderPaymentStatus.CREATED, OrderPaymentStatus.PENDING] } },
        data: {
          status: OrderPaymentStatus.SUCCEEDED,
          authority: verified.authority,
          gatewayReference: verified.gatewayReference,
          verifiedAt: new Date(),
        },
      });
      if (claimed.count !== 1) {
        const current = await tx.orderPayment.findUniqueOrThrow({
          where: { id: payment.id },
          include: { serviceOrder: true },
        });
        return { payment: current, order: current.serviceOrder, alreadySettled: true as const };
      }
      const payableOrder = await tx.serviceOrder.findUniqueOrThrow({
        where: { id: payment.serviceOrderId },
        select: { status: true },
      });
      if (payableOrder.status !== "PENDING_PAYMENT") {
        throw new WalletError(
          "order_already_paid",
          "سفارش پیش از نهایی‌سازی پرداخت تغییر کرده و نیازمند بررسی است.",
        );
      }
      const wallet = await ensureWalletForUser(payment.serviceOrder.userId, tx);
      if (wallet.status !== WalletStatus.ACTIVE) {
        throw new WalletError("wallet_frozen", "حساب پرداخت فعال نیست.");
      }
      const creditedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: { availableBalance: { increment: payment.amount } },
      });
      await tx.walletLedgerEntry.create({
        data: {
          walletId: wallet.id,
          direction: LedgerDirection.CREDIT,
          type: LedgerType.TOP_UP,
          amount: payment.amount,
          status: LedgerStatus.COMPLETED,
          referenceType: "order_payment",
          referenceId: payment.id,
          idempotencyKey: `order_payment_credit_${payment.id}`,
          balanceAfter: creditedWallet.availableBalance,
          description: `پرداخت درگاه برای سفارش ${payment.serviceOrder.title}`,
          metadata: { gateway: payment.gateway, authority: verified.authority },
        },
      });
      const settled = await executePayOrderWithWalletTx(
        tx,
        payment.serviceOrder.userId,
        payment.serviceOrderId,
      );
      const current = await tx.orderPayment.findUniqueOrThrow({
        where: { id: payment.id },
      });
      return { payment: current, order: settled.order, alreadySettled: false as const };
    });
  } catch (error) {
    const review = await prisma.orderPayment.update({
      where: { id: payment.id },
      data: {
        status: OrderPaymentStatus.REVIEW,
        failureCode: error instanceof WalletError ? error.code : "settlement_error",
        failureMessage: "پرداخت دریافت شده و نیازمند بررسی است",
      },
    });
    return { payment: review, order: payment.serviceOrder, alreadySettled: false as const, review: true as const };
  }
}
