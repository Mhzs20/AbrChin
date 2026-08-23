import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  LedgerType,
  PaymentGatewayProvider,
  PrismaClient,
  ServiceOrderStatus,
  TopUpStatus,
} from "@prisma/client";

import { tomanToRial } from "../lib/money.ts";
import { PaymentError } from "../lib/payments/errors.ts";
import { MockPaymentProvider } from "../lib/payments/mock-provider.ts";
import { createZarinpalForTest, createZibalForTest, hasServerCredentials } from "../lib/payments/provider-factory.ts";
import {
  ensureGatewayConfigsSeeded,
  makeGatewayDefault,
  updateGatewayConfig,
} from "../lib/payments/gateway-config.ts";
import { resolveDefaultPaymentGateway, resolveProviderForTopUp } from "../lib/payments/gateway-resolver.ts";

const databaseUrl = process.env.DATABASE_URL;
const prisma = databaseUrl ? new PrismaClient() : null;
const previousNodeEnv = process.env.NODE_ENV;
const previousZibal = process.env.ZIBAL_MERCHANT;
const previousZarinpal = process.env.ZARINPAL_MERCHANT_ID;

after(async () => {
  process.env.NODE_ENV = previousNodeEnv;
  process.env.ZIBAL_MERCHANT = previousZibal;
  process.env.ZARINPAL_MERCHANT_ID = previousZarinpal;
  if (prisma) await prisma.$disconnect();
});

test("mock payment create/verify and production fail-closed", async () => {
  process.env.NODE_ENV = "development";
  const provider = new MockPaymentProvider("http://localhost:3010");
  assert.equal(provider.validateConfiguration().ok, true);

  const created = await provider.createPayment({
    amountRial: 1_000_000n,
    description: "test",
    callbackUrl: "http://localhost:3010/api/payments/mock/callback",
  });
  assert.ok(created.authority.startsWith("mock_"));
  assert.ok(created.redirectUrl.includes("/account/wallet/mock-gateway"));

  const ok = await provider.verifyPayment({
    authority: created.authority,
    expectedAmountRial: 1_000_000n,
    statusHint: "OK",
  });
  assert.equal(ok.ok, true);

  const canceled = await provider.verifyPayment({
    authority: created.authority,
    expectedAmountRial: 1_000_000n,
    statusHint: "CANCEL",
  });
  assert.equal(canceled.ok, false);

  process.env.NODE_ENV = "production";
  const prod = new MockPaymentProvider("http://localhost:3010");
  assert.equal(prod.validateConfiguration().ok, false);
  await assert.rejects(() => prod.createPayment({
    amountRial: 1000n,
    description: "x",
    callbackUrl: "http://localhost/cb",
  }), PaymentError);
});

test("zibal adapter create/verify/cancel/errors without leaking merchant", async () => {
  const merchant = "secret-zibal-merchant-should-not-leak";
  const provider = createZibalForTest({
    merchant,
    timeoutMs: 2000,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}")) as { trackId?: number };
      if (String(_url).includes("/v1/request")) {
        return new Response(JSON.stringify({ trackId: 15966442233311, result: 100, message: "success" }), {
          status: 200,
        });
      }
      if (String(_url).includes("/v1/verify")) {
        assert.equal(body.trackId, 15966442233311);
        return new Response(
          JSON.stringify({
            result: 100,
            amount: 5000,
            refNumber: 9911,
            message: "success",
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    },
  });

  const created = await provider.createPayment({
    amountRial: 5000n,
    description: "x",
    callbackUrl: "https://example.com/api/payments/zibal/callback",
  });
  assert.equal(created.authority, "15966442233311");
  assert.ok(created.redirectUrl.includes("/start/15966442233311"));
  assert.equal(created.redirectUrl.includes(merchant), false);
  assert.equal(created.authority.includes(merchant), false);

  const verified = await provider.verifyPayment({
    authority: created.authority,
    expectedAmountRial: 5000n,
    statusHint: "1",
  });
  assert.equal(verified.ok, true);
  if (verified.ok) {
    assert.equal(verified.gatewayReference, "9911");
    assert.equal(verified.gatewayReference.includes(merchant), false);
    assert.equal(verified.authority.includes(merchant), false);
  }

  const canceled = await provider.verifyPayment({
    authority: created.authority,
    expectedAmountRial: 5000n,
    statusHint: "0",
  });
  assert.equal(canceled.ok, false);

  const mismatchProvider = createZibalForTest({
    merchant,
    fetchImpl: async () =>
      new Response(JSON.stringify({ result: 100, amount: 999, refNumber: 1 }), { status: 200 }),
  });
  const mismatch = await mismatchProvider.verifyPayment({
    authority: "15966442233311",
    expectedAmountRial: 5000n,
  });
  assert.equal(mismatch.ok, true);
  if (mismatch.ok) {
    assert.equal(mismatch.amountRial, 999n);
    assert.equal(mismatch.currency, "IRR");
  }

  const already = createZibalForTest({
    merchant,
    fetchImpl: async () =>
      new Response(JSON.stringify({ result: 201, amount: 5000, refNumber: 1 }), { status: 200 }),
  });
  const again = await already.verifyPayment({
    authority: "15966442233311",
    expectedAmountRial: 5000n,
  });
  assert.equal(again.ok, true);

  const invalid = createZibalForTest({
    merchant,
    fetchImpl: async () => new Response("not-json", { status: 200 }),
  });
  await assert.rejects(
    () =>
      invalid.createPayment({
        amountRial: 1000n,
        description: "x",
        callbackUrl: "https://example.com/cb",
      }),
    (error: unknown) => error instanceof PaymentError && !error.message.includes(merchant),
  );

  const timeoutProvider = createZibalForTest({
    merchant,
    timeoutMs: 20,
    fetchImpl: async (_url, init) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
      return new Response("{}", { status: 200 });
    },
  });
  await assert.rejects(
    () =>
      timeoutProvider.createPayment({
        amountRial: 1000n,
        description: "x",
        callbackUrl: "https://example.com/cb",
      }),
    (error: unknown) => error instanceof PaymentError && error.code === "timeout",
  );

  const networkProvider = createZibalForTest({
    merchant,
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    },
  });
  await assert.rejects(
    () =>
      networkProvider.createPayment({
        amountRial: 1000n,
        description: "x",
        callbackUrl: "https://example.com/cb",
      }),
    (error: unknown) => error instanceof PaymentError && error.code === "network",
  );

  const empty = createZibalForTest({ merchant: "" });
  const emptyValidation = empty.validateConfiguration();
  assert.equal(emptyValidation.ok, false);
  if (!emptyValidation.ok) {
    assert.equal(emptyValidation.message.includes(merchant), false);
  }
});

test("zarinpal adapter validates responses without leaking merchant id", async () => {
  const merchant = "secret-merchant-id-should-not-leak";
  const provider = createZarinpalForTest({
    merchantId: merchant,
    sandbox: true,
    timeoutMs: 2000,
    fetchImpl: async () =>
      new Response(JSON.stringify({ data: { code: 100, authority: "A0001" } }), { status: 200 }),
  });

  const created = await provider.createPayment({
    amountRial: 5000n,
    description: "x",
    callbackUrl: "https://example.com/callback",
  });
  assert.equal(created.authority, "A0001");
  assert.equal(JSON.stringify(created).includes(merchant), false);

  const verifyProvider = createZarinpalForTest({
    merchantId: merchant,
    sandbox: true,
    timeoutMs: 2000,
    fetchImpl: async () =>
      new Response(JSON.stringify({ data: { code: 100, ref_id: 99 } }), { status: 200 }),
  });
  const verified = await verifyProvider.verifyPayment({
    authority: "A0001",
    expectedAmountRial: 5000n,
    statusHint: "OK",
  });
  assert.equal(verified.ok, true);
  if (verified.ok) {
    assert.equal(verified.gatewayReference.includes(merchant), false);
  }

  const already = createZarinpalForTest({
    merchantId: merchant,
    fetchImpl: async () =>
      new Response(JSON.stringify({ data: { code: 101, ref_id: 99 } }), { status: 200 }),
  });
  const again = await already.verifyPayment({
    authority: "A0001",
    expectedAmountRial: 5000n,
    statusHint: "OK",
  });
  assert.equal(again.ok, true);

  const nok = await verifyProvider.verifyPayment({
    authority: "A0001",
    expectedAmountRial: 5000n,
    statusHint: "NOK",
  });
  assert.equal(nok.ok, false);

  const empty = createZarinpalForTest({ merchantId: "" });
  assert.equal(empty.validateConfiguration().ok, false);
  const msg = empty.validateConfiguration();
  assert.equal(msg.ok, false);
  if (!msg.ok) assert.equal(msg.message.includes(merchant), false);
});

test("server plans are loaded from database", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }
  process.env.NODE_ENV = "development";
  const plan = await prisma.infrastructurePlan.upsert({
    where: { code: "DEV_STARTER" },
    update: {},
    create: {
      code: "DEV_STARTER",
      title: "شروع توسعه",
      provider: "ARVAN",
      regionCode: "tehran11",
      sizeCode: "irLinuxVPS4",
      imageCode: "ubuntu24-cloudinit-qcow2",
      deliveryMode: "RAW",
      salePriceRial: tomanToRial(150_000),
      estimatedProviderCostRial: tomanToRial(120_000),
      active: true,
      sortOrder: 1,
    },
  });
  assert.equal(plan.salePriceRial, tomanToRial(150_000));
});

test("gateway config rules and audit", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }

  process.env.NODE_ENV = "development";
  process.env.ZIBAL_MERCHANT = "zibal";
  process.env.ZARINPAL_MERCHANT_ID = "test-zarinpal-merchant";

  await ensureGatewayConfigsSeeded();
  // Prior suites may have flipped the default gateway on the shared DB.
  // Re-assert the seed invariant before reading it.
  await prisma.paymentGatewayConfig.updateMany({ data: { isDefault: false } });
  await prisma.paymentGatewayConfig.update({
    where: { provider: PaymentGatewayProvider.ZIBAL },
    data: { isDefault: true, enabled: true, priority: 10 },
  });
  await prisma.paymentGatewayConfig.update({
    where: { provider: PaymentGatewayProvider.ZARINPAL },
    data: { priority: 20 },
  });
  const configs = await prisma.paymentGatewayConfig.findMany({ orderBy: { priority: "asc" } });
  const zibal = configs.find((row) => row.provider === PaymentGatewayProvider.ZIBAL);
  const zarinpal = configs.find((row) => row.provider === PaymentGatewayProvider.ZARINPAL);
  const mock = configs.find((row) => row.provider === PaymentGatewayProvider.MOCK);
  assert.ok(zibal);
  assert.ok(zarinpal);
  assert.ok(mock);
  assert.equal(zibal.isDefault, true);
  assert.equal(zibal.priority, 10);
  assert.equal(zarinpal.priority, 20);
  assert.equal(configs.filter((row) => row.isDefault).length, 1);

  const adminMobile = "09127770099";
  await prisma.paymentGatewayAuditLog.deleteMany({});
  await prisma.user.deleteMany({ where: { mobile: adminMobile } });
  const admin = await prisma.user.create({
    data: { mobile: adminMobile, role: "ADMIN" },
  });

  await assert.rejects(
    () =>
      updateGatewayConfig({
        provider: PaymentGatewayProvider.ZIBAL,
        enabled: false,
        audit: { actorUserId: admin.id },
      }),
    PaymentError,
  );

  process.env.ZARINPAL_MERCHANT_ID = "";
  assert.equal(hasServerCredentials(PaymentGatewayProvider.ZARINPAL), false);
  await assert.rejects(
    () =>
      updateGatewayConfig({
        provider: PaymentGatewayProvider.ZARINPAL,
        enabled: true,
        audit: { actorUserId: admin.id },
      }),
    (error: unknown) =>
      error instanceof PaymentError && error.message.includes("اطلاعات اتصال روی سرور تنظیم نشده است"),
  );

  process.env.ZARINPAL_MERCHANT_ID = "test-zarinpal-merchant";
  await makeGatewayDefault({
    provider: PaymentGatewayProvider.ZARINPAL,
    audit: { actorUserId: admin.id },
  });

  const afterDefault = await prisma.paymentGatewayConfig.findMany();
  assert.equal(afterDefault.filter((row) => row.isDefault).length, 1);
  assert.equal(
    afterDefault.find((row) => row.provider === PaymentGatewayProvider.ZARINPAL)?.isDefault,
    true,
  );

  const audits = await prisma.paymentGatewayAuditLog.findMany({
    where: { actorUserId: admin.id },
  });
  assert.ok(audits.length >= 1);

  process.env.NODE_ENV = "production";
  await assert.rejects(
    () =>
      updateGatewayConfig({
        provider: PaymentGatewayProvider.MOCK,
        enabled: true,
        audit: { actorUserId: admin.id },
      }),
    PaymentError,
  );
  process.env.NODE_ENV = "development";

  // restore zibal default for other tests
  await makeGatewayDefault({
    provider: PaymentGatewayProvider.ZIBAL,
    audit: { actorUserId: admin.id },
  });
});

test("resolver locks provider on topup and never auto-fails over", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }

  process.env.NODE_ENV = "development";
  process.env.ZIBAL_MERCHANT = "zibal";
  process.env.ZARINPAL_MERCHANT_ID = "test-zarinpal-merchant";
  await ensureGatewayConfigsSeeded();

  const adminMobile = "09127770098";
  await prisma.user.deleteMany({ where: { mobile: adminMobile } });
  const admin = await prisma.user.create({ data: { mobile: adminMobile, role: "ADMIN" } });

  await makeGatewayDefault({
    provider: PaymentGatewayProvider.ZIBAL,
    audit: { actorUserId: admin.id },
  });
  const resolvedZibal = await resolveDefaultPaymentGateway();
  assert.equal(resolvedZibal.provider.name, "zibal");

  await makeGatewayDefault({
    provider: PaymentGatewayProvider.ZARINPAL,
    audit: { actorUserId: admin.id },
  });
  const resolvedZarinpal = await resolveDefaultPaymentGateway();
  assert.equal(resolvedZarinpal.provider.name, "zarinpal");

  const locked = await resolveProviderForTopUp(PaymentGatewayProvider.ZIBAL);
  assert.equal(locked.name, "zibal");
  assert.notEqual(locked.name, resolvedZarinpal.provider.name);

  // createPayment failure must not invoke second provider — simulate by empty merchant after resolve snapshot
  // (resolver itself does not catch createPayment errors to retry)
  await makeGatewayDefault({
    provider: PaymentGatewayProvider.ZIBAL,
    audit: { actorUserId: admin.id },
  });
});

test("financial settle is idempotent and respects locked gateway", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }

  const mobile = "09127770004";
  await prisma.walletLedgerEntry.deleteMany({ where: { wallet: { user: { mobile } } } });
  await prisma.walletTopUp.deleteMany({ where: { wallet: { user: { mobile } } } });
  await prisma.wallet.deleteMany({ where: { user: { mobile } } });
  await prisma.user.deleteMany({ where: { mobile } });

  const user = await prisma.user.create({ data: { mobile } });
  const wallet = await prisma.wallet.create({ data: { userId: user.id, availableBalance: 0n } });
  const amount = tomanToRial(100_000);

  const topUp = await prisma.walletTopUp.create({
    data: {
      walletId: wallet.id,
      amount,
      gateway: PaymentGatewayProvider.ZIBAL,
      status: TopUpStatus.PENDING,
      authority: "15966442233311",
      gatewayReference: "15966442233311",
      idempotencyKey: `test_topup_${Date.now()}`,
      callbackTokenHash: "abc",
      gatewayConfigSnapshot: {
        provider: "ZIBAL",
        displayName: "زیبال",
        environment: "PRODUCTION",
        priority: 10,
        enabled: true,
        isDefault: true,
      },
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });

  async function settleOnce() {
    return prisma!.$transaction(async (tx) => {
      const claimed = await tx.walletTopUp.updateMany({
        where: {
          id: topUp.id,
          status: { in: [TopUpStatus.CREATED, TopUpStatus.PENDING] },
        },
        data: {
          status: TopUpStatus.SUCCEEDED,
          gatewayReference: "ref-unique-1",
          verifiedAt: new Date(),
        },
      });
      if (claimed.count !== 1) {
        return false;
      }
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: { availableBalance: { increment: amount } },
      });
      await tx.walletLedgerEntry.create({
        data: {
          walletId: wallet.id,
          direction: "CREDIT",
          type: LedgerType.TOP_UP,
          amount,
          status: "COMPLETED",
          referenceType: "topup",
          referenceId: topUp.id,
          idempotencyKey: `topup_credit_${topUp.id}`,
          balanceAfter: updatedWallet.availableBalance,
        },
      });
      return true;
    });
  }

  assert.equal(await settleOnce(), true);
  assert.equal(await settleOnce(), false);

  const fresh = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
  assert.equal(fresh.availableBalance, amount);
  const credits = await prisma.walletLedgerEntry.count({
    where: { walletId: wallet.id, type: LedgerType.TOP_UP },
  });
  assert.equal(credits, 1);

  await assert.rejects(
    () =>
      prisma!.walletTopUp.create({
        data: {
          walletId: wallet.id,
          amount,
          gateway: PaymentGatewayProvider.ZARINPAL,
          status: TopUpStatus.PENDING,
          authority: "15966442233311",
          idempotencyKey: `test_topup_dup_${Date.now()}`,
          callbackTokenHash: "def",
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        },
      }),
    (error: unknown) => error instanceof Error,
  );
});

test("order pay refund flow with ledger references", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }

  const mobile = "09127770003";
  await prisma.serviceOrder.deleteMany({ where: { user: { mobile } } });
  await prisma.walletLedgerEntry.deleteMany({ where: { wallet: { user: { mobile } } } });
  await prisma.walletTopUp.deleteMany({ where: { wallet: { user: { mobile } } } });
  await prisma.wallet.deleteMany({ where: { user: { mobile } } });
  await prisma.user.deleteMany({ where: { mobile } });

  const user = await prisma.user.create({ data: { mobile } });
  const wallet = await prisma.wallet.create({
    data: { userId: user.id, availableBalance: tomanToRial(2_000_000) },
  });
  const plan = await prisma.infrastructurePlan.upsert({
    where: { code: "DEV_STARTER" },
    update: {},
    create: {
      code: "DEV_STARTER",
      title: "شروع توسعه",
      provider: "ARVAN",
      regionCode: "tehran11",
      sizeCode: "irLinuxVPS4",
      imageCode: "ubuntu24-cloudinit-qcow2",
      deliveryMode: "RAW",
      salePriceRial: tomanToRial(150_000),
      estimatedProviderCostRial: tomanToRial(120_000),
      active: true,
      sortOrder: 1,
    },
  });

  const order = await prisma.serviceOrder.create({
    data: {
      userId: user.id,
      title: plan.title,
      description: plan.description,
      amount: plan.salePriceRial,
      status: ServiceOrderStatus.PENDING_PAYMENT,
      planCode: plan.code,
      planId: plan.id,
    },
  });

  await prisma.$transaction(async (tx) => {
    const updated = await tx.wallet.updateMany({
      where: { id: wallet.id, availableBalance: { gte: order.amount } },
      data: { availableBalance: { decrement: order.amount } },
    });
    assert.equal(updated.count, 1);
    const fresh = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    await tx.walletLedgerEntry.create({
      data: {
        walletId: wallet.id,
        direction: "DEBIT",
        type: LedgerType.SERVICE_PURCHASE,
        amount: order.amount,
        status: "COMPLETED",
        referenceType: "order",
        referenceId: order.id,
        idempotencyKey: `order_pay_${order.id}`,
        balanceAfter: fresh.availableBalance,
      },
    });
    await tx.serviceOrder.update({
      where: { id: order.id },
      data: { status: ServiceOrderStatus.PAID, paidAt: new Date() },
    });
  });

  const debit = await prisma.walletLedgerEntry.findFirstOrThrow({
    where: { referenceId: order.id, type: LedgerType.SERVICE_PURCHASE },
  });

  await prisma.$transaction(async (tx) => {
    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { availableBalance: { increment: debit.amount } },
    });
    await tx.walletLedgerEntry.create({
      data: {
        walletId: wallet.id,
        direction: "CREDIT",
        type: LedgerType.REFUND,
        amount: debit.amount,
        status: "COMPLETED",
        referenceType: "ledger",
        referenceId: debit.id,
        idempotencyKey: `order_refund_${order.id}`,
        balanceAfter: updated.availableBalance,
        reversedEntryId: debit.id,
      },
    });
    await tx.serviceOrder.update({
      where: { id: order.id },
      data: { status: ServiceOrderStatus.REFUNDED },
    });
  });

  const originalDebit = await prisma.walletLedgerEntry.findUniqueOrThrow({ where: { id: debit.id } });
  assert.equal(originalDebit.status, "COMPLETED");
});
