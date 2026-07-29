import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  InfrastructureOrderStatus,
  PrismaClient,
  ProvisioningJobStatus,
  ServiceOrderStatus,
  WalletStatus,
} from "@prisma/client";

import { confirmProviderFunding } from "../lib/infrastructure/funding.ts";
import { retryFailedProvisioning } from "../lib/infrastructure/retry.ts";
import { payOrderWithWallet, refundOrder } from "../lib/orders/service.ts";
import { getActivePlanByCode, toPlanSnapshot } from "../lib/orders/plans.ts";
import { tomanToRial } from "../lib/money.ts";
import { decimalToScaledInteger } from "../lib/pricing/provider-pricing.ts";

const databaseUrl = process.env.DATABASE_URL;
const prisma = databaseUrl ? new PrismaClient() : null;
const previousMode = process.env.INFRASTRUCTURE_PROVIDER_MODE;
const previousNodeEnv = process.env.NODE_ENV;

after(async () => {
  process.env.INFRASTRUCTURE_PROVIDER_MODE = previousMode;
  process.env.NODE_ENV = previousNodeEnv;
  if (prisma) await prisma.$disconnect();
});

async function cleanupMobile(mobile: string) {
  if (!prisma) return;
  const user = await prisma.user.findUnique({ where: { mobile } });
  if (!user) return;
  await prisma.providerOperationLog.deleteMany({ where: { infrastructureOrder: { userId: user.id } } });
  await prisma.provisioningJob.deleteMany({ where: { infrastructureOrder: { userId: user.id } } });
  await prisma.cloudInstance.deleteMany({ where: { userId: user.id } });
  await prisma.adminNotification.deleteMany({ where: { infrastructureOrder: { userId: user.id } } });
  await prisma.providerFundingConfirmation.deleteMany({ where: { infrastructureOrder: { userId: user.id } } });
  await prisma.infrastructureOrder.deleteMany({ where: { userId: user.id } });
  await prisma.serviceOrder.deleteMany({ where: { userId: user.id } });
  await prisma.walletLedgerEntry.deleteMany({ where: { wallet: { userId: user.id } } });
  await prisma.wallet.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

async function seedDevPlan() {
  if (!prisma) return null;
  const syncedAt = new Date();
  const catalogItem = await prisma.providerCatalogItem.upsert({
    where: {
      provider_regionCode_sizeCode: {
        provider: "PARSPACK",
        regionCode: "tehran11",
        sizeCode: "irLinuxVPS4",
      },
    },
    update: {
      compatibleImageCodes: ["ubuntu24-cloudinit-qcow2"],
      available: true,
      active: true,
      priceMonthlyAmount: decimalToScaledInteger("120000"),
      priceScale: 6,
      currencyCode: "IRR",
      amountUnit: "TOMAN",
      lastSyncedAt: syncedAt,
    },
    create: {
      provider: "PARSPACK",
      regionCode: "tehran11",
      sizeCode: "irLinuxVPS4",
      sizeName: "Development",
      compatibleImageCodes: ["ubuntu24-cloudinit-qcow2"],
      vcpu: 2,
      ramMb: 4096,
      diskGb: 50,
      available: true,
      active: true,
      priceMonthlyAmount: decimalToScaledInteger("120000"),
      priceScale: 6,
      currencyCode: "IRR",
      amountUnit: "TOMAN",
      lastSyncedAt: syncedAt,
    },
  });
  await prisma.providerPricingConfig.upsert({
    where: { provider: "PARSPACK" },
    update: { markupBasisPoints: 2500 },
    create: {
      id: "parspack",
      provider: "PARSPACK",
      markupBasisPoints: 2500,
    },
  });
  return prisma.infrastructurePlan.upsert({
    where: { code: "DEV_STARTER" },
    update: {
      salePriceRial: tomanToRial(150_000),
      estimatedProviderCostRial: tomanToRial(120_000),
      active: true,
      catalogItemId: catalogItem.id,
      catalogMappingStatus: "MAPPED",
      catalogMappedAt: syncedAt,
    },
    create: {
      code: "DEV_STARTER",
      title: "شروع توسعه",
      provider: "PARSPACK",
      regionCode: "tehran11",
      sizeCode: "irLinuxVPS4",
      imageCode: "ubuntu24-cloudinit-qcow2",
      deliveryMode: "RAW",
      salePriceRial: tomanToRial(150_000),
      estimatedProviderCostRial: tomanToRial(120_000),
      renewalPriceRial: tomanToRial(150_000),
      vcpu: 2,
      ramGb: 4,
      storageGb: 50,
      catalogItemId: catalogItem.id,
      catalogMappingStatus: "MAPPED",
      catalogMappedAt: syncedAt,
      active: true,
      sortOrder: 1,
    },
  });
}

async function createPaidOrderFixture(mobile: string) {
  if (!prisma) throw new Error("no prisma");
  const plan = await seedDevPlan();
  assert.ok(plan);
  const pricedPlan = await getActivePlanByCode(plan.code);
  assert.ok(pricedPlan);
  const createdAt = new Date();
  const quoteExpiresAt = new Date(createdAt.getTime() + 10 * 60 * 1000);
  const user = await prisma.user.create({ data: { mobile } });
  await prisma.wallet.create({
    data: { userId: user.id, availableBalance: tomanToRial(2_000_000), status: WalletStatus.ACTIVE },
  });
  const order = await prisma.serviceOrder.create({
    data: {
      userId: user.id,
      title: plan.title,
      amount: plan.salePriceRial,
      status: ServiceOrderStatus.PENDING_PAYMENT,
      planId: plan.id,
      planCode: plan.code,
      planSnapshot: toPlanSnapshot(pricedPlan, {
        createdAt,
        expiresAt: quoteExpiresAt,
      }),
      quoteExpiresAt,
    },
  });
  return { user, plan, order };
}

test("payOrderWithWallet rolls back all writes on injected failure after debit", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }

  const mobile = "09128881001";
  await cleanupMobile(mobile);
  const { user, order } = await createPaidOrderFixture(mobile);
  const walletBefore = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });

  await assert.rejects(
    () =>
      payOrderWithWallet(user.id, order.id, {
        testInjectFailureAfterDebit: true,
      }),
    /Injected failure/,
  );

  const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
  assert.equal(walletAfter.availableBalance, walletBefore.availableBalance);

  const ledgerCount = await prisma.walletLedgerEntry.count({
    where: { referenceId: order.id },
  });
  assert.equal(ledgerCount, 0);

  const refreshedOrder = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(refreshedOrder.status, ServiceOrderStatus.PENDING_PAYMENT);

  const infraCount = await prisma.infrastructureOrder.count({ where: { serviceOrderId: order.id } });
  assert.equal(infraCount, 0);

  await cleanupMobile(mobile);
});

test("payment is atomic and creates infrastructure order without cloud instance", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }

  const mobile = "09128881002";
  await cleanupMobile(mobile);
  const { user, order } = await createPaidOrderFixture(mobile);

  const result = await payOrderWithWallet(user.id, order.id);
  assert.equal(result.order.status, ServiceOrderStatus.PAID);
  assert.equal(result.infrastructureOrder?.status, InfrastructureOrderStatus.WAITING_ADMIN_FUNDING);
  assert.equal(await prisma.cloudInstance.count({ where: { userId: user.id } }), 0);

  await cleanupMobile(mobile);
});

test("payment uses the locked order quote when the plan price changes", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }

  const mobile = "09128881009";
  await cleanupMobile(mobile);
  const { user, plan, order } = await createPaidOrderFixture(mobile);
  const quotedAmount = order.amount;

  await prisma.infrastructurePlan.update({
    where: { id: plan.id },
    data: { salePriceRial: quotedAmount + tomanToRial(50_000) },
  });

  await payOrderWithWallet(user.id, order.id);
  const ledger = await prisma.walletLedgerEntry.findFirstOrThrow({
    where: { referenceId: order.id, direction: "DEBIT" },
  });
  assert.equal(ledger.amount, quotedAmount);

  await cleanupMobile(mobile);
});

test("payment rejects an expired quote without debiting the wallet", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }

  const mobile = "09128881010";
  await cleanupMobile(mobile);
  const { user, order } = await createPaidOrderFixture(mobile);
  const walletBefore = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
  await prisma.serviceOrder.update({
    where: { id: order.id },
    data: { quoteExpiresAt: new Date(Date.now() - 1_000) },
  });

  await assert.rejects(() => payOrderWithWallet(user.id, order.id), /اعتبار قیمت/);
  const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
  assert.equal(walletAfter.availableBalance, walletBefore.availableBalance);
  assert.equal(
    await prisma.walletLedgerEntry.count({ where: { referenceId: order.id } }),
    0,
  );

  await cleanupMobile(mobile);
});

test("funding confirmation supports multiple attempts after provider balance block", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }

  const mobile = "09128881003";
  const adminMobile = "09128881004";
  await cleanupMobile(mobile);
  await cleanupMobile(adminMobile);

  const { user, order } = await createPaidOrderFixture(mobile);
  const paid = await payOrderWithWallet(user.id, order.id);
  const admin = await prisma.user.create({ data: { mobile: adminMobile, role: "ADMIN" } });
  const infraId = paid.infrastructureOrder!.id;

  const first = await confirmProviderFunding({
    infrastructureOrderId: infraId,
    adminUserId: admin.id,
    fundedAmountToman: 120_000,
    idempotencyKey: `test_funding_${infraId}_1`,
  });
  const duplicate = await confirmProviderFunding({
    infrastructureOrderId: infraId,
    adminUserId: admin.id,
    fundedAmountToman: 120_000,
    idempotencyKey: `test_funding_${infraId}_1`,
  });
  assert.equal(first.fundingConfirmation.id, duplicate.fundingConfirmation.id);

  await prisma.infrastructureOrder.update({
    where: { id: infraId },
    data: { status: InfrastructureOrderStatus.WAITING_ADMIN_FUNDING },
  });
  await prisma.provisioningJob.updateMany({
    where: { infrastructureOrderId: infraId },
    data: { status: ProvisioningJobStatus.BLOCKED_PROVIDER_BALANCE, finishedAt: new Date() },
  });

  const second = await confirmProviderFunding({
    infrastructureOrderId: infraId,
    adminUserId: admin.id,
    fundedAmountToman: 150_000,
    idempotencyKey: `test_funding_${infraId}_2`,
  });
  assert.equal(second.fundingConfirmation.attempt, 2);

  const confirmations = await prisma.providerFundingConfirmation.count({
    where: { infrastructureOrderId: infraId },
  });
  assert.equal(confirmations, 2);

  await cleanupMobile(mobile);
  await cleanupMobile(adminMobile);
});

test("refund keeps original ledger immutable and creates reverse entry", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }

  const mobile = "09128881005";
  const adminMobile = "09128881006";
  await cleanupMobile(mobile);
  await cleanupMobile(adminMobile);

  const { user, order } = await createPaidOrderFixture(mobile);
  await payOrderWithWallet(user.id, order.id);
  const debit = await prisma.walletLedgerEntry.findFirstOrThrow({
    where: { referenceId: order.id, direction: "DEBIT" },
  });
  const debitSnapshot = {
    status: debit.status,
    amount: debit.amount,
    direction: debit.direction,
    balanceAfter: debit.balanceAfter,
    metadata: debit.metadata,
  };

  const admin = await prisma.user.create({ data: { mobile: adminMobile, role: "ADMIN" } });
  await refundOrder({ orderId: order.id, actorUserId: admin.id, reason: "تست بازگشت" });

  const original = await prisma.walletLedgerEntry.findUniqueOrThrow({ where: { id: debit.id } });
  assert.deepEqual(
    {
      status: original.status,
      amount: original.amount,
      direction: original.direction,
      balanceAfter: original.balanceAfter,
      metadata: original.metadata,
    },
    debitSnapshot,
  );
  assert.equal(original.status, "COMPLETED");

  const refund = await prisma.walletLedgerEntry.findFirstOrThrow({
    where: { idempotencyKey: `order_refund_${order.id}` },
  });
  assert.equal(refund.reversedEntryId, debit.id);
  assert.equal(refund.type, "REFUND");

  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
  assert.equal(wallet.availableBalance, tomanToRial(2_000_000));

  await cleanupMobile(mobile);
  await cleanupMobile(adminMobile);
});

test("retry is blocked for NEEDS_RECONCILIATION until reconcile", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }

  const mobile = "09128881007";
  const adminMobile = "09128881008";
  await cleanupMobile(mobile);
  await cleanupMobile(adminMobile);

  const { user, order } = await createPaidOrderFixture(mobile);
  await payOrderWithWallet(user.id, order.id);
  const infra = await prisma.infrastructureOrder.findUniqueOrThrow({ where: { serviceOrderId: order.id } });
  const admin = await prisma.user.create({ data: { mobile: adminMobile, role: "ADMIN" } });

  await prisma.infrastructureOrder.update({
    where: { id: infra.id },
    data: { status: InfrastructureOrderStatus.NEEDS_RECONCILIATION },
  });

  await assert.rejects(
    () =>
      retryFailedProvisioning({
        infrastructureOrderId: infra.id,
        adminUserId: admin.id,
        reason: "تلاش مجدد",
      }),
    /تطبیق/,
  );

  await cleanupMobile(mobile);
  await cleanupMobile(adminMobile);
});
