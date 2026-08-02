import assert from "node:assert/strict";
import test from "node:test";

import {
  InfrastructureOrderStatus,
  PrismaClient,
  ServiceOrderStatus,
  WalletStatus,
} from "@prisma/client";

import {
  createOrderPaymentIntent,
  finalizeOrderPaymentFromCallback,
} from "../lib/payments/order-payment.ts";
import { getActivePlanByCode, toPlanSnapshot } from "../lib/orders/plans.ts";

const databaseUrl = process.env.DATABASE_URL;
const runIsolated = process.env.ABRCHIN_ISOLATED_TEST === "1";
const prisma = databaseUrl && runIsolated ? new PrismaClient() : null;

test("one verified gateway callback records one payment, ledger, and waiting order", async (t) => {
  if (!prisma) {
    t.skip("requires ABRCHIN_ISOLATED_TEST=1 and DATABASE_URL");
    return;
  }

  const suffix = Date.now().toString(36);
  const planCode = `PAYMENT_CALLBACK_${suffix}`;
  const userMobile = `099${suffix.slice(-8).padStart(8, "0")}`;
  const now = new Date();
  const priceCheckedAt = new Date(now.getTime() - 1_000);
  const validUntil = new Date(now.getTime() + 10 * 60 * 1_000);
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    defaultGateway: process.env.PAYMENT_BOOTSTRAP_DEFAULT_PROVIDER,
    callbackBase: process.env.PAYMENT_CALLBACK_BASE_URL,
    publicSale: process.env.PARSPACK_PUBLIC_SALE_ENABLED,
    mutations: process.env.PARSPACK_MUTATIONS_ENABLED,
  };

  process.env.NODE_ENV = "development";
  process.env.PAYMENT_BOOTSTRAP_DEFAULT_PROVIDER = "mock";
  process.env.PAYMENT_CALLBACK_BASE_URL = "http://localhost:3010";
  process.env.PARSPACK_PUBLIC_SALE_ENABLED = "true";
  process.env.PARSPACK_MUTATIONS_ENABLED = "true";

  await prisma.paymentGatewayConfig.updateMany({ data: { isDefault: false } });
  await prisma.paymentGatewayConfig.update({
    where: { provider: "MOCK" },
    data: { enabled: true, isDefault: true, environment: "DEVELOPMENT" },
  });

  let userId = "";
  let planId = "";
  let catalogItemId = "";
  let orderId = "";
  try {
    const catalog = await prisma.providerCatalogItem.create({
      data: {
        provider: "PARSPACK",
        apiVersion: "v1",
        productKind: "READY_INSTANT_SERVER",
        regionCode: `payment-${suffix}`,
        sizeCode: "callback-vps",
        externalPlanId: "callback-vps",
        externalKey: `parspack:v1:payment-${suffix}:callback-vps`,
        sizeName: "Callback test VPS",
        compatibleImageCodes: ["ubuntu-callback"],
        vcpu: 2,
        ramMb: 2048,
        diskGb: 40,
        available: true,
        active: true,
        status: "ACTIVE",
        priceMonthlyAmount: 1_000_000n,
        priceScale: 0,
        currencyCode: "IRR",
        amountUnit: "RIAL",
        providerMonthlyPriceIrr: 1_000_000n,
        lastSyncedAt: priceCheckedAt,
        lastSeenAt: priceCheckedAt,
        rawPayload: {},
        payloadHash: `payment-callback-${suffix}`,
        catalogVersion: `payment-callback-${suffix}`,
      },
    });
    catalogItemId = catalog.id;
    await prisma.providerPricingConfig.upsert({
      where: { provider: "PARSPACK" },
      update: {
        apiVersion: "v1",
        enabled: true,
        markupBasisPoints: 0,
        sourceMoneyUnit: "RIAL",
      },
      create: {
        id: "parspack",
        provider: "PARSPACK",
        apiVersion: "v1",
        enabled: true,
        markupBasisPoints: 0,
        sourceMoneyUnit: "RIAL",
      },
    });
    await prisma.productPricingConfig.upsert({
      where: {
        provider_apiVersion_productKind: {
          provider: "PARSPACK",
          apiVersion: "v1",
          productKind: "READY_INSTANT_SERVER",
        },
      },
      update: { enabled: true, markupBasisPoints: 0 },
      create: {
        id: "payment-callback-parspack-ready",
        provider: "PARSPACK",
        apiVersion: "v1",
        productKind: "READY_INSTANT_SERVER",
        enabled: true,
        markupBasisPoints: 0,
      },
    });
    const plan = await prisma.infrastructurePlan.create({
      data: {
        code: planCode,
        title: "Payment callback test",
        provider: "PARSPACK",
        providerApiVersion: "v1",
        productKind: "READY_INSTANT_SERVER",
        regionCode: catalog.regionCode,
        sizeCode: catalog.sizeCode,
        imageCode: "ubuntu-callback",
        deliveryMode: "MANAGED",
        salePriceRial: 1_000_000n,
        renewalPriceRial: 1_000_000n,
        estimatedProviderCostRial: 1_000_000n,
        vcpu: 2,
        ramGb: 2,
        storageGb: 40,
        catalogItemId: catalog.id,
        catalogMappingStatus: "MAPPED",
        catalogMappedAt: priceCheckedAt,
        parchinIncluded: true,
        minimumParchinLevel: "PARCHIN_START",
        active: true,
        publicationStatus: "PUBLISHED",
      },
    });
    planId = plan.id;
    const pricedPlan = await getActivePlanByCode(plan.code);
    assert.ok(pricedPlan);

    const user = await prisma.user.create({ data: { mobile: userMobile } });
    userId = user.id;
    await prisma.wallet.create({
      data: { userId, availableBalance: 0n, status: WalletStatus.ACTIVE },
    });
    const order = await prisma.serviceOrder.create({
      data: {
        userId,
        title: plan.title,
        amount: pricedPlan.pricing.finalPriceRial,
        status: ServiceOrderStatus.PENDING_PAYMENT,
        planId: plan.id,
        planCode: plan.code,
        planSnapshot: toPlanSnapshot(pricedPlan, { createdAt: now, expiresAt: validUntil }),
        quoteExpiresAt: validUntil,
        provider: "PARSPACK",
        providerApiVersion: "v1",
        productKind: "READY_INSTANT_SERVER",
        parchinLevel: pricedPlan.pricing.parchinLevel,
        productFlowState: "AWAITING_PAYMENT",
      },
    });
    orderId = order.id;

    const idempotencyKey = `order-payment-callback-${suffix}`.padEnd(24, "x");
    const intent = await createOrderPaymentIntent({ userId, orderId, idempotencyKey });
    assert.equal(intent.alreadyPaid, false);
    assert.ok(intent.redirectUrl);
    const replayedIntent = await createOrderPaymentIntent({ userId, orderId, idempotencyKey });
    assert.equal(replayedIntent.payment?.id, intent.payment?.id);

    const mockGatewayUrl = new URL(intent.redirectUrl!);
    const callbackUrl = new URL(mockGatewayUrl.searchParams.get("callback")!);
    const token = callbackUrl.searchParams.get("token");
    const paymentId = callbackUrl.searchParams.get("paymentId");
    assert.ok(token);
    assert.equal(paymentId, intent.payment?.id);
    const persistedIntent = await prisma.orderPayment.findUniqueOrThrow({
      where: { id: paymentId! },
    });

    const first = await finalizeOrderPaymentFromCallback({
      expectedGateway: "MOCK",
      paymentId: paymentId!,
      token: token!,
      authority: persistedIntent.authority,
      statusHint: "OK",
    });
    const replay = await finalizeOrderPaymentFromCallback({
      expectedGateway: "MOCK",
      paymentId: paymentId!,
      token: token!,
      authority: persistedIntent.authority,
      statusHint: "OK",
    });
    assert.equal(first.payment.status, "SUCCEEDED");
    assert.equal(replay.payment.status, "SUCCEEDED");
    assert.equal(replay.alreadySettled, true);
    assert.equal(first.order.status, ServiceOrderStatus.PAID);
    assert.equal(
      await prisma.infrastructureOrder.count({
        where: { serviceOrderId: orderId, status: InfrastructureOrderStatus.WAITING_ADMIN_FUNDING },
      }),
      1,
    );
    assert.equal(await prisma.provisioningJob.count({ where: { infrastructureOrder: { serviceOrderId: orderId } } }), 0);
    assert.equal(await prisma.cloudInstance.count({ where: { infrastructureOrder: { serviceOrderId: orderId } } }), 0);
    assert.equal(
      await prisma.walletLedgerEntry.count({
        where: { referenceType: "order_payment", referenceId: paymentId! },
      }),
      1,
    );
    assert.equal(
      await prisma.walletLedgerEntry.count({
        where: { referenceType: "order", referenceId: orderId },
      }),
      1,
    );
    assert.equal(
      (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).availableBalance,
      0n,
    );
  } finally {
    if (orderId) await prisma.serviceOrder.deleteMany({ where: { id: orderId } });
    if (userId) {
      await prisma.walletLedgerEntry.deleteMany({ where: { wallet: { userId } } });
      await prisma.wallet.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    if (planId) await prisma.infrastructurePlan.deleteMany({ where: { id: planId } });
    if (catalogItemId) await prisma.providerCatalogItem.deleteMany({ where: { id: catalogItemId } });
    process.env.NODE_ENV = previous.nodeEnv;
    process.env.PAYMENT_BOOTSTRAP_DEFAULT_PROVIDER = previous.defaultGateway;
    process.env.PAYMENT_CALLBACK_BASE_URL = previous.callbackBase;
    process.env.PARSPACK_PUBLIC_SALE_ENABLED = previous.publicSale;
    process.env.PARSPACK_MUTATIONS_ENABLED = previous.mutations;
    await prisma.$disconnect();
  }
});
