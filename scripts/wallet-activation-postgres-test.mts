import assert from "node:assert/strict";
import test from "node:test";

import {
  PrismaClient,
  RecommendationQuoteRole,
  RecommendationQuoteStatus,
  UserRole,
} from "@prisma/client";

import {
  approveActivation,
  getActivationEstimate,
  requestActivation,
} from "../lib/billing/activation.ts";
import { startInitialUsageBillingTx } from "../lib/billing/start.ts";
import { dispatchApprovedProvision } from "../lib/infrastructure/provision-dispatch.ts";
import { createServiceOrderFromQuote } from "../lib/orders/service.ts";
import { creditWallet } from "../lib/wallet/ledger.ts";

const databaseUrl = process.env.DATABASE_URL;
const db =
  process.env.ABRCHIN_ISOLATED_TEST === "1" && databaseUrl
    ? new PrismaClient()
    : null;

test("wallet top-up to estimate, activation and Admin approval stays mutation-free", async (t) => {
  if (!db) {
    t.skip("requires isolated PostgreSQL");
    return;
  }
  const suffix = Date.now().toString(36);
  process.env.ARVAN_PUBLIC_SALE_ENABLED = "true";
  process.env.ARVAN_CLOUD_PUBLIC_SALE_ENABLED = "true";
  process.env.ARVAN_MUTATIONS_ENABLED = "false";
  process.env.ARVAN_ENABLED = "false";

  const [customer, admin] = await Promise.all([
    db.user.create({
      data: { mobile: `0901${suffix.slice(-7).padStart(7, "0")}` },
    }),
    db.user.create({
      data: {
        mobile: `0902${suffix.slice(-7).padStart(7, "0")}`,
        role: UserRole.ADMIN,
      },
    }),
  ]);
  await creditWallet({
    userId: customer.id,
    amountRial: 1_000_000n,
    type: "TOP_UP",
    referenceType: "wallet_topup",
    referenceId: `topup-${suffix}`,
    idempotencyKey: `activation-topup-${suffix}`,
    description: "controlled test top-up",
  });
  const catalog = await db.providerCatalogItem.create({
    data: {
      provider: "ARVAN",
      apiVersion: "v1",
      productKind: "CLOUD_SERVER",
      regionCode: `ir-${suffix}`,
      sizeCode: `g2-${suffix}`,
      externalPlanId: `g2-${suffix}`,
      externalKey: `arvan:v1:${suffix}`,
      sizeName: "PAYG fixture",
      compatibleImageCodes: ["ubuntu-24"],
      vcpu: 2,
      ramMb: 4096,
      diskGb: 50,
      available: true,
      active: true,
      status: "ACTIVE",
      priceHourlyAmount: 10_000n,
      priceScale: 0,
      currencyCode: "IRR",
      amountUnit: "RIAL",
      providerHourlyPriceIrr: 10_000n,
      providerMonthlyPriceIrr: 7_300_000n,
      lastSyncedAt: new Date(),
    },
  });
  const policy = await db.billingPolicyVersion.create({
    data: {
      policyKey: `plan-${suffix}`,
      version: 1,
      scope: "GLOBAL",
      availability: "HOURLY_AND_DAILY",
      defaultCadence: "HOURLY",
      displayMode: "BOTH",
      hourlyMinimumCreditHours: 24,
      dailyMinimumCreditDays: 1,
      hourlyGracePeriods: 24,
      dailyGracePeriods: 3,
      lowBalanceThresholdPeriods: 3,
      calculationUnit: "SECOND",
      roundingPolicy: "EXACT",
      prorationSupported: true,
      stopStateComponentPolicy: {
        compute: "PROVIDER_POLICY",
        disk: "BILLABLE",
        ip: "BILLABLE",
      },
      enabledCadences: ["HOURLY", "DAILY"],
      effectiveFrom: new Date(Date.now() - 60_000),
      changeReason: "test policy",
    },
  });
  const plan = await db.infrastructurePlan.create({
    data: {
      code: `PAYG-${suffix}`,
      title: "PAYG test cloud",
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "CLOUD_SERVER",
      regionCode: catalog.regionCode,
      sizeCode: catalog.sizeCode,
      imageCode: "ubuntu-24",
      deliveryMode: "MANAGED",
      vcpu: 2,
      ramGb: 4,
      storageGb: 50,
      salePriceRial: 0n,
      estimatedProviderCostRial: 10_000n,
      parchinIncluded: true,
      minimumParchinLevel: "PARCHIN_START",
      active: true,
      publicationStatus: "PUBLISHED",
      offerSource: "API_CATALOG",
      billingModel: "PAYG_WALLET",
      billingPolicyVersionId: policy.id,
      catalogItemId: catalog.id,
      catalogMappingStatus: "MAPPED",
    },
  });
  const session = await db.recommendationSession.create({
    data: {
      userId: customer.id,
      status: "QUOTED",
      answers: {},
      answerSources: {},
      profile: { source: "DIRECT_CLOUD_CATALOG" },
      selectedParchinLevel: "PARCHIN_START",
      deliveryConfiguration: {
        imageAssetId: "ubuntu-24",
        accessMethod: "ONE_TIME_PASSWORD",
      },
      productFlowState: "QUOTED",
      productFlowRevision: 6,
      expiresAt: new Date(Date.now() + 600_000),
    },
  });
  const quote = await db.recommendationQuote.create({
    data: {
      sessionId: session.id,
      planId: plan.id,
      role: RecommendationQuoteRole.RECOMMENDED,
      status: RecommendationQuoteStatus.ACTIVE,
      score: 100,
      scoreBreakdown: {},
      reasons: ["fixture"],
      profileSnapshot: {},
      planSnapshot: {
        title: plan.title,
        provider: "ARVAN",
        regionCode: plan.regionCode,
      },
      amountRial: 0n,
      renewalAmountRial: 0n,
      catalogItemId: catalog.id,
      providerBasePriceRialSnapshot: 7_300_000n,
      markupBasisPointsSnapshot: 2_500,
      finalPriceRialSnapshot: 0n,
      currencySnapshot: "IRR",
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "CLOUD_SERVER",
      providerRegion: plan.regionCode,
      externalPlanId: catalog.externalPlanId,
      externalImageId: "ubuntu-24",
      externalNetworkId: "default-network",
      externalSecurityId: "default-security",
      providerHourlyPriceIrr: 10_000n,
      providerMonthlyPriceIrr: 7_300_000n,
      quotedAt: new Date(),
      expiresAt: new Date(Date.now() + 600_000),
    },
  });

  const estimate = await getActivationEstimate({
    quoteId: quote.id,
    userId: customer.id,
    cadence: "HOURLY",
  });
  assert.equal(estimate.hourlyEstimateRial, 12_500n);
  assert.equal(estimate.dailyEstimateRial, 300_000n);
  assert.equal(estimate.minimumCreditRequiredRial, 300_000n);

  const activation = await requestActivation({
    quoteId: quote.id,
    userId: customer.id,
    cadence: "HOURLY",
    idempotencyKey: `activation-request-${suffix}`,
  });
  assert.equal(activation.status, "WAITING_ADMIN_APPROVAL");
  assert.equal(
    await db.walletLedgerEntry.count({
      where: { wallet: { userId: customer.id }, direction: "DEBIT" },
    }),
    0,
  );
  assert.equal(
    await db.infrastructureOrder.count({ where: { userId: customer.id } }),
    0,
  );
  await assert.rejects(
    createServiceOrderFromQuote(customer.id, quote.id),
    /PAYG|Wallet/,
  );

  const approved = await approveActivation({
    activationRequestId: activation.id,
    adminUserId: admin.id,
    reason: "تأیید کنترل‌شده فعال‌سازی",
    idempotencyKey: `activation-approve-${suffix}`,
  });
  const replay = await approveActivation({
    activationRequestId: activation.id,
    adminUserId: admin.id,
    reason: "تأیید کنترل‌شده فعال‌سازی",
    idempotencyKey: `activation-approve-${suffix}`,
  });
  assert.deepEqual(replay, approved);
  assert.equal(approved.providerMutationExecuted, false);
  assert.equal(
    await db.provisioningJob.count({
      where: { infrastructureOrderId: approved.infrastructureOrderId },
    }),
    0,
  );
  assert.equal(
    await db.cloudInstance.count({
      where: { infrastructureOrderId: approved.infrastructureOrderId },
    }),
    0,
  );
  assert.deepEqual(
    await dispatchApprovedProvision(approved.infrastructureOrderId),
    { state: "MANUAL_FULFILLMENT_REQUIRED" },
  );
  assert.equal(
    await db.provisioningJob.count({
      where: { infrastructureOrderId: approved.infrastructureOrderId },
    }),
    0,
  );
  const confirmedAt = new Date();
  const instance = await db.cloudInstance.create({
    data: {
      infrastructureOrderId: approved.infrastructureOrderId,
      userId: customer.id,
      provider: "ARVAN",
      providerApiVersion: "v1",
      providerInstanceId: `provider-${suffix}`,
      name: `abrchin-${suffix}`,
      region: plan.regionCode,
      size: plan.sizeCode,
      image: plan.imageCode,
      deliveryMode: "MANAGED",
      ipv4: "192.0.2.10",
      providerState: "active",
      providerObservedAt: confirmedAt,
      status: "PENDING",
    },
  });
  const firstBilling = await db.$transaction((tx) =>
    startInitialUsageBillingTx(tx, {
      cloudInstanceId: instance.id,
      providerConfirmedAt: confirmedAt,
      providerEventId: `provider-confirmed-${suffix}`,
    }),
  );
  const billingReplay = await db.$transaction((tx) =>
    startInitialUsageBillingTx(tx, {
      cloudInstanceId: instance.id,
      providerConfirmedAt: confirmedAt,
      providerEventId: `provider-confirmed-${suffix}`,
    }),
  );
  assert.equal(billingReplay?.id, firstBilling?.id);
  assert.equal(
    await db.resourceVersion.count({ where: { cloudInstanceId: instance.id } }),
    1,
  );
  assert.equal(
    await db.usageInterval.count({ where: { cloudInstanceId: instance.id } }),
    1,
  );
  assert.equal(
    (
      await db.activationRequest.findUniqueOrThrow({
        where: { id: activation.id },
      })
    ).status,
    "PROVIDER_CONFIRMED",
  );
  await db.$disconnect();
});
