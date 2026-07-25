import { createHash, randomBytes } from "node:crypto";

import { LedgerType, TopUpStatus, type PaymentGatewayEnvironment } from "@prisma/client";

import { prisma } from "@/lib/db";
import { assertServerSecrets } from "@/lib/env";
import { assertPositiveIntegerToman, tomanToRial } from "@/lib/money";
import {
  MAX_TOPUP_TOMAN,
  MIN_TOPUP_TOMAN,
  TOPUP_TTL_MS,
} from "@/lib/wallet/topup-limits";
import {
  PaymentError,
  resolveDefaultPaymentGateway,
  resolveProviderForTopUp,
  type GatewayConfigSnapshot,
} from "@/lib/payments";
import { WalletError } from "@/lib/wallet/ledger";
import { ensureWalletForUser } from "@/lib/wallet/ensure-wallet";
import { providerEnumToSlug } from "@/lib/payments/types";

export { MAX_TOPUP_TOMAN, MIN_TOPUP_TOMAN, TOPUP_TTL_MS } from "@/lib/wallet/topup-limits";

function hashCallbackToken(token: string, secret: string) {
  return createHash("sha256").update(`${secret}:${token}`).digest("hex");
}

function generateToken() {
  return randomBytes(24).toString("base64url");
}

function snapshotEnvironment(snapshot: GatewayConfigSnapshot | null | undefined): PaymentGatewayEnvironment | undefined {
  return snapshot?.environment;
}

export async function createTopUpIntent(userId: string, amountTomanRaw: unknown) {
  const amountToman = assertPositiveIntegerToman(amountTomanRaw);
  if (amountToman < MIN_TOPUP_TOMAN || amountToman > MAX_TOPUP_TOMAN) {
    throw new WalletError(
      "amount_out_of_range",
      `مبلغ شارژ باید بین ${MIN_TOPUP_TOMAN.toLocaleString("fa-IR")} تا ${MAX_TOPUP_TOMAN.toLocaleString("fa-IR")} تومان باشد.`,
    );
  }

  const env = assertServerSecrets();
  const resolved = await resolveDefaultPaymentGateway();
  const wallet = await ensureWalletForUser(userId);
  const amountRial = tomanToRial(amountToman);
  const callbackToken = generateToken();
  const idempotencyKey = `topup_create_${userId}_${Date.now()}_${randomBytes(6).toString("hex")}`;
  const expiresAt = new Date(Date.now() + TOPUP_TTL_MS);

  const topUp = await prisma.walletTopUp.create({
    data: {
      walletId: wallet.id,
      amount: amountRial,
      gateway: resolved.config.provider,
      status: TopUpStatus.CREATED,
      idempotencyKey,
      callbackTokenHash: hashCallbackToken(callbackToken, env.sessionSecret),
      gatewayConfigSnapshot: resolved.snapshot,
      expiresAt,
    },
  });

  const slug = providerEnumToSlug(resolved.config.provider);
  const callbackUrl = new URL(
    `/api/payments/${slug}/callback?topUpId=${topUp.id}&token=${callbackToken}`,
    env.paymentCallbackBaseUrl,
  ).toString();

  try {
    // No automatic failover to a second provider — would create dual external intents.
    const payment = await resolved.provider.createPayment({
      amountRial,
      description: `شارژ کیف پول ابرچین - ${amountToman} تومان`,
      callbackUrl,
      metadata: { topUpId: topUp.id },
    });

    const pending = await prisma.walletTopUp.update({
      where: { id: topUp.id },
      data: {
        status: TopUpStatus.PENDING,
        authority: payment.authority,
        gatewayReference: payment.gatewayReference ?? payment.authority,
      },
    });

    return {
      topUp: pending,
      redirectUrl: payment.redirectUrl,
      callbackToken,
      gatewayDisplayName: resolved.config.displayName,
    };
  } catch (error) {
    await prisma.walletTopUp.update({
      where: { id: topUp.id },
      data: {
        status: TopUpStatus.FAILED,
        failureCode: error instanceof PaymentError ? error.code : "provider_error",
        failureMessage: "ایجاد پرداخت ناموفق بود",
      },
    });
    throw error;
  }
}

export async function finalizeTopUpFromCallback(params: {
  expectedGateway: "ZIBAL" | "ZARINPAL" | "MOCK";
  topUpId: string;
  token: string;
  authority?: string | null;
  statusHint?: string | null;
}) {
  const env = assertServerSecrets();
  const tokenHash = hashCallbackToken(params.token, env.sessionSecret);

  const topUp = await prisma.walletTopUp.findUnique({ where: { id: params.topUpId } });
  if (!topUp || topUp.callbackTokenHash !== tokenHash) {
    throw new WalletError("invalid_callback", "درخواست بازگشت پرداخت نامعتبر است.");
  }

  if (topUp.gateway !== params.expectedGateway) {
    throw new WalletError("gateway_mismatch", "درخواست بازگشت پرداخت نامعتبر است.");
  }

  if (topUp.status === TopUpStatus.SUCCEEDED) {
    return { topUp, alreadySettled: true as const };
  }

  if (topUp.status === TopUpStatus.EXPIRED || topUp.expiresAt.getTime() <= Date.now()) {
    const expired = await prisma.walletTopUp.update({
      where: { id: topUp.id },
      data: { status: TopUpStatus.EXPIRED, failureCode: "expired", failureMessage: "منقضی شده" },
    });
    return { topUp: expired, alreadySettled: false as const, failed: true as const };
  }

  if (topUp.status === TopUpStatus.FAILED || topUp.status === TopUpStatus.CANCELED) {
    return { topUp, alreadySettled: false as const, failed: true as const };
  }

  const authority = params.authority || topUp.authority;
  if (!authority) {
    throw new WalletError("missing_authority", "شناسه پرداخت موجود نیست.");
  }

  const snapshot =
    topUp.gatewayConfigSnapshot && typeof topUp.gatewayConfigSnapshot === "object"
      ? (topUp.gatewayConfigSnapshot as GatewayConfigSnapshot)
      : null;

  const provider = await resolveProviderForTopUp(
    topUp.gateway,
    snapshotEnvironment(snapshot),
  );

  const verified = await provider.verifyPayment({
    authority,
    expectedAmountRial: topUp.amount,
    statusHint: params.statusHint,
  });

  if (!verified.ok) {
    const failed = await prisma.walletTopUp.update({
      where: { id: topUp.id },
      data: {
        status: verified.code === "canceled" ? TopUpStatus.CANCELED : TopUpStatus.FAILED,
        failureCode: verified.code,
        failureMessage: "پرداخت تأیید نشد",
      },
    });
    return { topUp: failed, alreadySettled: false as const, failed: true as const };
  }

  if (verified.amountRial !== topUp.amount) {
    const failed = await prisma.walletTopUp.update({
      where: { id: topUp.id },
      data: {
        status: TopUpStatus.FAILED,
        failureCode: "amount_mismatch",
        failureMessage: "مبلغ پرداخت با درخواست هم‌خوانی ندارد",
      },
    });
    return { topUp: failed, alreadySettled: false as const, failed: true as const };
  }

  const settled = await prisma.$transaction(async (tx) => {
    const claimed = await tx.walletTopUp.updateMany({
      where: {
        id: topUp.id,
        status: { in: [TopUpStatus.CREATED, TopUpStatus.PENDING] },
      },
      data: {
        status: TopUpStatus.SUCCEEDED,
        authority: verified.authority,
        gatewayReference: verified.gatewayReference,
        verifiedAt: new Date(),
      },
    });

    if (claimed.count !== 1) {
      const current = await tx.walletTopUp.findUniqueOrThrow({ where: { id: topUp.id } });
      return { topUp: current, credited: false as const };
    }

    const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: topUp.walletId } });
    const updatedWallet = await tx.wallet.update({
      where: { id: wallet.id },
      data: { availableBalance: { increment: topUp.amount } },
    });

    await tx.walletLedgerEntry.create({
      data: {
        walletId: wallet.id,
        direction: "CREDIT",
        type: LedgerType.TOP_UP,
        amount: topUp.amount,
        status: "COMPLETED",
        referenceType: "topup",
        referenceId: topUp.id,
        idempotencyKey: `topup_credit_${topUp.id}`,
        balanceAfter: updatedWallet.availableBalance,
        description: "شارژ کیف پول",
        metadata: { gateway: topUp.gateway, authority: verified.authority },
      },
    });

    const current = await tx.walletTopUp.findUniqueOrThrow({ where: { id: topUp.id } });
    return { topUp: current, credited: true as const };
  });

  return {
    topUp: settled.topUp,
    alreadySettled: settled.topUp.status === TopUpStatus.SUCCEEDED && !settled.credited,
    failed: false as const,
  };
}
