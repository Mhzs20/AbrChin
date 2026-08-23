import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  InfrastructureProvider,
  PrismaClient,
  RecommendationFlowStatus,
  RecommendationQuoteRole,
  RecommendationQuoteStatus,
  ServiceOrderStatus,
  WalletStatus,
} from "@prisma/client";

import { FakeCloudProviderAdapter } from "../lib/infrastructure/fake-cloud-provider-adapter.ts";
import {
  expireDueLockedQuotes,
  expireLockedQuoteContract,
} from "../lib/orders/quote-expiration.ts";
import {
  createServiceOrderFromQuote,
  payOrderWithWallet,
} from "../lib/orders/service.ts";
import { getActivePlanByCode, toPlanSnapshot } from "../lib/orders/plans.ts";
import { RECOMMENDATION_QUOTE_VALIDITY_MS } from "../lib/recommendation/quote-service.ts";
import { tomanToRial } from "../lib/money.ts";
import { decimalToScaledInteger } from "../lib/pricing/provider-pricing.ts";
import { WalletError } from "../lib/wallet/errors.ts";

const databaseUrl = process.env.DATABASE_URL;
const prisma = databaseUrl ? new PrismaClient() : null;
const previousArvanPublicSale = process.env.ARVAN_PUBLIC_SALE_ENABLED;
const previousArvanReadySale = process.env.ARVAN_READY_PUBLIC_SALE_ENABLED;
const previousArvanMutations = process.env.ARVAN_MUTATIONS_ENABLED;
process.env.ARVAN_PUBLIC_SALE_ENABLED = "true";
process.env.ARVAN_READY_PUBLIC_SALE_ENABLED = "true";
process.env.ARVAN_MUTATIONS_ENABLED = "true";

after(async () => {
  if (previousArvanPublicSale === undefined) {
    delete process.env.ARVAN_PUBLIC_SALE_ENABLED;
  } else {
    process.env.ARVAN_PUBLIC_SALE_ENABLED = previousArvanPublicSale;
  }
  if (previousArvanReadySale === undefined) {
    delete process.env.ARVAN_READY_PUBLIC_SALE_ENABLED;
  } else {
    process.env.ARVAN_READY_PUBLIC_SALE_ENABLED = previousArvanReadySale;
  }
  if (previousArvanMutations === undefined) {
    delete process.env.ARVAN_MUTATIONS_ENABLED;
  } else {
    process.env.ARVAN_MUTATIONS_ENABLED = previousArvanMutations;
  }
  if (prisma) await prisma.$disconnect();
});

function createArvanPricingAdapter(monthlyPriceIrr = 1_200_000n) {
  return new FakeCloudProviderAdapter({
    provider: InfrastructureProvider.ARVAN,
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
          priceMonthlyIrr: monthlyPriceIrr,
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

function createUnavailableAdapter() {
  return new FakeCloudProviderAdapter({
    provider: InfrastructureProvider.ARVAN,
    plansByRegion: { tehran11: [] },
    imagesByRegion: { tehran11: [] },
  });
}

async function cleanupMobile(mobile: string) {
  if (!prisma) return;
  const user = await prisma.user.findUnique({ where: { mobile } });
  if (!user) return;
  await prisma.providerOperationLog.deleteMany({
    where: { infrastructureOrder: { userId: user.id } },
  });
  await prisma.provisioningJob.deleteMany({
    where: { infrastructureOrder: { userId: user.id } },
  });
  await prisma.cloudInstance.deleteMany({ where: { userId: user.id } });
  await prisma.adminNotification.deleteMany({
    where: { infrastructureOrder: { userId: user.id } },
  });
  await prisma.providerFundingConfirmation.deleteMany({
    where: { infrastructureOrder: { userId: user.id } },
  });
  await prisma.infrastructureOrder.deleteMany({ where: { userId: user.id } });
  await prisma.serviceOrder.deleteMany({ where: { userId: user.id } });
  await prisma.walletLedgerEntry.deleteMany({
    where: { wallet: { userId: user.id } },
  });
  await prisma.wallet.deleteMany({ where: { userId: user.id } });
  const sessions = await prisma.recommendationSession.findMany({
    where: { userId: user.id },
    select: { id: true },
  });
  if (sessions.length > 0) {
    await prisma.recommendationQuote.deleteMany({
      where: { sessionId: { in: sessions.map((s) => s.id) } },
    });
    await prisma.recommendationSession.deleteMany({
      where: { userId: user.id },
    });
  }
  await prisma.user.delete({ where: { id: user.id } });
}

async function seedDevPlan() {
  if (!prisma) return null;
  const syncedAt = new Date();
  await prisma.providerCatalogState.upsert({
    where: { provider: "ARVAN" },
    update: {
      lastCatalogSync: syncedAt,
      lastSyncStatus: "SUCCEEDED",
      freshnessSlaSeconds: 900,
    },
    create: {
      id: "arvan-v1",
      provider: "ARVAN",
      apiVersion: "v1",
      enabled: true,
      lastCatalogSync: syncedAt,
      lastSyncStatus: "SUCCEEDED",
      freshnessSlaSeconds: 900,
    },
  });
  await prisma.providerRegionConfig.upsert({
    where: {
      provider_apiVersion_regionCode: {
        provider: "ARVAN",
        apiVersion: "v1",
        regionCode: "tehran11",
      },
    },
    update: { saleEnabled: true, syncEnabled: true },
    create: {
      provider: "ARVAN",
      apiVersion: "v1",
      regionCode: "tehran11",
      displayName: "تهران ۱۱، ایران",
      saleEnabled: true,
      syncEnabled: true,
    },
  });
  const catalogItem = await prisma.providerCatalogItem.upsert({
    where: {
      provider_apiVersion_regionCode_externalPlanId: {
        provider: "ARVAN",
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
      providerMonthlyPriceIrr: 1_200_000n,
      lastSyncedAt: syncedAt,
    },
    create: {
      provider: "ARVAN",
      apiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      regionCode: "tehran11",
      sizeCode: "irLinuxVPS4",
      externalPlanId: "irLinuxVPS4",
      externalKey: "arvan:v1:tehran11:irLinuxVPS4",
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
      payloadHash: "locked-quote-test",
      catalogVersion: syncedAt.toISOString(),
    },
  });
  await prisma.providerPricingConfig.upsert({
    where: { provider: "ARVAN" },
    update: {
      apiVersion: "v1",
      enabled: true,
      markupBasisPoints: 2500,
      sourceMoneyUnit: "TOMAN",
    },
    create: {
      id: "arvan",
      provider: "ARVAN",
      apiVersion: "v1",
      enabled: true,
      markupBasisPoints: 2500,
      sourceMoneyUnit: "TOMAN",
    },
  });
  await prisma.productPricingConfig.upsert({
    where: {
      provider_apiVersion_productKind: {
        provider: "ARVAN",
        apiVersion: "v1",
        productKind: "READY_INSTANT_SERVER",
      },
    },
    update: { enabled: true, markupBasisPoints: 0 },
    create: {
      id: "locked-quote-arvan-ready",
      provider: "ARVAN",
      apiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      enabled: true,
      markupBasisPoints: 0,
    },
  });
  await prisma.commercePricingConfig.upsert({
    where: { id: "default" },
    update: { taxBps: 1000 },
    create: { id: "default", taxBps: 1000 },
  });
  await prisma.parchinPricingConfig.upsert({
    where: { level: "PARCHIN_START" },
    update: { active: true, priceRial: 0n, title: "پرچین شروع", version: 1 },
    create: {
      level: "PARCHIN_START",
      active: true,
      priceRial: 0n,
      title: "پرچین شروع",
      version: 1,
      description: "test",
      includedServices: [],
      excludedServices: [],
    },
  });
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
      provider: "ARVAN",
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
      skuMarkupBasisPoints: null,
    },
    create: {
      code: "DEV_STARTER",
      title: "شروع توسعه",
      provider: "ARVAN",
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

async function createLockedQuoteFixture(mobile: string, opts?: {
  walletBalance?: bigint;
  createdAt?: Date;
  expiresAt?: Date;
}) {
  if (!prisma) throw new Error("no prisma");
  const plan = await seedDevPlan();
  assert.ok(plan);
  const pricedPlan = await getActivePlanByCode(plan.code);
  assert.ok(pricedPlan);
  const createdAt = opts?.createdAt ?? new Date();
  const expiresAt =
    opts?.expiresAt ??
    new Date(createdAt.getTime() + RECOMMENDATION_QUOTE_VALIDITY_MS);
  const user = await prisma.user.create({ data: { mobile } });
  await prisma.wallet.create({
    data: {
      userId: user.id,
      availableBalance: opts?.walletBalance ?? tomanToRial(2_000_000),
      status: WalletStatus.ACTIVE,
    },
  });
  const session = await prisma.recommendationSession.create({
    data: {
      userId: user.id,
      status: RecommendationFlowStatus.QUOTED,
      answers: { source: "LOCKED_QUOTE_TEST" },
      answerSources: {},
      profile: { source: "CLOUD_SERVER", planId: plan.id },
      productFlowState: "QUOTED",
      productFlowRevision: 1,
      selectedParchinLevel: "PARCHIN_START",
      deliveryConfiguration: {
        provider: "ARVAN",
        providerApiVersion: "v1",
        productKind: "READY_INSTANT_SERVER",
        region: "tehran11",
        externalPlanId: "irLinuxVPS4",
        externalImageId: "ubuntu24-cloudinit-qcow2",
        externalNetworkId: null,
        externalSecurityId: null,
        accessMethod: "ONE_TIME_PASSWORD",
        planId: plan.id,
        configuredAt: createdAt.toISOString(),
      },
      expiresAt,
    },
  });
  const quote = await prisma.recommendationQuote.create({
    data: {
      sessionId: session.id,
      planId: plan.id,
      role: RecommendationQuoteRole.RECOMMENDED,
      status: RecommendationQuoteStatus.ACTIVE,
      score: 100,
      scoreBreakdown: { test: true },
      reasons: ["locked quote fixture"],
      profileSnapshot: { source: "CLOUD_SERVER", planId: plan.id },
      planSnapshot: toPlanSnapshot(pricedPlan, { createdAt, expiresAt }),
      amountRial: pricedPlan.pricing.finalPriceRial,
      renewalAmountRial: pricedPlan.pricing.renewalPriceRial,
      termMonths: 1,
      termDiscountBps: 0,
      catalogItemId: pricedPlan.pricing.catalogItemId,
      providerBasePriceRialSnapshot: pricedPlan.pricing.providerBasePriceRial,
      markupBasisPointsSnapshot: pricedPlan.pricing.markupBasisPoints,
      finalPriceRialSnapshot: pricedPlan.pricing.finalPriceRial,
      currencySnapshot: "IRR",
      providerPriceCheckedAt: createdAt,
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      providerRegion: "tehran11",
      externalPlanId: "irLinuxVPS4",
      externalImageId: "ubuntu24-cloudinit-qcow2",
      externalNetworkId: null,
      externalSecurityId: null,
      providerMonthlyPriceIrr: pricedPlan.pricing.providerBasePriceRial,
      markupAmountIrr: pricedPlan.pricing.markupAmountRial,
      parchinLevel: "PARCHIN_START",
      parchinPriceIrr: pricedPlan.pricing.parchinPriceRial,
      taxBasisPointsSnapshot: pricedPlan.pricing.taxBasisPoints,
      taxAmountIrr: pricedPlan.pricing.taxAmountRial,
      quotedAt: createdAt,
      expiresAt,
    },
  });
  return { user, plan, pricedPlan, session, quote, lockedAmount: quote.amountRial };
}

test("quote TTL is exactly 60 minutes", async () => {
  assert.equal(RECOMMENDATION_QUOTE_VALIDITY_MS, 60 * 60 * 1000);
});

test("locked quote survives provider/markup/tax/coupon commercial changes within TTL", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }
  const mobile = "09128882001";
  await cleanupMobile(mobile);
  const { user, plan, quote, lockedAmount } = await createLockedQuoteFixture(mobile);

  await prisma.providerCatalogItem.update({
    where: { id: quote.catalogItemId! },
    data: { providerMonthlyPriceIrr: 9_999_000n },
  });
  await prisma.providerPricingConfig.update({
    where: { provider: "ARVAN" },
    data: { markupBasisPoints: 9_000 },
  });
  await prisma.productPricingConfig.update({
    where: {
      provider_apiVersion_productKind: {
        provider: "ARVAN",
        apiVersion: "v1",
        productKind: "READY_INSTANT_SERVER",
      },
    },
    data: { markupBasisPoints: 4_000 },
  });
  await prisma.infrastructurePlan.update({
    where: { id: plan.id },
    data: { skuMarkupBasisPoints: 5_000 },
  });
  await prisma.commercePricingConfig.update({
    where: { id: "default" },
    data: { taxBps: 2000 },
  });
  await prisma.parchinPricingConfig.update({
    where: { level: "PARCHIN_START" },
    data: { priceRial: 500_000n },
  });

  const order = await createServiceOrderFromQuote(user.id, quote.id, {
    providerAdapter: createArvanPricingAdapter(),
  });
  assert.equal(order.amount, lockedAmount);
  assert.equal(order.quoteExpiresAt?.getTime(), quote.expiresAt.getTime());

  const paid = await payOrderWithWallet(user.id, order.id, {
    providerAdapter: createArvanPricingAdapter(9_999_000n),
  });
  assert.equal(paid.order.status, ServiceOrderStatus.PAID);
  const ledger = await prisma.walletLedgerEntry.findFirstOrThrow({
    where: { referenceId: order.id, direction: "DEBIT" },
  });
  assert.equal(ledger.amount, lockedAmount);

  await cleanupMobile(mobile);
});

test("wallet top-up within TTL keeps the same quote and does not extend expiresAt", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }
  const mobile = "09128882002";
  await cleanupMobile(mobile);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + RECOMMENDATION_QUOTE_VALIDITY_MS);
  const fixture = await createLockedQuoteFixture(mobile, {
    createdAt,
    expiresAt,
  });
  const { user, quote, lockedAmount } = fixture;
  await prisma.wallet.update({
    where: { userId: user.id },
    data: { availableBalance: lockedAmount / 2n },
  });

  const order = await createServiceOrderFromQuote(user.id, quote.id, {
    providerAdapter: createArvanPricingAdapter(),
  });
  const expiresBefore = (await prisma.recommendationQuote.findUniqueOrThrow({
    where: { id: quote.id },
  })).expiresAt;

  await prisma.wallet.update({
    where: { userId: user.id },
    data: { availableBalance: lockedAmount },
  });

  const expiresAfter = (await prisma.recommendationQuote.findUniqueOrThrow({
    where: { id: quote.id },
  })).expiresAt;
  assert.equal(expiresAfter.getTime(), expiresBefore.getTime());
  assert.equal(expiresAfter.getTime(), expiresAt.getTime());

  const paid = await payOrderWithWallet(user.id, order.id, {
    providerAdapter: createArvanPricingAdapter(),
  });
  assert.equal(paid.order.status, ServiceOrderStatus.PAID);
  assert.equal(paid.order.amount, lockedAmount);

  await cleanupMobile(mobile);
});

test("payment at expiresAt+1ms fails and does not debit", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }
  const mobile = "09128882003";
  await cleanupMobile(mobile);
  const createdAt = new Date(Date.now() - RECOMMENDATION_QUOTE_VALIDITY_MS - 1);
  const expiresAt = new Date(createdAt.getTime() + RECOMMENDATION_QUOTE_VALIDITY_MS);
  assert.ok(expiresAt.getTime() < Date.now());

  await assert.rejects(
    () =>
      createLockedQuoteFixture(mobile, { createdAt, expiresAt }).then(
        ({ user, quote }) =>
          createServiceOrderFromQuote(user.id, quote.id, {
            providerAdapter: createArvanPricingAdapter(),
          }),
      ),
    (error: unknown) =>
      error instanceof WalletError && error.code === "quote_expired",
  );

  const wallet = await prisma.wallet.findFirst({
    where: { user: { mobile } },
  });
  assert.ok(wallet);
  const ledgerCount = await prisma.walletLedgerEntry.count({
    where: { walletId: wallet.id },
  });
  assert.equal(ledgerCount, 0);

  await cleanupMobile(mobile);
});

test("expired pending order is not debitable and expiration is idempotent", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }
  const mobile = "09128882004";
  await cleanupMobile(mobile);
  const { user, quote, lockedAmount } = await createLockedQuoteFixture(mobile);
  const order = await createServiceOrderFromQuote(user.id, quote.id, {
    providerAdapter: createArvanPricingAdapter(),
  });
  const past = new Date(Date.now() - 1_000);
  await prisma.recommendationQuote.update({
    where: { id: quote.id },
    data: { expiresAt: past },
  });
  await prisma.serviceOrder.update({
    where: { id: order.id },
    data: { quoteExpiresAt: past },
  });
  await prisma.recommendationSession.update({
    where: { id: quote.sessionId },
    data: { expiresAt: past },
  });

  const walletBefore = await prisma.wallet.findUniqueOrThrow({
    where: { userId: user.id },
  });
  await assert.rejects(
    () =>
      payOrderWithWallet(user.id, order.id, {
        providerAdapter: createArvanPricingAdapter(),
      }),
    (error: unknown) =>
      error instanceof WalletError && error.code === "quote_expired",
  );
  const first = await expireLockedQuoteContract({ quoteId: quote.id });
  const second = await expireLockedQuoteContract({ quoteId: quote.id });
  assert.equal(first.expired, true);
  assert.equal(second.expired, true);

  const walletAfter = await prisma.wallet.findUniqueOrThrow({
    where: { userId: user.id },
  });
  assert.equal(walletAfter.availableBalance, walletBefore.availableBalance);
  assert.equal(
    await prisma.walletLedgerEntry.count({ where: { referenceId: order.id } }),
    0,
  );
  const refreshed = await prisma.recommendationQuote.findUniqueOrThrow({
    where: { id: quote.id },
  });
  assert.equal(refreshed.status, RecommendationQuoteStatus.EXPIRED);
  assert.equal(refreshed.amountRial, lockedAmount);

  await cleanupMobile(mobile);
});

test("retry payment after success does not double-debit", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }
  const mobile = "09128882005";
  await cleanupMobile(mobile);
  const { user, quote, lockedAmount } = await createLockedQuoteFixture(mobile);
  const order = await createServiceOrderFromQuote(user.id, quote.id, {
    providerAdapter: createArvanPricingAdapter(),
  });
  const first = await payOrderWithWallet(user.id, order.id, {
    providerAdapter: createArvanPricingAdapter(),
  });
  const second = await payOrderWithWallet(user.id, order.id, {
    providerAdapter: createArvanPricingAdapter(),
  });
  assert.equal(first.order.status, ServiceOrderStatus.PAID);
  assert.equal(second.order.status, ServiceOrderStatus.PAID);
  assert.equal(
    await prisma.walletLedgerEntry.count({
      where: { referenceId: order.id, direction: "DEBIT" },
    }),
    1,
  );
  const debit = await prisma.walletLedgerEntry.findFirstOrThrow({
    where: { referenceId: order.id, direction: "DEBIT" },
  });
  assert.equal(debit.amount, lockedAmount);

  await cleanupMobile(mobile);
});

test("provider unavailable before debit leaves wallet untouched", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }
  const mobile = "09128882006";
  await cleanupMobile(mobile);
  const { user, quote } = await createLockedQuoteFixture(mobile);
  const order = await createServiceOrderFromQuote(user.id, quote.id, {
    providerAdapter: createArvanPricingAdapter(),
  });
  const walletBefore = await prisma.wallet.findUniqueOrThrow({
    where: { userId: user.id },
  });

  await assert.rejects(
    () =>
      payOrderWithWallet(user.id, order.id, {
        providerAdapter: createUnavailableAdapter(),
      }),
    (error: unknown) =>
      error instanceof WalletError && error.code === "quote_unavailable",
  );

  const walletAfter = await prisma.wallet.findUniqueOrThrow({
    where: { userId: user.id },
  });
  assert.equal(walletAfter.availableBalance, walletBefore.availableBalance);
  assert.equal(
    await prisma.walletLedgerEntry.count({ where: { referenceId: order.id } }),
    0,
  );

  await cleanupMobile(mobile);
});

test("provider price changed with healthy availability pays locked customer price", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }
  const mobile = "09128882007";
  await cleanupMobile(mobile);
  const { user, quote, lockedAmount } = await createLockedQuoteFixture(mobile);
  const order = await createServiceOrderFromQuote(user.id, quote.id, {
    providerAdapter: createArvanPricingAdapter(),
  });

  await prisma.providerCatalogItem.update({
    where: { id: quote.catalogItemId! },
    data: { providerMonthlyPriceIrr: 2_400_000n },
  });

  const paid = await payOrderWithWallet(user.id, order.id, {
    providerAdapter: createArvanPricingAdapter(2_400_000n),
  });
  assert.equal(paid.order.status, ServiceOrderStatus.PAID);
  const debit = await prisma.walletLedgerEntry.findFirstOrThrow({
    where: { referenceId: order.id, direction: "DEBIT" },
  });
  assert.equal(debit.amount, lockedAmount);
  assert.notEqual(debit.amount, 2_400_000n);

  await cleanupMobile(mobile);
});

test("expiration sweep releases payable state without deleting history", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }
  const mobile = "09128882008";
  await cleanupMobile(mobile);
  const { user, quote, lockedAmount } = await createLockedQuoteFixture(mobile);
  const order = await createServiceOrderFromQuote(user.id, quote.id, {
    providerAdapter: createArvanPricingAdapter(),
  });
  const past = new Date(Date.now() - 5_000);
  await prisma.recommendationQuote.update({
    where: { id: quote.id },
    data: { expiresAt: past },
  });
  await prisma.serviceOrder.update({
    where: { id: order.id },
    data: { quoteExpiresAt: past },
  });

  const swept = await expireDueLockedQuotes(new Date());
  assert.ok(swept >= 1);

  const refreshedQuote = await prisma.recommendationQuote.findUniqueOrThrow({
    where: { id: quote.id },
  });
  const refreshedOrder = await prisma.serviceOrder.findUniqueOrThrow({
    where: { id: order.id },
  });
  assert.equal(refreshedQuote.status, RecommendationQuoteStatus.EXPIRED);
  assert.equal(refreshedQuote.amountRial, lockedAmount);
  assert.equal(refreshedOrder.amount, lockedAmount);
  assert.equal(refreshedOrder.productFlowState, "QUOTE_EXPIRED");

  await assert.rejects(
    () =>
      payOrderWithWallet(user.id, order.id, {
        providerAdapter: createArvanPricingAdapter(),
      }),
    (error: unknown) =>
      error instanceof WalletError &&
      (error.code === "quote_expired" ||
        error.code === "quote_refresh_required" ||
        error.code === "invalid_quote_status"),
  );

  await cleanupMobile(mobile);
});
