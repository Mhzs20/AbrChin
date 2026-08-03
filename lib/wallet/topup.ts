import { createHash, randomBytes } from "node:crypto";

import {
  LedgerType,
  PaymentAttemptStatus,
  Prisma,
  TopUpStatus,
  type PaymentGatewayEnvironment,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { assertServerSecrets } from "@/lib/env";
import { assertPositiveIntegerToman, tomanToRial } from "@/lib/money";
import {
  PaymentError,
  resolveDefaultPaymentGateway,
  resolveProviderForTopUp,
  type CreatePaymentResult,
  type GatewayConfigSnapshot,
  type PaymentProvider,
  type VerifyPaymentResult,
} from "@/lib/payments/index";
import { providerEnumToSlug } from "@/lib/payments/types";
import { ensureWalletForUser } from "@/lib/wallet/ensure-wallet";
import { WalletError } from "@/lib/wallet/ledger";
import {
  MAX_TOPUP_TOMAN,
  MIN_TOPUP_TOMAN,
  TOPUP_TTL_MS,
  calculateWalletShortfallRial,
} from "@/lib/wallet/topup-limits";

export {
  MAX_TOPUP_TOMAN,
  MIN_TOPUP_TOMAN,
  TOPUP_TTL_MS,
} from "@/lib/wallet/topup-limits";

type TopUpIntentOptions = {
  idempotencyKey?: string;
  purchaseOrderId?: string;
  requestFingerprint?: string;
};

type VerificationDependencies = {
  provider?: PaymentProvider;
  afterGatewayVerify?: () => Promise<void>;
  now?: () => Date;
};

type VerifiedPayment = Extract<VerifyPaymentResult, { ok: true }>;

const TRANSIENT_VERIFY_CODES = new Set([
  "configuration",
  "gateway_unavailable",
  "http_error",
  "invalid_json",
  "invalid_response",
  "network",
  "provider_error",
  "timeout",
  "verify_failed",
]);

const TERMINAL_VERIFY_CODES = new Set([
  "canceled",
  "failed",
  "invalid_authority",
]);

const NON_EXPIRABLE_ATTEMPT_STATUSES = new Set<PaymentAttemptStatus>([
  PaymentAttemptStatus.SUCCEEDED,
  PaymentAttemptStatus.FAILED,
  PaymentAttemptStatus.CANCELED,
]);

const RETRYABLE_ATTEMPT_STATUSES = new Set<PaymentAttemptStatus>([
  PaymentAttemptStatus.FAILED,
  PaymentAttemptStatus.CANCELED,
  PaymentAttemptStatus.EXPIRED,
]);

function hashCallbackToken(token: string, secret: string) {
  return createHash("sha256").update(`${secret}:${token}`).digest("hex");
}

function generateToken() {
  return randomBytes(24).toString("base64url");
}

function snapshotEnvironment(
  snapshot: GatewayConfigSnapshot | null | undefined,
): PaymentGatewayEnvironment | undefined {
  return snapshot?.environment;
}

function asGatewaySnapshot(
  value: Prisma.JsonValue | null,
): GatewayConfigSnapshot | null {
  return value && typeof value === "object"
    ? (value as GatewayConfigSnapshot)
    : null;
}

function safeFailureCode(error: unknown) {
  return error instanceof PaymentError ? error.code : "provider_error";
}

function nextReconcileAt(now: Date) {
  return new Date(now.getTime() + 5 * 60 * 1000);
}

async function withSerializableRetry<T>(
  operation: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" ||
          error.code === "P2002" ||
          (error.code === "P2010" && error.meta?.code === "40001"));
      if (!retryable || attempt === attempts) throw error;
    }
  }
  throw lastError;
}

async function createExternalPaymentForAttempt(input: {
  provider: PaymentProvider;
  gatewayDisplayName: string;
  topUpId: string;
  attemptId: string;
  callbackToken: string;
  amountRial: bigint;
  purchaseOrderId?: string | null;
}) {
  const env = assertServerSecrets();
  const slug = providerEnumToSlug(input.provider.prismaProvider);
  const callbackUrl = new URL(
    `/api/payments/${slug}/callback?attemptId=${input.attemptId}&token=${input.callbackToken}`,
    env.paymentCallbackBaseUrl,
  ).toString();

  let payment: CreatePaymentResult;
  try {
    payment = await input.provider.createPayment({
      amountRial: input.amountRial,
      description: `شارژ کیف پول ابرچین - ${input.amountRial / 10n} تومان`,
      callbackUrl,
      metadata: {
        topUpId: input.topUpId,
        paymentAttemptId: input.attemptId,
        ...(input.purchaseOrderId
          ? { purchaseOrderId: input.purchaseOrderId }
          : {}),
      },
    });
  } catch (error) {
    const code = safeFailureCode(error);
    await prisma.$transaction([
      prisma.paymentAttempt.updateMany({
        where: {
          id: input.attemptId,
          status: { not: PaymentAttemptStatus.SUCCEEDED },
        },
        data: {
          status: PaymentAttemptStatus.FAILED,
          failureCode: code,
          failureMessage: "ایجاد پرداخت ناموفق بود",
        },
      }),
      prisma.walletTopUp.updateMany({
        where: {
          id: input.topUpId,
          status: { not: TopUpStatus.SUCCEEDED },
        },
        data: {
          status: TopUpStatus.FAILED,
          failureCode: code,
          failureMessage: "ایجاد پرداخت ناموفق بود",
        },
      }),
    ]);
    throw error;
  }

  try {
    const [attempt, topUp] = await prisma.$transaction([
      prisma.paymentAttempt.update({
        where: { id: input.attemptId },
        data: {
          status: PaymentAttemptStatus.PENDING,
          authority: payment.authority,
          gatewayReference: payment.gatewayReference ?? payment.authority,
          redirectUrl: payment.redirectUrl,
        },
      }),
      prisma.walletTopUp.update({
        where: { id: input.topUpId },
        data: {
          gateway: input.provider.prismaProvider,
          status: TopUpStatus.PENDING,
          authority: payment.authority,
          gatewayReference: payment.gatewayReference ?? payment.authority,
          redirectUrl: payment.redirectUrl,
          failureCode: null,
          failureMessage: null,
        },
      }),
    ]);

    return {
      topUp,
      attempt,
      redirectUrl: payment.redirectUrl,
      callbackToken: input.callbackToken,
      gatewayDisplayName: input.gatewayDisplayName,
    };
  } catch {
    try {
      await prisma.$transaction(async (tx) => {
        const attempt = await tx.paymentAttempt.update({
          where: { id: input.attemptId },
          data: {
            status: PaymentAttemptStatus.REVIEW,
            authority: payment.authority,
            gatewayReference:
              payment.gatewayReference ?? payment.authority,
            redirectUrl: payment.redirectUrl,
            failureCode: "payment_intent_persist_failed",
            failureMessage:
              "پرداخت ساخته شده و ثبت نتیجه نیازمند تطبیق است",
            nextReconcileAt: nextReconcileAt(new Date()),
          },
        });
        await tx.walletTopUp.updateMany({
          where: {
            id: input.topUpId,
            status: { not: TopUpStatus.SUCCEEDED },
          },
          data: {
            status: TopUpStatus.PENDING,
            authority: payment.authority,
            gatewayReference:
              payment.gatewayReference ?? payment.authority,
            redirectUrl: payment.redirectUrl,
            failureCode: "payment_intent_persist_failed",
            failureMessage:
              "پرداخت ساخته شده و ثبت نتیجه نیازمند تطبیق است",
          },
        });
        await tx.paymentRecoveryCase.upsert({
          where: { attemptId: attempt.id },
          create: {
            walletTopUpId: input.topUpId,
            attemptId: attempt.id,
            reasonCode: "payment_intent_persist_failed",
            safeMessage:
              "پرداخت درگاه ساخته شده و پیش از هر تلاش جدید باید تطبیق شود.",
            expectedAmount: input.amountRial,
            expectedCurrency: "IRR",
            nextAttemptAt: nextReconcileAt(new Date()),
          },
          update: {
            status: "OPEN",
            reasonCode: "payment_intent_persist_failed",
            safeMessage:
              "پرداخت درگاه ساخته شده و پیش از هر تلاش جدید باید تطبیق شود.",
            nextAttemptAt: nextReconcileAt(new Date()),
            resolvedAt: null,
          },
        });
      });
    } catch {
      // The attempt remains non-retryable when persistence is unavailable,
      // preventing a blind second external payment.
    }
    throw new WalletError(
      "payment_intent_reconciliation_required",
      "پرداخت ساخته شده و نتیجه آن باید پیش از تلاش جدید تطبیق شود.",
    );
  }
}

async function createTopUpIntentRial(
  userId: string,
  amountRial: bigint,
  options: TopUpIntentOptions = {},
) {
  if (amountRial <= 0n || amountRial > BigInt(MAX_TOPUP_TOMAN) * 10n) {
    throw new WalletError(
      "amount_out_of_range",
      `مبلغ شارژ باید مثبت و حداکثر ${MAX_TOPUP_TOMAN.toLocaleString("fa-IR")} تومان باشد.`,
    );
  }

  const env = assertServerSecrets();
  const wallet = await ensureWalletForUser(userId);
  const idempotencyKey =
    options.idempotencyKey ??
    `topup_create_${userId}_${Date.now()}_${randomBytes(6).toString("hex")}`;

  const replay = await prisma.walletTopUp.findUnique({
    where: { idempotencyKey },
    include: { paymentAttempts: { orderBy: { attemptNumber: "desc" }, take: 1 } },
  });
  if (replay) {
    if (
      replay.walletId !== wallet.id ||
      replay.amount !== amountRial ||
      replay.purchaseOrderId !== (options.purchaseOrderId ?? null) ||
      replay.requestFingerprint !== (options.requestFingerprint ?? null)
    ) {
      throw new WalletError(
        "idempotency_conflict",
        "شناسه یکتا با درخواست شارژ دیگری استفاده شده است.",
      );
    }
    const latest = replay.paymentAttempts[0];
    if (!latest?.redirectUrl && replay.status !== TopUpStatus.SUCCEEDED) {
      throw new WalletError(
        "request_in_progress",
        "درخواست شارژ در حال ساخته‌شدن است؛ کمی بعد دوباره تلاش کنید.",
      );
    }
    return {
      topUp: replay,
      attempt: latest ?? null,
      redirectUrl: latest?.redirectUrl ?? replay.redirectUrl ?? "",
      callbackToken: null,
      gatewayDisplayName: null,
    };
  }

  const resolved = await resolveDefaultPaymentGateway();
  const callbackToken = generateToken();
  const callbackTokenHash = hashCallbackToken(
    callbackToken,
    env.sessionSecret,
  );
  const expiresAt = new Date(Date.now() + TOPUP_TTL_MS);

  const created = await prisma.$transaction(async (tx) => {
    const topUp = await tx.walletTopUp.create({
      data: {
        walletId: wallet.id,
        amount: amountRial,
        gateway: resolved.config.provider,
        status: TopUpStatus.CREATED,
        idempotencyKey,
        purchaseOrderId: options.purchaseOrderId,
        requestFingerprint: options.requestFingerprint,
        callbackTokenHash,
        gatewayConfigSnapshot: resolved.snapshot,
        expiresAt,
      },
    });
    const attempt = await tx.paymentAttempt.create({
      data: {
        walletTopUpId: topUp.id,
        attemptNumber: 1,
        amount: amountRial,
        currency: "IRR",
        gateway: resolved.config.provider,
        status: PaymentAttemptStatus.CREATED,
        callbackTokenHash,
        gatewayConfigSnapshot: resolved.snapshot,
        expiresAt,
        idempotencyKey: `payment-attempt:${topUp.id}:1`,
      },
    });
    return { topUp, attempt };
  });

  return createExternalPaymentForAttempt({
    provider: resolved.provider,
    gatewayDisplayName: resolved.config.displayName,
    topUpId: created.topUp.id,
    attemptId: created.attempt.id,
    callbackToken,
    amountRial,
    purchaseOrderId: options.purchaseOrderId,
  });
}

export async function createTopUpIntent(
  userId: string,
  amountTomanRaw: unknown,
) {
  const amountToman = assertPositiveIntegerToman(amountTomanRaw);
  if (amountToman < MIN_TOPUP_TOMAN || amountToman > MAX_TOPUP_TOMAN) {
    throw new WalletError(
      "amount_out_of_range",
      `مبلغ شارژ باید بین ${MIN_TOPUP_TOMAN.toLocaleString("fa-IR")} تا ${MAX_TOPUP_TOMAN.toLocaleString("fa-IR")} تومان باشد.`,
    );
  }
  return createTopUpIntentRial(userId, tomanToRial(amountToman));
}

export async function createPurchaseShortfallTopUpIntent(input: {
  userId: string;
  orderId: string;
  idempotencyKey: string;
}) {
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(input.idempotencyKey)) {
    throw new WalletError(
      "invalid_idempotency_key",
      "شناسه یکتای درخواست معتبر نیست.",
    );
  }
  const [order, wallet] = await Promise.all([
    prisma.serviceOrder.findFirst({
      where: {
        id: input.orderId,
        userId: input.userId,
        status: "PENDING_PAYMENT",
      },
      select: { id: true, amount: true, recommendationQuoteId: true },
    }),
    ensureWalletForUser(input.userId),
  ]);
  if (!order?.recommendationQuoteId) {
    throw new WalletError("invalid_order", "سفارش قابل شارژ پیدا نشد.");
  }
  const shortfallRial = calculateWalletShortfallRial(
    order.amount,
    wallet.availableBalance,
  );
  if (shortfallRial <= 0n) {
    throw new WalletError(
      "topup_not_required",
      "موجودی کیف پول برای پرداخت این سفارش کافی است.",
    );
  }
  const requestFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        userId: input.userId,
        orderId: order.id,
        amountRial: shortfallRial.toString(),
      }),
    )
    .digest("hex");
  return createTopUpIntentRial(input.userId, shortfallRial, {
    idempotencyKey: input.idempotencyKey,
    purchaseOrderId: order.id,
    requestFingerprint,
  });
}

export async function retryTopUpPayment(input: {
  userId: string;
  topUpId: string;
  idempotencyKey: string;
}) {
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(input.idempotencyKey)) {
    throw new WalletError(
      "invalid_idempotency_key",
      "شناسه یکتای درخواست معتبر نیست.",
    );
  }
  const replay = await prisma.paymentAttempt.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: {
      walletTopUp: {
        include: { wallet: { select: { userId: true } } },
      },
    },
  });
  if (replay) {
    if (
      replay.walletTopUp.wallet.userId !== input.userId ||
      replay.walletTopUpId !== input.topUpId
    ) {
      throw new WalletError(
        "idempotency_conflict",
        "شناسه یکتا با درخواست پرداخت دیگری استفاده شده است.",
      );
    }
    return {
      topUp: replay.walletTopUp,
      attempt: replay,
      redirectUrl: replay.redirectUrl ?? "",
      callbackToken: null,
      gatewayDisplayName: null,
    };
  }

  const env = assertServerSecrets();
  const resolved = await resolveDefaultPaymentGateway();
  const callbackToken = generateToken();
  const callbackTokenHash = hashCallbackToken(
    callbackToken,
    env.sessionSecret,
  );
  const expiresAt = new Date(Date.now() + TOPUP_TTL_MS);

  const created = await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "WalletTopUp" WHERE id = ${input.topUpId} FOR UPDATE`;
        const topUp = await tx.walletTopUp.findFirst({
          where: { id: input.topUpId, wallet: { userId: input.userId } },
          include: {
            paymentAttempts: {
              orderBy: { attemptNumber: "desc" },
              take: 1,
            },
          },
        });
        if (!topUp) {
          throw new WalletError(
            "topup_not_found",
            "درخواست شارژ پیدا نشد.",
          );
        }
        if (topUp.status === TopUpStatus.SUCCEEDED) {
          throw new WalletError(
            "topup_already_succeeded",
            "این شارژ قبلاً موفق شده است.",
          );
        }
        const latest = topUp.paymentAttempts[0];
        if (
          latest &&
          latest.expiresAt.getTime() <= Date.now() &&
          !NON_EXPIRABLE_ATTEMPT_STATUSES.has(latest.status)
        ) {
          await tx.paymentAttempt.update({
            where: { id: latest.id },
            data: {
              status: PaymentAttemptStatus.EXPIRED,
              failureCode: "expired",
              failureMessage: "مهلت محلی پرداخت منقضی شده است",
            },
          });
          latest.status = PaymentAttemptStatus.EXPIRED;
        }
        if (
          latest &&
          !RETRYABLE_ATTEMPT_STATUSES.has(latest.status)
        ) {
          throw new WalletError(
            "attempt_not_retryable",
            "این تلاش پرداخت هنوز نیازمند تطبیق است و پرداخت جدید مجاز نیست.",
          );
        }
        const attemptNumber = (latest?.attemptNumber ?? 0) + 1;
        const attempt = await tx.paymentAttempt.create({
          data: {
            walletTopUpId: topUp.id,
            attemptNumber,
            amount: topUp.amount,
            currency: "IRR",
            gateway: resolved.config.provider,
            status: PaymentAttemptStatus.CREATED,
            callbackTokenHash,
            gatewayConfigSnapshot: resolved.snapshot,
            expiresAt,
            idempotencyKey: input.idempotencyKey,
          },
        });
        await tx.walletTopUp.update({
          where: { id: topUp.id },
          data: {
            gateway: resolved.config.provider,
            gatewayConfigSnapshot: resolved.snapshot,
            callbackTokenHash,
            expiresAt,
            status: TopUpStatus.CREATED,
            authority: null,
            gatewayReference: null,
            redirectUrl: null,
            failureCode: null,
            failureMessage: null,
          },
        });
        return { topUp, attempt };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );

  return createExternalPaymentForAttempt({
    provider: resolved.provider,
    gatewayDisplayName: resolved.config.displayName,
    topUpId: created.topUp.id,
    attemptId: created.attempt.id,
    callbackToken,
    amountRial: created.topUp.amount,
    purchaseOrderId: created.topUp.purchaseOrderId,
  });
}

async function recordPaymentReview(input: {
  attemptId: string;
  reasonCode: string;
  safeMessage: string;
  observedAmount?: bigint | null;
  observedCurrency?: string | null;
  transient: boolean;
  now: Date;
}) {
  return prisma.$transaction(async (tx) => {
    const attempt = await tx.paymentAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
      include: { walletTopUp: true },
    });
    if (attempt.status === PaymentAttemptStatus.SUCCEEDED) {
      return { attempt, topUp: attempt.walletTopUp };
    }
    const nextAttempt = input.transient
      ? nextReconcileAt(input.now)
      : null;
    const updatedAttempt = await tx.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: PaymentAttemptStatus.REVIEW,
        failureCode: input.reasonCode,
        failureMessage: input.safeMessage,
        nextReconcileAt: nextAttempt,
      },
    });
    const topUp =
      attempt.walletTopUp.status === TopUpStatus.SUCCEEDED
        ? attempt.walletTopUp
        : await tx.walletTopUp.update({
            where: { id: attempt.walletTopUpId },
            data: {
              status: TopUpStatus.PENDING,
              failureCode: input.reasonCode,
              failureMessage: input.safeMessage,
            },
          });
    await tx.paymentRecoveryCase.upsert({
      where: { attemptId: attempt.id },
      create: {
        walletTopUpId: attempt.walletTopUpId,
        attemptId: attempt.id,
        status: "OPEN",
        reasonCode: input.reasonCode,
        safeMessage: input.safeMessage,
        expectedAmount: attempt.amount,
        observedAmount: input.observedAmount,
        expectedCurrency: attempt.currency,
        observedCurrency: input.observedCurrency,
        nextAttemptAt: nextAttempt,
      },
      update: {
        status: "OPEN",
        reasonCode: input.reasonCode,
        safeMessage: input.safeMessage,
        observedAmount: input.observedAmount,
        observedCurrency: input.observedCurrency,
        nextAttemptAt: nextAttempt,
        resolvedAt: null,
      },
    });
    return { attempt: updatedAttempt, topUp };
  });
}

async function recordTerminalFailure(input: {
  attemptId: string;
  code: string;
  now: Date;
}) {
  return prisma.$transaction(async (tx) => {
    const attempt = await tx.paymentAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
      include: { walletTopUp: true },
    });
    if (
      attempt.status === PaymentAttemptStatus.SUCCEEDED ||
      attempt.walletTopUp.status === TopUpStatus.SUCCEEDED
    ) {
      return { attempt, topUp: attempt.walletTopUp };
    }
    const status =
      input.code === "canceled"
        ? PaymentAttemptStatus.CANCELED
        : PaymentAttemptStatus.FAILED;
    const topUpStatus =
      input.code === "canceled" ? TopUpStatus.CANCELED : TopUpStatus.FAILED;
    const updatedAttempt = await tx.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status,
        failureCode: input.code,
        failureMessage: "پرداخت به‌صورت قطعی تأیید نشد",
        nextReconcileAt: null,
        verificationAttempts: { increment: 1 },
      },
    });
    const topUp = await tx.walletTopUp.update({
      where: { id: attempt.walletTopUpId },
      data: {
        status: topUpStatus,
        failureCode: input.code,
        failureMessage: "پرداخت به‌صورت قطعی تأیید نشد",
      },
    });
    await tx.paymentRecoveryCase.updateMany({
      where: { attemptId: attempt.id, status: { not: "RESOLVED" } },
      data: {
        status: "DEFINITIVELY_FAILED",
        resolvedAt: input.now,
        nextAttemptAt: null,
      },
    });
    return { attempt: updatedAttempt, topUp };
  });
}

async function settleVerifiedAttempt(
  attemptId: string,
  verified: VerifiedPayment,
  now: Date,
) {
  const settlement = await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "PaymentAttempt" WHERE id = ${attemptId} FOR UPDATE`;
        const attempt = await tx.paymentAttempt.findUniqueOrThrow({
          where: { id: attemptId },
          include: { walletTopUp: true },
        });
        await tx.$queryRaw`SELECT id FROM "WalletTopUp" WHERE id = ${attempt.walletTopUpId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "Wallet" WHERE id = ${attempt.walletTopUp.walletId} FOR UPDATE`;

        const existingLedger = await tx.walletLedgerEntry.findUnique({
          where: {
            idempotencyKey: `topup_credit_${attempt.walletTopUpId}`,
          },
        });
        if (
          attempt.status === PaymentAttemptStatus.SUCCEEDED &&
          existingLedger
        ) {
          return {
            topUp: attempt.walletTopUp,
            attempt,
            credited: false as const,
            duplicateSuccessfulAttempt: false as const,
          };
        }

        const otherSuccessfulAttempt = await tx.paymentAttempt.findFirst({
          where: {
            walletTopUpId: attempt.walletTopUpId,
            status: PaymentAttemptStatus.SUCCEEDED,
            id: { not: attempt.id },
          },
        });
        if (otherSuccessfulAttempt || (attempt.walletTopUp.status === TopUpStatus.SUCCEEDED && existingLedger)) {
          return {
            topUp: attempt.walletTopUp,
            attempt,
            credited: false as const,
            duplicateSuccessfulAttempt: true as const,
          };
        }

        const wallet = await tx.wallet.findUniqueOrThrow({
          where: { id: attempt.walletTopUp.walletId },
        });
        if (wallet.currency !== "IRR") {
          throw new WalletError(
            "wallet_currency_mismatch",
            "واحد پول کیف پول با پرداخت سازگار نیست.",
          );
        }

        let credited = false;
        if (!existingLedger) {
          const updatedWallet = await tx.wallet.update({
            where: { id: wallet.id },
            data: {
              availableBalance: {
                increment: attempt.walletTopUp.amount,
              },
            },
          });
          await tx.walletLedgerEntry.create({
            data: {
              walletId: wallet.id,
              direction: "CREDIT",
              type: LedgerType.TOP_UP,
              amount: attempt.walletTopUp.amount,
              status: "COMPLETED",
              referenceType: "wallet_topup",
              referenceId: attempt.walletTopUpId,
              idempotencyKey: `topup_credit_${attempt.walletTopUpId}`,
              balanceAfter: updatedWallet.availableBalance,
              description: "شارژ کیف پول",
              metadata: {
                gateway: attempt.gateway,
                paymentAttemptId: attempt.id,
                gatewayReference: verified.gatewayReference,
              },
            },
          });
          credited = true;
        }

        const updatedAttempt = await tx.paymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: PaymentAttemptStatus.SUCCEEDED,
            authority: verified.authority,
            gatewayReference: verified.gatewayReference,
            verifiedAt: now,
            nextReconcileAt: null,
            verificationAttempts: { increment: 1 },
            failureCode: null,
            failureMessage: null,
          },
        });
        const topUp = await tx.walletTopUp.update({
          where: { id: attempt.walletTopUpId },
          data: {
            status: TopUpStatus.SUCCEEDED,
            gateway: attempt.gateway,
            authority: verified.authority,
            gatewayReference: verified.gatewayReference,
            verifiedAt: now,
            failureCode: null,
            failureMessage: null,
          },
        });
        await tx.paymentRecoveryCase.updateMany({
          where: { attemptId: attempt.id },
          data: {
            status: "RESOLVED",
            resolvedAt: now,
            nextAttemptAt: null,
          },
        });
        return {
          topUp,
          attempt: updatedAttempt,
          credited,
          duplicateSuccessfulAttempt: false as const,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );

  if (settlement.duplicateSuccessfulAttempt) {
    const review = await recordPaymentReview({
      attemptId,
      reasonCode: "duplicate_successful_payment",
      safeMessage:
        "پرداخت دیگری برای همین شارژ قبلاً ثبت شده و این پرداخت نیازمند بازپرداخت کنترل‌شده است.",
      observedAmount: verified.amountRial,
      observedCurrency: verified.currency,
      transient: false,
      now,
    });
    return {
      ...review,
      credited: false as const,
      duplicateSuccessfulAttempt: true as const,
    };
  }
  return settlement;
}

export async function verifyAndSettleTopUpAttempt(
  input: {
    attemptId: string;
    authority?: string | null;
    statusHint?: string | null;
  },
  dependencies: VerificationDependencies = {},
) {
  const now = dependencies.now?.() ?? new Date();
  const attempt = await prisma.paymentAttempt.findUnique({
    where: { id: input.attemptId },
    include: { walletTopUp: true },
  });
  if (!attempt) {
    throw new WalletError(
      "payment_attempt_not_found",
      "تلاش پرداخت پیدا نشد.",
    );
  }
  if (attempt.status === PaymentAttemptStatus.SUCCEEDED) {
    return {
      topUp: attempt.walletTopUp,
      attempt,
      alreadySettled: true as const,
      failed: false as const,
      review: false as const,
    };
  }

  const authority = input.authority || attempt.authority;
  if (!authority) {
    throw new WalletError("missing_authority", "شناسه پرداخت موجود نیست.");
  }

  let verified: VerifyPaymentResult;
  try {
    const provider =
      dependencies.provider ??
      (await resolveProviderForTopUp(
        attempt.gateway,
        snapshotEnvironment(asGatewaySnapshot(attempt.gatewayConfigSnapshot)),
      ));
    await prisma.paymentAttempt.updateMany({
      where: {
        id: attempt.id,
        status: { not: PaymentAttemptStatus.SUCCEEDED },
      },
      data: { verificationAttempts: { increment: 1 } },
    });
    verified = await provider.verifyPayment({
      authority,
      expectedAmountRial: attempt.amount,
      statusHint: input.statusHint,
    });
  } catch (error) {
    const review = await recordPaymentReview({
      attemptId: attempt.id,
      reasonCode:
        error instanceof PaymentError ? error.code : "verify_unavailable",
      safeMessage: "تأیید درگاه موقتاً در دسترس نیست و دوباره بررسی می‌شود.",
      transient: true,
      now,
    });
    return {
      ...review,
      alreadySettled: false as const,
      failed: false as const,
      review: true as const,
    };
  }

  if (!verified.ok) {
    if (TERMINAL_VERIFY_CODES.has(verified.code)) {
      const failed = await recordTerminalFailure({
        attemptId: attempt.id,
        code: verified.code,
        now,
      });
      return {
        ...failed,
        alreadySettled: false as const,
        failed: true as const,
        review: false as const,
      };
    }
    const review = await recordPaymentReview({
      attemptId: attempt.id,
      reasonCode: verified.code,
      safeMessage: "نتیجه تأیید درگاه نیازمند تطبیق است.",
      transient: TRANSIENT_VERIFY_CODES.has(verified.code),
      now,
    });
    return {
      ...review,
      alreadySettled: false as const,
      failed: false as const,
      review: true as const,
    };
  }

  if (verified.amountRial !== attempt.amount || verified.currency !== attempt.currency) {
    const review = await recordPaymentReview({
      attemptId: attempt.id,
      reasonCode:
        verified.amountRial !== attempt.amount
          ? "amount_mismatch"
          : "currency_mismatch",
      safeMessage: "مبلغ یا واحد پول پرداخت با درخواست هم‌خوانی ندارد.",
      observedAmount: verified.amountRial,
      observedCurrency: verified.currency,
      transient: false,
      now,
    });
    return {
      ...review,
      alreadySettled: false as const,
      failed: false as const,
      review: true as const,
    };
  }

  try {
    await prisma.paymentAttempt.updateMany({
      where: {
        id: attempt.id,
        status: { not: PaymentAttemptStatus.SUCCEEDED },
      },
      data: {
        authority: verified.authority,
        gatewayReference: verified.gatewayReference,
        verifiedAt: now,
      },
    });
    await dependencies.afterGatewayVerify?.();
    const settled = await settleVerifiedAttempt(attempt.id, verified, now);
    return {
      ...settled,
      alreadySettled: !settled.credited,
      failed: false as const,
      review: settled.duplicateSuccessfulAttempt,
    };
  } catch {
    const review = await recordPaymentReview({
      attemptId: attempt.id,
      reasonCode: "wallet_credit_pending",
      safeMessage:
        "پرداخت درگاه تأیید شده اما ثبت اعتبار کیف پول نیازمند بازیابی است.",
      observedAmount: verified.amountRial,
      observedCurrency: verified.currency,
      transient: true,
      now,
    });
    return {
      ...review,
      alreadySettled: false as const,
      failed: false as const,
      review: true as const,
    };
  }
}

export async function reconcileVerifiedWalletCredit(input: {
  attemptId: string;
  now?: Date;
}) {
  const attempt = await prisma.paymentAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
  });
  if (!attempt.verifiedAt || !attempt.authority || !attempt.gatewayReference) {
    throw new WalletError(
      "gateway_verification_required",
      "پیش از تطبیق اعتبار، تأیید موفق درگاه لازم است.",
    );
  }
  return settleVerifiedAttempt(
    attempt.id,
    {
      ok: true,
      authority: attempt.authority,
      gatewayReference: attempt.gatewayReference,
      amountRial: attempt.amount,
      currency: "IRR",
    },
    input.now ?? new Date(),
  );
}

export async function finalizeTopUpFromCallback(params: {
  expectedGateway: "ZIBAL" | "ZARINPAL" | "MOCK";
  paymentAttemptId?: string;
  topUpId?: string;
  token: string;
  authority?: string | null;
  statusHint?: string | null;
}) {
  const env = assertServerSecrets();
  const tokenHash = hashCallbackToken(params.token, env.sessionSecret);
  const attempt = params.paymentAttemptId
    ? await prisma.paymentAttempt.findUnique({
        where: { id: params.paymentAttemptId },
        include: { walletTopUp: true },
      })
    : params.topUpId
      ? await prisma.paymentAttempt.findFirst({
          where: {
            walletTopUpId: params.topUpId,
            callbackTokenHash: tokenHash,
          },
          orderBy: { attemptNumber: "desc" },
          include: { walletTopUp: true },
        })
      : null;

  if (!attempt || attempt.callbackTokenHash !== tokenHash) {
    throw new WalletError(
      "invalid_callback",
      "درخواست بازگشت پرداخت نامعتبر است.",
    );
  }
  if (attempt.gateway !== params.expectedGateway) {
    throw new WalletError(
      "gateway_mismatch",
      "درخواست بازگشت پرداخت نامعتبر است.",
    );
  }

  return verifyAndSettleTopUpAttempt({
    attemptId: attempt.id,
    authority: params.authority,
    statusHint: params.statusHint,
  });
}
