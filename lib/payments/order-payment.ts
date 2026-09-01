import { createHash } from "node:crypto";

import { OrderPaymentStatus, type PaymentGatewayProvider } from "@prisma/client";

import { prisma } from "@/lib/db";
import { assertServerSecrets } from "@/lib/env";
import { WalletError } from "@/lib/wallet/errors";

function hashCallbackToken(token: string, secret: string) {
  return createHash("sha256").update(`${secret}:${token}`).digest("hex");
}

export async function createOrderPaymentIntent(input: {
  userId: string;
  orderId: string;
  idempotencyKey: string;
}): Promise<never> {
  void input;
  throw new WalletError(
    "direct_order_payment_disabled",
    "درگاه بانکی فقط کیف پول را شارژ می‌کند. پرداخت سفارش فقط با موجودی کیف پول انجام می‌شود.",
  );
}

/**
 * Historical callback lookup for legacy OrderPayment rows.
 * Never verifies a gateway, never credits a wallet, and never mutates an order.
 */
export async function finalizeOrderPaymentFromCallback(input: {
  expectedGateway: PaymentGatewayProvider;
  paymentId: string;
  token: string;
  authority?: string | null;
  statusHint?: string | null;
}) {
  void input.authority;
  void input.statusHint;
  const env = assertServerSecrets();
  const payment = await prisma.orderPayment.findUnique({
    where: { id: input.paymentId },
    include: { serviceOrder: true },
  });
  if (
    !payment ||
    payment.callbackTokenHash !== hashCallbackToken(input.token, env.sessionSecret)
  ) {
    throw new WalletError("invalid_callback", "بازگشت پرداخت معتبر نیست.");
  }
  if (payment.gateway !== input.expectedGateway) {
    throw new WalletError("gateway_mismatch", "بازگشت پرداخت معتبر نیست.");
  }
  return {
    payment,
    order: payment.serviceOrder,
    alreadySettled: payment.status === OrderPaymentStatus.SUCCEEDED,
    review: payment.status === OrderPaymentStatus.REVIEW,
    failed:
      payment.status === OrderPaymentStatus.FAILED ||
      payment.status === OrderPaymentStatus.CANCELED ||
      payment.status === OrderPaymentStatus.EXPIRED ||
      payment.status === OrderPaymentStatus.CREATED ||
      payment.status === OrderPaymentStatus.PENDING,
  };
}
