import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test, { after } from "node:test";

import {
  PaymentAttemptStatus,
  PrismaClient,
  TopUpStatus,
} from "@prisma/client";

import type {
  CallbackParams,
  ConfigurationValidation,
  CreatePaymentInput,
  CreatePaymentResult,
  NormalizedCallback,
  PaymentProvider,
  VerifyPaymentInput,
  VerifyPaymentResult,
} from "../lib/payments/types.ts";
import {
  requestControlledTopUpRefund,
} from "../lib/payments/recovery.ts";
import {
  finalizeTopUpFromCallback,
  reconcileVerifiedWalletCredit,
  retryTopUpPayment,
  verifyAndSettleTopUpAttempt,
} from "../lib/wallet/topup.ts";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for wallet payment recovery tests");
}
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET || "wallet-recovery-test-secret";
process.env.PAYMENT_CALLBACK_BASE_URL =
  process.env.PAYMENT_CALLBACK_BASE_URL || "http://localhost:3010";

const db = new PrismaClient();
const runId = `recovery-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
const amountRial = 1_000_000n;

after(async () => {
  await db.$disconnect();
});

class ControlledPaymentProvider implements PaymentProvider {
  readonly name = "mock" as const;
  readonly prismaProvider = "MOCK" as const;
  verifyCount = 0;
  private readonly results: Array<VerifyPaymentResult | Error>;

  constructor(results: Array<VerifyPaymentResult | Error>) {
    this.results = results;
  }

  validateConfiguration(): ConfigurationValidation {
    return { ok: true };
  }

  async createPayment(
    input: CreatePaymentInput,
  ): Promise<CreatePaymentResult> {
    return {
      authority: `mock_${runId}_${input.amountRial}`,
      gatewayReference: `mock_${runId}_${input.amountRial}`,
      redirectUrl: "http://localhost:3010/mock",
    };
  }

  async verifyPayment(
    input: VerifyPaymentInput,
  ): Promise<VerifyPaymentResult> {
    void input;
    const result =
      this.results[Math.min(this.verifyCount, this.results.length - 1)];
    this.verifyCount += 1;
    if (result instanceof Error) throw result;
    return result;
  }

  buildRedirectUrl() {
    return "http://localhost:3010/mock";
  }

  normalizeCallback(params: CallbackParams): NormalizedCallback {
    void params;
    return {
      authority: null,
      statusHint: null,
      orderId: null,
      successHint: null,
    };
  }
}

function successResult(
  authority: string,
  amount = amountRial,
  currency = "IRR",
): VerifyPaymentResult {
  return {
    ok: true,
    authority,
    gatewayReference: `ref-${authority}`,
    amountRial: amount,
    currency,
  };
}

async function createAttempt(input: {
  suffix: string;
  status?: PaymentAttemptStatus;
  topUpStatus?: TopUpStatus;
  expiresAt?: Date;
  balance?: bigint;
  callbackToken?: string;
}) {
  const user = await db.user.create({
    data: {
      mobile: `09${Math.abs(
        createHash("sha1")
          .update(`${runId}:${input.suffix}`)
          .digest()
          .readInt32BE(0),
      )
        .toString()
        .padStart(9, "0")
        .slice(0, 9)}`,
    },
  });
  const wallet = await db.wallet.create({
    data: {
      userId: user.id,
      availableBalance: input.balance ?? 0n,
      currency: "IRR",
    },
  });
  const token = input.callbackToken ?? `token-${runId}-${input.suffix}`;
  const tokenHash = createHash("sha256")
    .update(`${process.env.SESSION_SECRET}:${token}`)
    .digest("hex");
  const authority = `mock_${runId}_${input.suffix}`;
  const expiresAt =
    input.expiresAt ?? new Date(Date.now() + 10 * 60 * 1000);
  const topUp = await db.walletTopUp.create({
    data: {
      walletId: wallet.id,
      amount: amountRial,
      gateway: "MOCK",
      status: input.topUpStatus ?? TopUpStatus.PENDING,
      authority,
      idempotencyKey: `${runId}:topup:${input.suffix}`,
      callbackTokenHash: tokenHash,
      expiresAt,
    },
  });
  const attempt = await db.paymentAttempt.create({
    data: {
      walletTopUpId: topUp.id,
      attemptNumber: 1,
      amount: amountRial,
      currency: "IRR",
      gateway: "MOCK",
      status: input.status ?? PaymentAttemptStatus.PENDING,
      authority,
      callbackTokenHash: tokenHash,
      expiresAt,
      idempotencyKey: `${runId}:attempt:${input.suffix}`,
    },
  });
  return { user, wallet, topUp, attempt, token, authority };
}

async function creditLedgerCount(topUpId: string) {
  return db.walletLedgerEntry.count({
    where: {
      referenceType: "wallet_topup",
      referenceId: topUpId,
      type: "TOP_UP",
    },
  });
}

test("wallet top-up recovery is PostgreSQL-backed and idempotent", async (t) => {
  const admin = await db.user.create({
    data: {
      mobile: `099${Date.now().toString().slice(-8)}`,
      role: "ADMIN",
    },
  });
  await db.paymentGatewayConfig.updateMany({ data: { isDefault: false } });
  await db.paymentGatewayConfig.upsert({
    where: { provider: "MOCK" },
    create: {
      provider: "MOCK",
      displayName: "Controlled test gateway",
      enabled: true,
      isDefault: true,
      priority: 1,
      environment: "DEVELOPMENT",
    },
    update: {
      enabled: true,
      isDefault: true,
      priority: 1,
      environment: "DEVELOPMENT",
    },
  });

  await t.test("callback after local TTL still verifies and credits once", async () => {
    const fixture = await createAttempt({
      suffix: "expired-callback",
      expiresAt: new Date(Date.now() - 60_000),
    });
    const result = await finalizeTopUpFromCallback({
      expectedGateway: "MOCK",
      paymentAttemptId: fixture.attempt.id,
      token: fixture.token,
      authority: fixture.authority,
      statusHint: "OK",
    });
    assert.equal(result.topUp.status, TopUpStatus.SUCCEEDED);
    assert.equal(await creditLedgerCount(fixture.topUp.id), 1);
  });

  await t.test("repeated successful callbacks create one credit", async () => {
    const fixture = await createAttempt({ suffix: "repeated" });
    const provider = new ControlledPaymentProvider([
      successResult(fixture.authority),
    ]);
    await verifyAndSettleTopUpAttempt(
      { attemptId: fixture.attempt.id },
      { provider },
    );
    await verifyAndSettleTopUpAttempt(
      { attemptId: fixture.attempt.id },
      { provider },
    );
    assert.equal(await creditLedgerCount(fixture.topUp.id), 1);
    assert.equal(provider.verifyCount, 1);
  });

  await t.test("concurrent callbacks cannot double credit", async () => {
    const fixture = await createAttempt({ suffix: "concurrent" });
    const provider = new ControlledPaymentProvider([
      successResult(fixture.authority),
    ]);
    await Promise.all([
      verifyAndSettleTopUpAttempt(
        { attemptId: fixture.attempt.id },
        { provider },
      ),
      verifyAndSettleTopUpAttempt(
        { attemptId: fixture.attempt.id },
        { provider },
      ),
    ]);
    assert.equal(await creditLedgerCount(fixture.topUp.id), 1);
    const wallet = await db.wallet.findUniqueOrThrow({
      where: { id: fixture.wallet.id },
    });
    assert.equal(wallet.availableBalance, amountRial);
  });

  await t.test("definitively failed attempt can create a new attempt", async () => {
    const fixture = await createAttempt({
      suffix: "retry",
      status: PaymentAttemptStatus.FAILED,
      topUpStatus: TopUpStatus.FAILED,
    });
    const retried = await retryTopUpPayment({
      userId: fixture.user.id,
      topUpId: fixture.topUp.id,
      idempotencyKey: `${runId}:retry:payment:attempt`,
    });
    assert.equal(retried.attempt.attemptNumber, 2);
    const history = await db.paymentAttempt.findMany({
      where: { walletTopUpId: fixture.topUp.id },
      orderBy: { attemptNumber: "asc" },
    });
    assert.deepEqual(
      history.map((item) => item.status),
      [PaymentAttemptStatus.FAILED, PaymentAttemptStatus.PENDING],
    );
  });

  await t.test("transient timeout enters review and later reconcile succeeds", async () => {
    const fixture = await createAttempt({ suffix: "timeout" });
    const provider = new ControlledPaymentProvider([
      { ok: false, code: "timeout", message: "controlled timeout" },
      successResult(fixture.authority),
    ]);
    const first = await verifyAndSettleTopUpAttempt(
      { attemptId: fixture.attempt.id },
      { provider },
    );
    assert.equal(first.review, true);
    assert.equal(first.attempt.status, PaymentAttemptStatus.REVIEW);
    const recovered = await verifyAndSettleTopUpAttempt(
      { attemptId: fixture.attempt.id },
      { provider },
    );
    assert.equal(recovered.topUp.status, TopUpStatus.SUCCEEDED);
    assert.equal(await creditLedgerCount(fixture.topUp.id), 1);
  });

  await t.test("verified payment survives internal failure without charging again", async () => {
    const fixture = await createAttempt({ suffix: "internal-failure" });
    const provider = new ControlledPaymentProvider([
      successResult(fixture.authority),
    ]);
    const first = await verifyAndSettleTopUpAttempt(
      { attemptId: fixture.attempt.id },
      {
        provider,
        afterGatewayVerify: async () => {
          throw new Error("controlled internal failure");
        },
      },
    );
    assert.equal(first.review, true);
    const recovered = await reconcileVerifiedWalletCredit({
      attemptId: fixture.attempt.id,
    });
    assert.equal(recovered.credited, true);
    assert.equal(provider.verifyCount, 1);
    assert.equal(await creditLedgerCount(fixture.topUp.id), 1);
  });

  await t.test("amount mismatch is quarantined for admin review", async () => {
    const fixture = await createAttempt({ suffix: "mismatch" });
    const provider = new ControlledPaymentProvider([
      successResult(fixture.authority, amountRial + 1n),
    ]);
    const result = await verifyAndSettleTopUpAttempt(
      { attemptId: fixture.attempt.id },
      { provider },
    );
    assert.equal(result.review, true);
    assert.equal(result.attempt.status, PaymentAttemptStatus.REVIEW);
    assert.equal(await creditLedgerCount(fixture.topUp.id), 0);
    const recovery = await db.paymentRecoveryCase.findUniqueOrThrow({
      where: { attemptId: fixture.attempt.id },
    });
    assert.equal(recovery.reasonCode, "amount_mismatch");
  });

  await t.test("successful payment is monotonic and never downgraded", async () => {
    const fixture = await createAttempt({ suffix: "monotonic" });
    const success = new ControlledPaymentProvider([
      successResult(fixture.authority),
    ]);
    await verifyAndSettleTopUpAttempt(
      { attemptId: fixture.attempt.id },
      { provider: success },
    );
    const failure = new ControlledPaymentProvider([
      { ok: false, code: "failed", message: "controlled failure" },
    ]);
    const replay = await verifyAndSettleTopUpAttempt(
      { attemptId: fixture.attempt.id },
      { provider: failure },
    );
    assert.equal(replay.attempt.status, PaymentAttemptStatus.SUCCEEDED);
    assert.equal(failure.verifyCount, 0);
  });

  await t.test("repeated controlled refund creates one debit ledger", async () => {
    const fixture = await createAttempt({ suffix: "refund" });
    const provider = new ControlledPaymentProvider([
      successResult(fixture.authority),
    ]);
    await verifyAndSettleTopUpAttempt(
      { attemptId: fixture.attempt.id },
      { provider },
    );
    const idempotencyKey = `${runId}:refund:controlled:one`;
    const first = await requestControlledTopUpRefund({
      actorUserId: admin.id,
      topUpId: fixture.topUp.id,
      idempotencyKey,
      reason: "بازپرداخت کنترل‌شده تست",
    });
    const replay = await requestControlledTopUpRefund({
      actorUserId: admin.id,
      topUpId: fixture.topUp.id,
      idempotencyKey,
      reason: "بازپرداخت کنترل‌شده تست",
    });
    assert.deepEqual(replay, first);
    assert.equal(first.status, "APPROVED");
    assert.equal(
      await db.walletLedgerEntry.count({
        where: {
          walletId: fixture.wallet.id,
          type: "TOP_UP_REFUND",
        },
      }),
      1,
    );
  });

  await t.test("consumed top-up cannot be automatically refunded", async () => {
    const fixture = await createAttempt({ suffix: "spent-refund" });
    const provider = new ControlledPaymentProvider([
      successResult(fixture.authority),
    ]);
    await verifyAndSettleTopUpAttempt(
      { attemptId: fixture.attempt.id },
      { provider },
    );
    await db.wallet.update({
      where: { id: fixture.wallet.id },
      data: { availableBalance: 1n },
    });
    const result = await requestControlledTopUpRefund({
      actorUserId: admin.id,
      topUpId: fixture.topUp.id,
      idempotencyKey: `${runId}:refund:spent:review`,
      reason: "بازپرداخت شارژ مصرف‌شده",
    });
    assert.equal(result.status, "REVIEW_REQUIRED");
    assert.equal(
      await db.walletLedgerEntry.count({
        where: {
          walletId: fixture.wallet.id,
          type: "TOP_UP_REFUND",
        },
      }),
      0,
    );
  });
});
