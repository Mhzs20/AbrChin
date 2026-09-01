import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import {
  InfrastructureOrderStatus,
  LedgerType,
  ServiceOrderStatus,
  TopUpStatus,
} from "@prisma/client";

import { prisma } from "../lib/db.ts";
import { completeManualReadyDelivery } from "../lib/infrastructure/manual-ready-delivery.ts";
import {
  approveDelivery,
  getDeliveryApprovalReview,
} from "../lib/infrastructure/delivery-approval.ts";
import {
  approveProvision,
  getProvisionApprovalReview,
} from "../lib/infrastructure/provision-approval.ts";
import { TERM_DISCOUNT_BPS } from "../lib/pricing/commercial-engine.ts";
import {
  isVerifiedSellablePricing,
  PricingUnavailableError,
  requireVerifiedSellablePricing,
} from "../lib/pricing/plan-pricing.ts";
import { parseProviderUsage } from "../lib/messagego/settlement/customer-pricing.ts";
import { isSettlementError } from "../lib/messagego/settlement/amount.ts";
import { createMockProviderWithBehavior } from "../lib/infrastructure/mock-provider.ts";
import { isProviderTimeoutError } from "../lib/infrastructure/errors.ts";
import {
  createOrderPaymentIntent,
} from "../lib/payments/order-payment.ts";
import { getActiveReadyServerPlanById } from "../lib/orders/plans.ts";
import {
  createServiceOrderFromQuote,
  payOrderWithWallet,
} from "../lib/orders/service.ts";
import { createReadyServerQuote } from "../lib/recommendation/quote-service.ts";
import { ensureStorefrontSaleReady } from "../lib/storefront/ensure-sale-plans.ts";
import { WalletError } from "../lib/wallet/errors.ts";
import { rialToToman, tomanToRial } from "../lib/money.ts";
import {
  createTopUpIntent,
  finalizeTopUpFromCallback,
} from "../lib/wallet/topup.ts";
import { MIN_TOPUP_TOMAN } from "../lib/wallet/topup-limits.ts";
import { revealInstanceCredential } from "../lib/security/instance-credentials.ts";

import {
  WP5_TERMS,
  applyWp5TestEnv,
  createCustomerAndAdmin,
  createPublishedManualArvanPlan,
  enableMockGateway,
  idempotencyKey,
  wp5Suffix,
  type Wp5Term,
} from "./wp5-lib.mts";

if (!process.env.DATABASE_URL || process.env.ABRCHIN_ISOLATED_TEST !== "1") {
  throw new Error("WP5 golden path requires isolated PostgreSQL");
}

applyWp5TestEnv();

before(async () => {
  await enableMockGateway(prisma);
});

after(async () => {
  await prisma.$disconnect();
});

function topUpTomanFor(priceRial: bigint) {
  let toman = Number(rialToToman(priceRial));
  if (tomanToRial(BigInt(toman)) < priceRial) toman += 1;
  if (toman < MIN_TOPUP_TOMAN) toman = MIN_TOPUP_TOMAN;
  return toman;
}

async function runGoldenPath(termMonths: Wp5Term) {
  const suffix = wp5Suffix(`t${termMonths}`);
  const { plan, regionCode } = await createPublishedManualArvanPlan(
    prisma,
    suffix,
  );
  const { customer, admin } = await createCustomerAndAdmin(prisma, suffix);
  const priced = await getActiveReadyServerPlanById(plan.id, { termMonths });
  assert.ok(priced, "admin-published plan must be priced and sellable");
  assert.equal(isVerifiedSellablePricing(priced.pricing), true);
  assert.equal(priced.pricing.termMonths, termMonths);
  assert.equal(priced.pricing.termDiscountBps, TERM_DISCOUNT_BPS[termMonths]);
  assert.ok(priced.pricing.finalPriceRial > 1n);

  const quoteKey = idempotencyKey(`wp5q${termMonths}${suffix}`);
  const quoted = await createReadyServerQuote({
    planId: plan.id,
    userId: customer.id,
    idempotencyKey: quoteKey,
    termMonths,
    delivery: {
      imageAssetId: `manual:${plan.id}`,
      accessMethod: "ONE_TIME_PASSWORD",
      serverName: `wp5srv${termMonths}`,
    },
  });
  assert.equal(quoted.quote.termMonths, termMonths);
  assert.equal(quoted.quote.termDiscountBps, TERM_DISCOUNT_BPS[termMonths]);
  assert.equal(quoted.quote.amountRial, priced.pricing.finalPriceRial.toString());
  const expiresAt = new Date(quoted.quote.expiresAt);
  assert.ok(expiresAt.getTime() > Date.now(), "quote expiry must be in the future");

  const quotedAgain = await createReadyServerQuote({
    planId: plan.id,
    userId: customer.id,
    idempotencyKey: quoteKey,
    termMonths,
    delivery: {
      imageAssetId: `manual:${plan.id}`,
      accessMethod: "ONE_TIME_PASSWORD",
      serverName: `wp5srv${termMonths}`,
    },
  });
  assert.equal(quotedAgain.quote.id, quoted.quote.id);

  const priceRial = BigInt(quoted.quote.amountRial);
  const toman = topUpTomanFor(priceRial);
  const intent = await createTopUpIntent(customer.id, toman, {
    idempotencyKey: idempotencyKey(`wp5top${termMonths}${suffix}`),
  });
  assert.ok(intent.callbackToken);
  assert.ok(intent.attempt?.authority);

  const firstCallback = await finalizeTopUpFromCallback({
    expectedGateway: "MOCK",
    paymentAttemptId: intent.attempt!.id,
    token: intent.callbackToken!,
    authority: intent.attempt!.authority,
    statusHint: "OK",
  });
  assert.equal(firstCallback.topUp.status, TopUpStatus.SUCCEEDED);
  const replayCallback = await finalizeTopUpFromCallback({
    expectedGateway: "MOCK",
    paymentAttemptId: intent.attempt!.id,
    token: intent.callbackToken!,
    authority: intent.attempt!.authority,
    statusHint: "OK",
  });
  assert.equal(replayCallback.topUp.status, TopUpStatus.SUCCEEDED);
  assert.equal(
    await prisma.walletLedgerEntry.count({
      where: {
        wallet: { userId: customer.id },
        type: LedgerType.TOP_UP,
        referenceId: intent.topUp.id,
      },
    }),
    1,
  );

  const order = await createServiceOrderFromQuote(customer.id, quoted.quote.id);
  const duplicateOrder = await createServiceOrderFromQuote(
    customer.id,
    quoted.quote.id,
  );
  assert.equal(order.id, duplicateOrder.id);
  assert.equal(order.status, ServiceOrderStatus.PENDING_PAYMENT);

  await assert.rejects(
    () =>
      createOrderPaymentIntent({
        userId: customer.id,
        orderId: order.id,
        idempotencyKey: idempotencyKey(`wp5direct${suffix}`),
      }),
    (error: unknown) =>
      error instanceof WalletError && error.code === "direct_order_payment_disabled",
  );

  const [paidA, paidB] = await Promise.all([
    payOrderWithWallet(customer.id, order.id),
    payOrderWithWallet(customer.id, order.id),
  ]);
  assert.equal(paidA.order.status, ServiceOrderStatus.PAID);
  assert.equal(paidB.order.status, ServiceOrderStatus.PAID);
  assert.equal(paidA.infrastructureOrder?.id, paidB.infrastructureOrder?.id);
  assert.equal(
    await prisma.walletLedgerEntry.count({
      where: { referenceType: "order", referenceId: order.id },
    }),
    1,
  );
  const infra = await prisma.infrastructureOrder.findUniqueOrThrow({
    where: { serviceOrderId: order.id },
  });
  assert.equal(infra.status, InfrastructureOrderStatus.WAITING_ADMIN_FUNDING);
  const review = await getProvisionApprovalReview(infra.id);
  assert.equal(review.canApprove, true);

  const secret = `wp5-credential-${suffix}-ok`;
  const manualInput = {
    infrastructureOrderId: infra.id,
    adminUserId: admin.id,
    providerResourceId: `wp5-resource-${suffix}`,
    ipv4: "198.51.100.24",
    region: regionCode,
    externalPlanId: plan.sizeCode,
    externalImageId: plan.imageCode,
    username: "root",
    secret,
    reason: "ثبت کنترل‌شده Fulfillment دستی",
    idempotencyKey: `manual-provision:${infra.id}`,
  };
  await assert.rejects(
    () => completeManualReadyDelivery(manualInput),
    (error: unknown) =>
      error instanceof WalletError && error.code === "invalid_status",
  );
  const approved = await approveProvision({
    infrastructureOrderId: infra.id,
    adminUserId: admin.id,
    reason: "بررسی کامل Provider",
    providerBalanceConfirmed: true,
    idempotencyKey: `provision-approve:${infra.id}`,
  });
  const approvalReplay = await approveProvision({
    infrastructureOrderId: infra.id,
    adminUserId: admin.id,
    reason: "بررسی کامل Provider",
    providerBalanceConfirmed: true,
    idempotencyKey: `provision-approve:${infra.id}`,
  });
  assert.equal(approved.approved, true);
  assert.deepEqual(approvalReplay, approved);

  const manualFirst = await completeManualReadyDelivery(manualInput);
  const manualReplay = await completeManualReadyDelivery(manualInput);
  assert.deepEqual(manualReplay, manualFirst);
  const instance = await prisma.cloudInstance.findUniqueOrThrow({
    where: { id: manualFirst.cloudInstanceId },
    include: { credential: true },
  });
  assert.ok(instance.credential?.ciphertext);
  assert.notEqual(instance.credential?.ciphertext, secret);
  await assert.rejects(
    () => revealInstanceCredential({ instanceId: instance.id, userId: customer.id }),
    /آماده نیست/,
  );

  const deliveryReview = await getDeliveryApprovalReview(infra.id);
  assert.equal(deliveryReview.canApprove, true);
  const delivered = await approveDelivery({
    infrastructureOrderId: infra.id,
    adminUserId: admin.id,
    reason: "Resource، Health و Credential بررسی شد.",
    idempotencyKey: `delivery-approve:${infra.id}`,
  });
  const deliveryReplay = await approveDelivery({
    infrastructureOrderId: infra.id,
    adminUserId: admin.id,
    reason: "Resource، Health و Credential بررسی شد.",
    idempotencyKey: `delivery-approve:${infra.id}`,
  });
  assert.equal(delivered.approved, true);
  assert.deepEqual(deliveryReplay, delivered);

  const revealed = await revealInstanceCredential({
    instanceId: instance.id,
    userId: customer.id,
  });
  assert.equal(revealed.secret, secret);

  const wallet = await prisma.wallet.findUniqueOrThrow({
    where: { userId: customer.id },
  });
  const ledger = await prisma.walletLedgerEntry.findMany({
    where: { walletId: wallet.id },
  });
  const credits = ledger
    .filter((row) => row.direction === "CREDIT" && row.status === "COMPLETED")
    .reduce((sum, row) => sum + row.amount, 0n);
  const debits = ledger
    .filter((row) => row.direction === "DEBIT" && row.status === "COMPLETED")
    .reduce((sum, row) => sum + row.amount, 0n);
  assert.equal(wallet.availableBalance, credits - debits);
  assert.equal(
    ledger.filter((row) => row.type === LedgerType.TOP_UP).length,
    1,
  );
  assert.equal(
    ledger.filter((row) => row.referenceType === "order" && row.referenceId === order.id)
      .length,
    1,
  );
  assert.equal(
    await prisma.auditLog.count({
      where: { entityId: infra.id, action: "provision_approved" },
    }),
    1,
  );
  assert.equal(
    await prisma.adminCommandReceipt.count({
      where: { infrastructureOrderId: infra.id, operation: "APPROVE_PROVISION" },
    }),
    1,
  );
  assert.equal(
    await prisma.adminCommandReceipt.count({
      where: { infrastructureOrderId: infra.id, operation: "APPROVE_DELIVERY" },
    }),
    1,
  );
  return { termMonths, priceRial, orderId: order.id };
}

test("PREPAID golden path for 1, 3, 6, and 12 month terms", async () => {
  const results = [];
  for (const term of WP5_TERMS) {
    results.push(await runGoldenPath(term));
  }
  assert.equal(results.length, 4);
  const byTerm = new Map(results.map((row) => [row.termMonths, row.priceRial]));
  const month1 = byTerm.get(1)!;
  const month12 = byTerm.get(12)!;
  assert.ok(month12 > month1);
  assert.ok(month12 / 12n < month1, "12-month prepaid must be cheaper per month");
});

test("insufficient wallet, expired quote, unpublished plan, and placeholder prices fail closed", async () => {
  const suffix = wp5Suffix("neg");
  const published = await createPublishedManualArvanPlan(prisma, `${suffix}p`);
  const unpublished = await createPublishedManualArvanPlan(prisma, `${suffix}u`, {
    publicationStatus: "DRAFT",
  });
  const placeholder = await createPublishedManualArvanPlan(prisma, `${suffix}z`, {
    monthlyRial: 1n,
  });
  const { customer } = await createCustomerAndAdmin(prisma, suffix);

  await assert.rejects(
    () =>
      createReadyServerQuote({
        planId: unpublished.plan.id,
        userId: customer.id,
        idempotencyKey: idempotencyKey(`wp5unpub${suffix}`),
        delivery: {
          imageAssetId: `manual:${unpublished.plan.id}`,
          accessMethod: "ONE_TIME_PASSWORD",
          serverName: "wp5unpub",
        },
      }),
    (error: unknown) =>
      error instanceof WalletError && error.code === "quote_unavailable",
  );

  assert.throws(
    () => requireVerifiedSellablePricing(null),
    (error: unknown) =>
      error instanceof PricingUnavailableError && error.code === "pricing_unavailable",
  );

  const placeholderPriced = await getActiveReadyServerPlanById(placeholder.plan.id);
  assert.equal(placeholderPriced, null);

  const zero = await createPublishedManualArvanPlan(prisma, `${suffix}0`, {
    monthlyRial: 0n,
  });
  const zeroPriced = await getActiveReadyServerPlanById(zero.plan.id);
  assert.equal(zeroPriced, null);
  await assert.rejects(
    () =>
      createReadyServerQuote({
        planId: zero.plan.id,
        userId: customer.id,
        idempotencyKey: idempotencyKey(`wp5zero${suffix}`),
        delivery: {
          imageAssetId: `manual:${zero.plan.id}`,
          accessMethod: "ONE_TIME_PASSWORD",
          serverName: "wp5zero",
        },
      }),
    (error: unknown) =>
      error instanceof WalletError && error.code === "quote_unavailable",
  );

  const quoted = await createReadyServerQuote({
    planId: published.plan.id,
    userId: customer.id,
    idempotencyKey: idempotencyKey(`wp5negq${suffix}`),
    termMonths: 1,
    delivery: {
      imageAssetId: `manual:${published.plan.id}`,
      accessMethod: "ONE_TIME_PASSWORD",
      serverName: "wp5neg",
    },
  });
  const order = await createServiceOrderFromQuote(customer.id, quoted.quote.id);
  await assert.rejects(
    () => payOrderWithWallet(customer.id, order.id),
    (error: unknown) =>
      error instanceof WalletError && error.code === "insufficient_funds",
  );

  await prisma.recommendationQuote.update({
    where: { id: quoted.quote.id },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });
  await prisma.recommendationSession.update({
    where: { id: (await prisma.recommendationQuote.findUniqueOrThrow({
      where: { id: quoted.quote.id },
      select: { sessionId: true },
    })).sessionId },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });
  const expiredQuote = await createReadyServerQuote({
    planId: published.plan.id,
    userId: customer.id,
    idempotencyKey: idempotencyKey(`wp5exp${suffix}`),
    termMonths: 1,
    delivery: {
      imageAssetId: `manual:${published.plan.id}`,
      accessMethod: "ONE_TIME_PASSWORD",
      serverName: "wp5exp",
    },
  });
  await prisma.recommendationQuote.update({
    where: { id: expiredQuote.quote.id },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });
  await assert.rejects(
    () => createServiceOrderFromQuote(customer.id, expiredQuote.quote.id),
    (error: unknown) =>
      error instanceof WalletError &&
      (error.code === "quote_expired" || error.code === "invalid_quote"),
  );
});

test("customers cannot publish storefront sale configuration", async () => {
  const suffix = wp5Suffix("pub");
  const { customer } = await createCustomerAndAdmin(prisma, suffix);
  await assert.rejects(
    () => ensureStorefrontSaleReady({ actorUserId: customer.id }),
    (error: unknown) => error instanceof WalletError && error.code === "forbidden",
  );
});

test("unknown provider usage fails closed", () => {
  try {
    parseProviderUsage(null);
    assert.fail("expected usage_unknown");
  } catch (error) {
    assert.equal(isSettlementError(error) && error.code === "usage_unknown", true);
  }
  try {
    parseProviderUsage({ input_text_tokens: "nope", output_text_tokens: 1 });
    assert.fail("expected usage_unknown");
  } catch (error) {
    assert.equal(isSettlementError(error) && error.code === "usage_unknown", true);
  }
});

test("provider timeout fails closed without a live provider call", async () => {
  const provider = createMockProviderWithBehavior("timeout");
  await assert.rejects(
    () =>
      provider.createInstance({
        name: "wp5-timeout",
        region: "tehran11",
        size: "irLinuxVPS4",
        image: "ubuntu24-cloudinit-qcow2",
        deliveryMode: "MANAGED",
      }),
    (error: unknown) => isProviderTimeoutError(error),
  );
});
