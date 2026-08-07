import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  InfrastructureOrderStatus,
  InfrastructureProvider,
  PrismaClient,
  ServiceOrderStatus,
  WalletStatus,
} from "@prisma/client";

import { FakeCloudProviderAdapter } from "../lib/infrastructure/fake-cloud-provider-adapter.ts";
import { completeManualReadyDelivery } from "../lib/infrastructure/manual-ready-delivery.ts";
import { approveProvision } from "../lib/infrastructure/provision-approval.ts";
import { retryFailedProvisioning } from "../lib/infrastructure/retry.ts";
import { payOrderWithWallet, refundOrder } from "../lib/orders/service.ts";
import { getActivePlanByCode, toPlanSnapshot } from "../lib/orders/plans.ts";
import { tomanToRial } from "../lib/money.ts";
import { decimalToScaledInteger } from "../lib/pricing/provider-pricing.ts";

const databaseUrl = process.env.DATABASE_URL;
const prisma = databaseUrl ? new PrismaClient() : null;
const previousMode = process.env.INFRASTRUCTURE_PROVIDER_MODE;
const previousNodeEnv = process.env.NODE_ENV;
const previousParsPackPublicSale =
  process.env.PARSPACK_PUBLIC_SALE_ENABLED;
const previousParsPackMutations =
  process.env.PARSPACK_MUTATIONS_ENABLED;
const previousManualReadySale =
  process.env.MANUAL_READY_PUBLIC_SALE_ENABLED;
process.env.PARSPACK_PUBLIC_SALE_ENABLED = "true";
process.env.PARSPACK_MUTATIONS_ENABLED = "true";
process.env.MANUAL_READY_PUBLIC_SALE_ENABLED = "true";

function createParsPackPricingAdapter() {
  return new FakeCloudProviderAdapter({
    provider: InfrastructureProvider.PARSPACK,
    plansByRegion: {
      tehran11: [
        {
          externalPlanId: "irLinuxVPS4",
          region: "tehran11",
          name: "Linux VPS 4",
          vcpu: 2,
          ramMb: 4096,
          diskGb: 50,
          resourceContractValid: true,
          available: true,
          priceHourlyIrr: 12_000n,
          priceMonthlyIrr: 1_200_000n,
          sourceMoneyUnit: "TOMAN",
          rawUpdatedAt: null,
          rawPayload: {},
        },
      ],
    },
    imagesByRegion: {
      tehran11: [
        {
          externalId: "ubuntu24-cloudinit-qcow2",
          region: "tehran11",
          name: "Ubuntu 24",
          operatingSystem: "linux",
          minDiskGb: null,
          minRamMb: null,
          available: true,
          sshKeySupported: true,
          sshPasswordSupported: true,
          rawUpdatedAt: null,
          rawPayload: {},
        },
      ],
    },
  });
}

after(async () => {
  process.env.INFRASTRUCTURE_PROVIDER_MODE = previousMode;
  process.env.NODE_ENV = previousNodeEnv;
  if (previousParsPackPublicSale === undefined) {
    delete process.env.PARSPACK_PUBLIC_SALE_ENABLED;
  } else {
    process.env.PARSPACK_PUBLIC_SALE_ENABLED = previousParsPackPublicSale;
  }
  if (previousParsPackMutations === undefined) {
    delete process.env.PARSPACK_MUTATIONS_ENABLED;
  } else {
    process.env.PARSPACK_MUTATIONS_ENABLED = previousParsPackMutations;
  }
  if (previousManualReadySale === undefined) {
    delete process.env.MANUAL_READY_PUBLIC_SALE_ENABLED;
  } else {
    process.env.MANUAL_READY_PUBLIC_SALE_ENABLED = previousManualReadySale;
  }
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
  // Wallet payment requires a fresh, successful catalog sync for
  // API_CATALOG plans (pay-order freshness gate). Seed the provider state
  // the way a real recent sync would.
  await prisma.providerCatalogState.upsert({
    where: { provider: "PARSPACK" },
    update: {
      lastCatalogSync: syncedAt,
      lastSyncStatus: "SUCCEEDED",
      freshnessSlaSeconds: 900,
    },
    create: {
      id: "parspack-v1",
      provider: "PARSPACK",
      apiVersion: "v1",
      enabled: true,
      lastCatalogSync: syncedAt,
      lastSyncStatus: "SUCCEEDED",
      freshnessSlaSeconds: 900,
    },
  });
  const catalogItem = await prisma.providerCatalogItem.upsert({
    where: {
      provider_apiVersion_regionCode_externalPlanId: {
        provider: "PARSPACK",
        apiVersion: "v1",
        regionCode: "tehran11",
        externalPlanId: "irLinuxVPS4",
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
      apiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      regionCode: "tehran11",
      sizeCode: "irLinuxVPS4",
      externalPlanId: "irLinuxVPS4",
      externalKey: "parspack:v1:tehran11:irLinuxVPS4",
      sizeName: "Development",
      compatibleImageCodes: ["ubuntu24-cloudinit-qcow2"],
      vcpu: 2,
      ramMb: 4096,
      diskGb: 50,
      available: true,
      active: true,
      status: "ACTIVE",
      priceMonthlyAmount: decimalToScaledInteger("120000"),
      priceScale: 6,
      currencyCode: "IRR",
      amountUnit: "TOMAN",
      providerMonthlyPriceIrr: 1_200_000n,
      lastSyncedAt: syncedAt,
      lastSeenAt: syncedAt,
      rawPayload: {},
      payloadHash: "infrastructure-test",
      catalogVersion: syncedAt.toISOString(),
    },
  });
  await prisma.providerPricingConfig.upsert({
    where: { provider: "PARSPACK" },
    update: {
      apiVersion: "v1",
      enabled: true,
      markupBasisPoints: 2500,
      sourceMoneyUnit: "TOMAN",
    },
    create: {
      id: "parspack",
      provider: "PARSPACK",
      apiVersion: "v1",
      enabled: true,
      markupBasisPoints: 2500,
      sourceMoneyUnit: "TOMAN",
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
      id: "infrastructure-test-parspack-ready",
      provider: "PARSPACK",
      apiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      enabled: true,
      markupBasisPoints: 0,
    },
  });
  // Legacy payment fixtures lock quotes against flat provider markup. Disable
  // the profit curve so revalidation stays on the test-configured BPS.
  await prisma.profitCurveConfiguration.upsert({
    where: { id: "default" },
    update: { enabled: false },
    create: {
      id: "default",
      enabled: false,
      minimumPostDiscountGrossMarginBps: 2_000,
    },
  });
  return prisma.infrastructurePlan.upsert({
    where: { code: "DEV_STARTER" },
    update: {
      provider: "PARSPACK",
      providerApiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      deliveryMode: "MANAGED",
      salePriceRial: tomanToRial(150_000),
      estimatedProviderCostRial: tomanToRial(120_000),
      active: true,
      publicationStatus: "PUBLISHED",
      parchinIncluded: true,
      minimumParchinLevel: "PARCHIN_START",
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
      providerApiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      deliveryMode: "MANAGED",
      salePriceRial: tomanToRial(150_000),
      estimatedProviderCostRial: tomanToRial(120_000),
      renewalPriceRial: tomanToRial(150_000),
      vcpu: 2,
      ramGb: 4,
      storageGb: 50,
      catalogItemId: catalogItem.id,
      catalogMappingStatus: "MAPPED",
      catalogMappedAt: syncedAt,
      parchinIncluded: true,
      minimumParchinLevel: "PARCHIN_START",
      active: true,
      publicationStatus: "PUBLISHED",
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
      amount: pricedPlan.pricing.finalPriceRial,
      status: ServiceOrderStatus.PENDING_PAYMENT,
      planId: plan.id,
      planCode: plan.code,
      planSnapshot: toPlanSnapshot(pricedPlan, {
        createdAt,
        expiresAt: quoteExpiresAt,
      }),
      quoteExpiresAt,
      provider: pricedPlan.provider,
      providerApiVersion: pricedPlan.providerApiVersion,
      productKind: pricedPlan.productKind,
      parchinLevel: pricedPlan.pricing.parchinLevel,
      productFlowState: "AWAITING_PAYMENT",
    },
  });
  return { user, plan, order };
}

async function seedManualReadyPlan(availableUnits: number) {
  if (!prisma) return null;
  const now = new Date();
  const validUntil = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
  const catalogItem = await prisma.providerCatalogItem.upsert({
    where: {
      provider_apiVersion_regionCode_externalPlanId: {
        provider: "ARVAN",
        apiVersion: "v1",
        regionCode: "abrchin-test",
        externalPlanId: "manual-infrastructure-test",
      },
    },
    update: {
      source: "MANUAL_ADMIN",
      productKind: "READY_INSTANT_SERVER",
      compatibleImageCodes: ["Ubuntu Linux"],
      active: true,
      available: availableUnits > 0,
      status: availableUnits > 0 ? "ACTIVE" : "UNAVAILABLE",
      providerMonthlyPriceIrr: 1_200_000n,
      priceMonthlyAmount: 1_200_000n * 1_000_000n,
      priceScale: 6,
      currencyCode: "IRR",
      amountUnit: "RIAL",
      manualAvailableUnits: availableUnits,
      manualPriceValidUntil: validUntil,
      manualLastVerifiedAt: now,
      lastSyncedAt: now,
      lastSeenAt: now,
    },
    create: {
      provider: "ARVAN",
      apiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      source: "MANUAL_ADMIN",
      regionCode: "abrchin-test",
      sizeCode: "manual-infrastructure-test",
      externalPlanId: "manual-infrastructure-test",
      externalKey: "manual:arvan:v1:abrchin-test:manual-infrastructure-test",
      sizeName: "Manual infrastructure test",
      compatibleImageCodes: ["Ubuntu Linux"],
      vcpu: 2,
      ramMb: 4096,
      diskGb: 50,
      active: true,
      available: availableUnits > 0,
      status: availableUnits > 0 ? "ACTIVE" : "UNAVAILABLE",
      providerMonthlyPriceIrr: 1_200_000n,
      priceMonthlyAmount: 1_200_000n * 1_000_000n,
      priceScale: 6,
      currencyCode: "IRR",
      amountUnit: "RIAL",
      manualAvailableUnits: availableUnits,
      manualPriceValidUntil: validUntil,
      manualLastVerifiedAt: now,
      lastSyncedAt: now,
      lastSeenAt: now,
      rawPayload: { source: "manual_admin_test" },
      payloadHash: "manual-infrastructure-test",
      catalogVersion: `manual-test:${now.toISOString()}`,
    },
  });
  return prisma.infrastructurePlan.upsert({
    where: { code: "MANUAL_INFRASTRUCTURE_TEST" },
    update: {
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      offerSource: "MANUAL_ADMIN",
      regionCode: catalogItem.regionCode,
      sizeCode: catalogItem.sizeCode,
      imageCode: "Ubuntu Linux",
      deliveryMode: "MANAGED",
      active: true,
      publicationStatus: "PUBLISHED",
      parchinIncluded: true,
      minimumParchinLevel: "PARCHIN_START",
      offerPriceValidUntil: validUntil,
      offerLastVerifiedAt: now,
      catalogItemId: catalogItem.id,
      catalogMappingStatus: "MAPPED",
      catalogMappedAt: now,
    },
    create: {
      code: "MANUAL_INFRASTRUCTURE_TEST",
      title: "Manual infrastructure test",
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      offerSource: "MANUAL_ADMIN",
      regionCode: catalogItem.regionCode,
      sizeCode: catalogItem.sizeCode,
      imageCode: "Ubuntu Linux",
      deliveryMode: "MANAGED",
      salePriceRial: 1_200_000n,
      renewalPriceRial: 1_200_000n,
      estimatedProviderCostRial: 1_200_000n,
      deliveryEstimateMinutes: 15,
      parchinIncluded: true,
      minimumParchinLevel: "PARCHIN_START",
      active: true,
      publicationStatus: "PUBLISHED",
      instantDelivery: true,
      displayDuringProviderOutage: true,
      offerPriceValidUntil: validUntil,
      offerLastVerifiedAt: now,
      catalogItemId: catalogItem.id,
      catalogMappingStatus: "MAPPED",
      catalogMappedAt: now,
    },
  });
}

async function createManualOrderFixture(mobile: string) {
  if (!prisma) throw new Error("no prisma");
  const plan = await seedManualReadyPlan(1);
  assert.ok(plan);
  const pricedPlan = await getActivePlanByCode(plan.code);
  assert.ok(pricedPlan);
  const createdAt = new Date();
  const quoteExpiresAt = new Date(createdAt.getTime() + 10 * 60 * 1_000);
  const user = await prisma.user.create({ data: { mobile } });
  await prisma.wallet.create({
    data: {
      userId: user.id,
      availableBalance: 10_000_000n,
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
      planSnapshot: toPlanSnapshot(pricedPlan, { createdAt, expiresAt: quoteExpiresAt }),
      quoteExpiresAt,
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      parchinLevel: pricedPlan.pricing.parchinLevel,
      productFlowState: "AWAITING_PAYMENT",
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
        providerAdapter: createParsPackPricingAdapter(),
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

  const result = await payOrderWithWallet(user.id, order.id, {
    providerAdapter: createParsPackPricingAdapter(),
  });
  assert.equal(result.order.status, ServiceOrderStatus.PAID);
  assert.equal(result.infrastructureOrder?.status, InfrastructureOrderStatus.WAITING_ADMIN_FUNDING);
  assert.equal(await prisma.cloudInstance.count({ where: { userId: user.id } }), 0);

  await cleanupMobile(mobile);
});

test("manual inventory decrement rolls back with an injected payment failure", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }
  const mobile = "09128881011";
  await cleanupMobile(mobile);
  const { user, plan, order } = await createManualOrderFixture(mobile);
  const before = await prisma.providerCatalogItem.findUniqueOrThrow({
    where: { id: plan.catalogItemId! },
    select: { manualAvailableUnits: true },
  });
  await assert.rejects(
    payOrderWithWallet(user.id, order.id, {
      testInjectFailureAfterDebit: true,
    }),
    /Injected failure/,
  );
  const after = await prisma.providerCatalogItem.findUniqueOrThrow({
    where: { id: plan.catalogItemId! },
    select: { manualAvailableUnits: true },
  });
  assert.equal(after.manualAvailableUnits, before.manualAvailableUnits);
  assert.equal(
    await prisma.walletLedgerEntry.count({ where: { referenceId: order.id } }),
    0,
  );
  await cleanupMobile(mobile);
});

test("two concurrent manual payments cannot oversell one unit", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }
  const firstMobile = "09128881012";
  const secondMobile = "09128881013";
  const adminMobile = "09128881016";
  await cleanupMobile(firstMobile);
  await cleanupMobile(secondMobile);
  await cleanupMobile(adminMobile);
  const first = await createManualOrderFixture(firstMobile);
  const second = await createManualOrderFixture(secondMobile);
  const results = await Promise.allSettled([
    payOrderWithWallet(first.user.id, first.order.id),
    payOrderWithWallet(second.user.id, second.order.id),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1,
  );
  const item = await prisma.providerCatalogItem.findUniqueOrThrow({
    where: { id: first.plan.catalogItemId! },
  });
  assert.equal(item.manualAvailableUnits, 0);
  assert.equal(
    await prisma.walletLedgerEntry.count({
      where: {
        referenceId: { in: [first.order.id, second.order.id] },
        direction: "DEBIT",
      },
    }),
    1,
  );
  const successful =
    results[0]?.status === "fulfilled" ? first : second;
  const admin = await prisma.user.create({
    data: { mobile: adminMobile, role: "ADMIN" },
  });
  const refundInput = {
    orderId: successful.order.id,
    actorUserId: admin.id,
    reason: "آزادسازی موجودی رزروشده در Refund تست",
    idempotencyKey:
      `manual-inventory-refund-${successful.order.id}`,
  };
  await refundOrder(refundInput);
  await refundOrder(refundInput);
  assert.equal(
    (
      await prisma.providerCatalogItem.findUniqueOrThrow({
        where: { id: first.plan.catalogItemId! },
      })
    ).manualAvailableUnits,
    1,
  );
  await cleanupMobile(firstMobile);
  await cleanupMobile(secondMobile);
  await cleanupMobile(adminMobile);
});

test("manual ready delivery is idempotent and never creates a provider job", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }
  const mobile = "09128881014";
  const adminMobile = "09128881015";
  await cleanupMobile(mobile);
  await cleanupMobile(adminMobile);
  const previousCredentialKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
  try {
    const { user, plan, order } =
      await createManualOrderFixture(mobile);
    const paid = await payOrderWithWallet(user.id, order.id);
    const deliveryConfiguration = {
      provider: "ARVAN" as const,
      providerApiVersion: "v1",
      productKind: "READY_INSTANT_SERVER" as const,
      region: plan.regionCode,
      externalPlanId: plan.sizeCode,
      externalImageId: plan.imageCode,
      externalNetworkId: "manual-network",
      externalSecurityId: "manual-security",
      topologyVerificationMode: "STRICT_OBSERVED",
      accessMethod: "ONE_TIME_PASSWORD",
      sshKeyName: null,
      initScript: null,
    };
    await prisma.infrastructureOrder.update({
      where: { id: paid.infrastructureOrder!.id },
      data: {
        providerSelectionSnapshot: {
          ...deliveryConfiguration,
          deliveryConfiguration,
          manualInventoryReserved: true,
        },
      },
    });
    const admin = await prisma.user.create({
      data: { mobile: adminMobile, role: "ADMIN" },
    });
    const approval = await approveProvision({
      infrastructureOrderId: paid.infrastructureOrder!.id,
      adminUserId: admin.id,
      reason: "تأیید تستی Fulfillment دستی",
      providerBalanceConfirmed: true,
      idempotencyKey: `manual-approval-${order.id}`,
    });
    assert.equal(approval.approved, true);
    const input = {
      infrastructureOrderId: paid.infrastructureOrder!.id,
      adminUserId: admin.id,
      providerResourceId: `manual-${order.id}`,
      ipv4: "203.0.113.15",
      region: plan.regionCode,
      externalPlanId: plan.sizeCode,
      externalImageId: plan.imageCode,
      username: "root",
      secret: "Founder-Test-Only-123!",
      reason: "تست تحویل دستی سفارش",
      idempotencyKey: `manual-delivery-${order.id}`,
    };
    const first = await completeManualReadyDelivery(input);
    const replay = await completeManualReadyDelivery(input);
    assert.deepEqual(replay, first);
    const infrastructure = await prisma.infrastructureOrder.findUniqueOrThrow({
      where: { id: paid.infrastructureOrder!.id },
      include: {
        serviceOrder: true,
        cloudInstance: { include: { credential: true, subscription: true } },
        provisioningJobs: true,
        healthChecks: true,
        secureDeliveryEvents: true,
      },
    });
    assert.equal(
      infrastructure.status,
      InfrastructureOrderStatus.PROVISIONING,
    );
    assert.equal(
      infrastructure.productFlowState,
      "WAITING_ADMIN_DELIVERY_APPROVAL",
    );
    assert.equal(
      infrastructure.serviceOrder.productFlowState,
      "WAITING_ADMIN_DELIVERY_APPROVAL",
    );
    assert.equal(
      infrastructure.productFlowRevision,
      infrastructure.serviceOrder.productFlowRevision,
    );
    assert.equal(infrastructure.cloudInstance?.status, "PENDING");
    assert.equal(infrastructure.cloudInstance?.credential?.status, "READY");
    assert.notEqual(
      infrastructure.cloudInstance?.credential?.ciphertext,
      input.secret,
    );
    assert.equal(infrastructure.cloudInstance?.subscription, null);
    assert.equal(infrastructure.provisioningJobs.length, 0);
    assert.equal(infrastructure.healthChecks.length, 1);
    assert.deepEqual(
      infrastructure.secureDeliveryEvents.map((event) => ({
        status: event.status,
        resultCode: event.resultCode,
      })),
      [
        {
          status: "PENDING",
          resultCode: "waiting_admin_delivery_approval",
        },
      ],
    );
  } finally {
    if (previousCredentialKey === undefined) {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    } else {
      process.env.CREDENTIAL_ENCRYPTION_KEY = previousCredentialKey;
    }
    await cleanupMobile(mobile);
    await cleanupMobile(adminMobile);
  }
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

  await payOrderWithWallet(user.id, order.id, {
    providerAdapter: createParsPackPricingAdapter(),
  });
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

  await assert.rejects(
    () =>
      payOrderWithWallet(user.id, order.id, {
        providerAdapter: createParsPackPricingAdapter(),
      }),
    /اعتبار قیمت/,
  );
  const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
  assert.equal(walletAfter.availableBalance, walletBefore.availableBalance);
  assert.equal(
    await prisma.walletLedgerEntry.count({ where: { referenceId: order.id } }),
    0,
  );

  await cleanupMobile(mobile);
});

test("first Admin approval is idempotent and never provisions automatically", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }

  const mobile = "09128881003";
  const adminMobile = "09128881004";
  await cleanupMobile(mobile);
  await cleanupMobile(adminMobile);

  const { user, order } = await createManualOrderFixture(mobile);
  const paid = await payOrderWithWallet(user.id, order.id);
  const admin = await prisma.user.create({ data: { mobile: adminMobile, role: "ADMIN" } });
  const infraId = paid.infrastructureOrder!.id;

  const first = await approveProvision({
    infrastructureOrderId: infraId,
    adminUserId: admin.id,
    reason: "تأیید اول ادمین در تست",
    providerBalanceConfirmed: true,
    idempotencyKey: `test-approval-${infraId}`,
  });
  const duplicate = await approveProvision({
    infrastructureOrderId: infraId,
    adminUserId: admin.id,
    reason: "تأیید اول ادمین در تست",
    providerBalanceConfirmed: true,
    idempotencyKey: `test-approval-${infraId}`,
  });
  assert.deepEqual(duplicate, first);
  assert.equal(first.approved, true);
  assert.equal(
    (
      await prisma.infrastructureOrder.findUniqueOrThrow({
        where: { id: infraId },
      })
    ).status,
    InfrastructureOrderStatus.FUNDING_CONFIRMED,
  );
  assert.equal(
    await prisma.adminCommandReceipt.count({
      where: {
        infrastructureOrderId: infraId,
        operation: "APPROVE_PROVISION",
      },
    }),
    1,
  );
  assert.equal(
    await prisma.providerFundingConfirmation.count({
      where: { infrastructureOrderId: infraId },
    }),
    0,
  );
  assert.equal(
    await prisma.provisioningJob.count({
      where: { infrastructureOrderId: infraId },
    }),
    0,
  );

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
  await payOrderWithWallet(user.id, order.id, {
    providerAdapter: createParsPackPricingAdapter(),
  });
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
  await refundOrder({
    orderId: order.id,
    actorUserId: admin.id,
    reason: "تست بازگشت",
    idempotencyKey: "infrastructure-refund-test-0001",
  });

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
  await payOrderWithWallet(user.id, order.id, {
    providerAdapter: createParsPackPricingAdapter(),
  });
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
        idempotencyKey: "infrastructure-retry-test-0001",
      }),
    /تطبیق|وضعیت فعلی سفارش مجاز نیست/,
  );

  await cleanupMobile(mobile);
  await cleanupMobile(adminMobile);
});
