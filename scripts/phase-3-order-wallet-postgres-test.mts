import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";

import {
  InfrastructureOrderStatus,
  ServiceOrderStatus,
  WalletStatus,
} from "@prisma/client";

import { prisma } from "../lib/db.ts";
import { payOrderWithWallet } from "../lib/orders/service.ts";
import {
  getActivePlanByCode,
  toPlanSnapshot,
} from "../lib/orders/plans.ts";

if (!process.env.DATABASE_URL || process.env.ABRCHIN_ISOLATED_TEST !== "1") {
  throw new Error("Phase 3 order tests require an isolated PostgreSQL database");
}

process.env.NODE_ENV = "test";
process.env.PUBLIC_SALE_ENABLED = "true";
process.env.MANUAL_READY_PUBLIC_SALE_ENABLED = "true";
process.env.ARVAN_MUTATIONS_ENABLED = "false";

after(async () => {
  await prisma.$disconnect();
});

async function createFixture(label: string) {
  const suffix = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}-${label}`;
  const now = new Date();
  const validUntil = new Date(now.getTime() + 60 * 60 * 1_000);
  const catalogItem = await prisma.providerCatalogItem.create({
    data: {
      provider: "ARVAN",
      apiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      source: "MANUAL_ADMIN",
      regionCode: `phase3-${suffix}`,
      sizeCode: `phase3-${suffix}`,
      externalPlanId: `phase3-${suffix}`,
      externalKey: `manual:arvan:v1:phase3:${suffix}`,
      sizeName: "Phase 3 wallet fixture",
      compatibleImageCodes: ["Ubuntu 24.04 LTS"],
      vcpu: 2,
      ramMb: 4096,
      diskGb: 50,
      active: true,
      available: true,
      status: "ACTIVE",
      providerMonthlyPriceIrr: 1_200_000n,
      priceMonthlyAmount: 1_200_000n,
      priceScale: 0,
      currencyCode: "IRR",
      amountUnit: "RIAL",
      manualAvailableUnits: 1,
      manualPriceValidUntil: validUntil,
      manualLastVerifiedAt: now,
      lastSyncedAt: now,
      lastSeenAt: now,
      rawPayload: { source: "phase3_isolated_test" },
      payloadHash: `phase3-${suffix}`,
      catalogVersion: `phase3:${now.toISOString()}`,
    },
  });
  const plan = await prisma.infrastructurePlan.create({
    data: {
      code: `PHASE3_${suffix}`,
      title: "Phase 3 wallet fixture",
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      offerSource: "MANUAL_ADMIN",
      regionCode: catalogItem.regionCode,
      sizeCode: catalogItem.sizeCode,
      imageCode: "Ubuntu 24.04 LTS",
      deliveryMode: "MANAGED",
      vcpu: 2,
      ramGb: 4,
      storageGb: 50,
      salePriceRial: 1_200_000n,
      renewalPriceRial: 1_200_000n,
      estimatedProviderCostRial: 1_200_000n,
      deliveryEstimateMinutes: 15,
      parchinIncluded: true,
      minimumParchinLevel: "PARCHIN_START",
      active: true,
      publicationStatus: "PUBLISHED",
      instantDelivery: false,
      displayDuringProviderOutage: true,
      offerPriceValidUntil: validUntil,
      offerLastVerifiedAt: now,
      catalogItemId: catalogItem.id,
      catalogMappingStatus: "MAPPED",
      catalogMappedAt: now,
    },
  });
  const pricedPlan = await getActivePlanByCode(plan.code);
  assert.ok(pricedPlan);
  const openingBalance = pricedPlan.pricing.finalPriceRial + 500_000n;
  const user = await prisma.user.create({
    data: { mobile: `09${randomBytes(6).readUIntBE(0, 6).toString().padStart(11, "0").slice(0, 9)}` },
  });
  const wallet = await prisma.wallet.create({
    data: {
      userId: user.id,
      availableBalance: openingBalance,
      status: WalletStatus.ACTIVE,
    },
  });
  const order = await prisma.serviceOrder.create({
    data: {
      userId: user.id,
      title: plan.title,
      amount: pricedPlan.pricing.finalPriceRial,
      status: ServiceOrderStatus.PENDING_PAYMENT,
      planId: plan.id,
      planCode: plan.code,
      planSnapshot: toPlanSnapshot(pricedPlan, {
        createdAt: now,
        expiresAt: validUntil,
      }),
      quoteExpiresAt: validUntil,
      provider: plan.provider,
      providerApiVersion: plan.providerApiVersion,
      productKind: plan.productKind,
      parchinLevel: pricedPlan.pricing.parchinLevel,
      productFlowState: "AWAITING_PAYMENT",
    },
  });
  return { catalogItem, order, user, wallet, openingBalance };
}

test("concurrent wallet submit debits the locked amount and creates one order effect", async () => {
  const fixture = await createFixture("concurrent");
  const [first, replay] = await Promise.all([
    payOrderWithWallet(fixture.user.id, fixture.order.id),
    payOrderWithWallet(fixture.user.id, fixture.order.id),
  ]);

  assert.equal(first.order.status, ServiceOrderStatus.PAID);
  assert.equal(replay.order.status, ServiceOrderStatus.PAID);
  assert.equal(
    first.infrastructureOrder?.id,
    replay.infrastructureOrder?.id,
  );
  assert.equal(
    first.infrastructureOrder?.status,
    InfrastructureOrderStatus.WAITING_ADMIN_FUNDING,
  );
  const [wallet, ledgers, infrastructureOrders, cloudInstances, catalog] =
    await Promise.all([
      prisma.wallet.findUniqueOrThrow({ where: { id: fixture.wallet.id } }),
      prisma.walletLedgerEntry.findMany({
        where: {
          referenceType: "order",
          referenceId: fixture.order.id,
          type: "SERVICE_PURCHASE",
        },
      }),
      prisma.infrastructureOrder.count({
        where: { serviceOrderId: fixture.order.id },
      }),
      prisma.cloudInstance.count({ where: { userId: fixture.user.id } }),
      prisma.providerCatalogItem.findUniqueOrThrow({
        where: { id: fixture.catalogItem.id },
      }),
    ]);
  assert.equal(ledgers.length, 1);
  assert.equal(ledgers[0]?.amount, fixture.order.amount);
  assert.equal(
    wallet.availableBalance,
    fixture.openingBalance - fixture.order.amount,
  );
  assert.equal(infrastructureOrders, 1);
  assert.equal(cloudInstances, 0);
  assert.equal(catalog.manualAvailableUnits, 0);
});

test("failure after debit rolls back wallet, ledger, inventory, and order", async () => {
  const fixture = await createFixture("rollback");
  await assert.rejects(
    payOrderWithWallet(fixture.user.id, fixture.order.id, {
      testInjectFailureAfterDebit: true,
    }),
    /Injected failure/,
  );
  const [wallet, order, ledgerCount, infrastructureCount, catalog] =
    await Promise.all([
      prisma.wallet.findUniqueOrThrow({ where: { id: fixture.wallet.id } }),
      prisma.serviceOrder.findUniqueOrThrow({ where: { id: fixture.order.id } }),
      prisma.walletLedgerEntry.count({
        where: { referenceId: fixture.order.id },
      }),
      prisma.infrastructureOrder.count({
        where: { serviceOrderId: fixture.order.id },
      }),
      prisma.providerCatalogItem.findUniqueOrThrow({
        where: { id: fixture.catalogItem.id },
      }),
    ]);
  assert.equal(wallet.availableBalance, fixture.openingBalance);
  assert.equal(order.status, ServiceOrderStatus.PENDING_PAYMENT);
  assert.equal(ledgerCount, 0);
  assert.equal(infrastructureCount, 0);
  assert.equal(catalog.manualAvailableUnits, 1);
});
