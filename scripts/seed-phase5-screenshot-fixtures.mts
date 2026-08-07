/**
 * Seed live UI fixtures for Phase 5 purchase-experience screenshots.
 * Attaches quotes / active service / upgrade quote to ADMIN_MOBILES user.
 *
 * Usage: set -a; . ./.env; set +a; npx tsx scripts/seed-phase5-screenshot-fixtures.mts
 */
import {
  CloudInstanceStatus,
  DeliveryMode,
  InfrastructureOrderStatus,
  PrismaClient,
  RecommendationFlowStatus,
  RecommendationQuoteRole,
  RecommendationQuoteStatus,
  ServiceOrderStatus,
  SubscriptionStatus,
  WalletStatus,
} from "@prisma/client";

import { createUpgradeQuote } from "../lib/orders/upgrade-quote.ts";
import { getActivePlanByCode, toPlanSnapshot } from "../lib/orders/plans.ts";
import { RECOMMENDATION_QUOTE_VALIDITY_MS } from "../lib/recommendation/quote-service.ts";
import { createUserSession } from "../lib/session.ts";
import { tomanToRial } from "../lib/money.ts";
import { decimalToScaledInteger } from "../lib/pricing/provider-pricing.ts";

/** Customer mobile (not in ADMIN_MOBILES) so /account pages are reachable. */
const MOBILE = "09121111111";
const prisma = new PrismaClient();

async function ensurePricing() {
  const syncedAt = new Date();

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
      providerMonthlyPriceIrr: 1_200_000n,
      lastSyncedAt: syncedAt,
      vcpu: 2,
      ramMb: 4096,
      diskGb: 50,
      status: "ACTIVE",
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
      payloadHash: "phase5-screenshot",
      catalogVersion: syncedAt.toISOString(),
    },
  });

  const catalogPlus = await prisma.providerCatalogItem.upsert({
    where: {
      provider_apiVersion_regionCode_externalPlanId: {
        provider: "PARSPACK",
        apiVersion: "v1",
        regionCode: "tehran11",
        externalPlanId: "irLinuxVPS8",
      },
    },
    update: {
      compatibleImageCodes: ["ubuntu24-cloudinit-qcow2"],
      available: true,
      active: true,
      priceMonthlyAmount: decimalToScaledInteger("240000"),
      priceScale: 6,
      currencyCode: "IRR",
      amountUnit: "TOMAN",
      providerMonthlyPriceIrr: 2_400_000n,
      lastSyncedAt: syncedAt,
      vcpu: 4,
      ramMb: 8192,
      diskGb: 100,
      status: "ACTIVE",
    },
    create: {
      provider: "PARSPACK",
      apiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      regionCode: "tehran11",
      sizeCode: "irLinuxVPS8",
      externalPlanId: "irLinuxVPS8",
      externalKey: "parspack:v1:tehran11:irLinuxVPS8",
      sizeName: "Development Plus",
      compatibleImageCodes: ["ubuntu24-cloudinit-qcow2"],
      vcpu: 4,
      ramMb: 8192,
      diskGb: 100,
      available: true,
      active: true,
      status: "ACTIVE",
      priceMonthlyAmount: decimalToScaledInteger("240000"),
      priceScale: 6,
      currencyCode: "IRR",
      amountUnit: "TOMAN",
      providerMonthlyPriceIrr: 2_400_000n,
      lastSyncedAt: syncedAt,
      lastSeenAt: syncedAt,
      rawPayload: {},
      payloadHash: "phase5-screenshot-plus",
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
      id: "phase5-parspack-ready",
      provider: "PARSPACK",
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
      description: "screenshot",
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

  const starter = await prisma.infrastructurePlan.upsert({
    where: { code: "DEV_STARTER" },
    update: {
      provider: "PARSPACK",
      providerApiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      deliveryMode: DeliveryMode.MANAGED,
      salePriceRial: tomanToRial(150_000),
      estimatedProviderCostRial: tomanToRial(120_000),
      renewalPriceRial: tomanToRial(150_000),
      active: true,
      publicationStatus: "PUBLISHED",
      parchinIncluded: true,
      minimumParchinLevel: "PARCHIN_START",
      catalogItemId: catalogItem.id,
      catalogMappingStatus: "MAPPED",
      catalogMappedAt: syncedAt,
      regionCode: "tehran11",
      sizeCode: "irLinuxVPS4",
      imageCode: "ubuntu24-cloudinit-qcow2",
      vcpu: 2,
      ramGb: 4,
      storageGb: 50,
      billingModel: "PREPAID_TERM",
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
      deliveryMode: DeliveryMode.MANAGED,
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
      billingModel: "PREPAID_TERM",
    },
  });

  const plus = await prisma.infrastructurePlan.upsert({
    where: { code: "DEV_STARTER_PLUS" },
    update: {
      provider: "PARSPACK",
      providerApiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      deliveryMode: DeliveryMode.MANAGED,
      salePriceRial: tomanToRial(300_000),
      estimatedProviderCostRial: tomanToRial(240_000),
      renewalPriceRial: tomanToRial(300_000),
      active: true,
      publicationStatus: "PUBLISHED",
      parchinIncluded: true,
      minimumParchinLevel: "PARCHIN_START",
      catalogItemId: catalogPlus.id,
      catalogMappingStatus: "MAPPED",
      catalogMappedAt: syncedAt,
      regionCode: "tehran11",
      sizeCode: "irLinuxVPS8",
      imageCode: "ubuntu24-cloudinit-qcow2",
      vcpu: 4,
      ramGb: 8,
      storageGb: 100,
      billingModel: "PREPAID_TERM",
    },
    create: {
      code: "DEV_STARTER_PLUS",
      title: "توسعه پیشرفته",
      provider: "PARSPACK",
      regionCode: "tehran11",
      sizeCode: "irLinuxVPS8",
      imageCode: "ubuntu24-cloudinit-qcow2",
      providerApiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      deliveryMode: DeliveryMode.MANAGED,
      salePriceRial: tomanToRial(300_000),
      estimatedProviderCostRial: tomanToRial(240_000),
      renewalPriceRial: tomanToRial(300_000),
      vcpu: 4,
      ramGb: 8,
      storageGb: 100,
      catalogItemId: catalogPlus.id,
      catalogMappingStatus: "MAPPED",
      catalogMappedAt: syncedAt,
      parchinIncluded: true,
      minimumParchinLevel: "PARCHIN_START",
      active: true,
      publicationStatus: "PUBLISHED",
      sortOrder: 2,
      billingModel: "PREPAID_TERM",
    },
  });

  await prisma.storefrontAssortmentSettings.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  });

  await prisma.storefrontAssortmentSlot.upsert({
    where: {
      tier_catalogItemId: {
        tier: "NO",
        catalogItemId: catalogItem.id,
      },
    },
    update: { enabled: true, role: "PRIMARY", sortOrder: 1 },
    create: {
      tier: "NO",
      role: "PRIMARY",
      sortOrder: 1,
      catalogItemId: catalogItem.id,
      enabled: true,
    },
  });

  await prisma.providerCatalogAsset.upsert({
    where: {
      provider_apiVersion_regionCode_kind_externalId: {
        provider: "PARSPACK",
        apiVersion: "v1",
        regionCode: "tehran11",
        kind: "IMAGE",
        externalId: "ubuntu24-cloudinit-qcow2",
      },
    },
    update: {
      name: "Ubuntu 24.04 LTS",
      status: "ACTIVE",
      available: true,
      isDefault: true,
      lastSeenAt: syncedAt,
      lastSyncedAt: syncedAt,
      rawPayload: {
        name: "Ubuntu 24.04 LTS",
        distribution: "ubuntu",
        version: "24.04",
        ssh_password: true,
        ssh_key: false,
      },
      payloadHash: "phase5-ubuntu24",
    },
    create: {
      provider: "PARSPACK",
      apiVersion: "v1",
      regionCode: "tehran11",
      kind: "IMAGE",
      externalId: "ubuntu24-cloudinit-qcow2",
      name: "Ubuntu 24.04 LTS",
      status: "ACTIVE",
      available: true,
      isDefault: true,
      lastSeenAt: syncedAt,
      lastSyncedAt: syncedAt,
      rawPayload: {
        name: "Ubuntu 24.04 LTS",
        distribution: "ubuntu",
        version: "24.04",
        ssh_password: true,
        ssh_key: false,
      },
      payloadHash: "phase5-ubuntu24",
    },
  });

  return { starter, plus, catalogItem };
}

async function createQuoteForUser(
  userId: string,
  planCode: string,
  opts: {
    createdAt: Date;
    expiresAt: Date;
    status?: RecommendationQuoteStatus;
    label: string;
    sessionExpiresAt?: Date;
  },
) {
  const pricedPlan = await getActivePlanByCode(planCode);
  if (!pricedPlan) throw new Error(`plan ${planCode} missing`);
  const session = await prisma.recommendationSession.create({
    data: {
      userId,
      status: RecommendationFlowStatus.QUOTED,
      answers: { source: "PHASE5_SCREENSHOT", label: opts.label },
      answerSources: {},
      profile: { source: "CLOUD_SERVER", planId: pricedPlan.id },
      productFlowState: "QUOTED",
      productFlowRevision: 1,
      selectedParchinLevel: "PARCHIN_START",
      deliveryConfiguration: {
        provider: "PARSPACK",
        providerApiVersion: "v1",
        productKind: "READY_INSTANT_SERVER",
        region: "tehran11",
        regionLabel: "تهران",
        externalPlanId: pricedPlan.sizeCode,
        externalImageId: pricedPlan.imageCode,
        operatingSystem: "Ubuntu 24.04 LTS",
        serverName: `abrchin-${opts.label}`,
        accessMethod: "ONE_TIME_PASSWORD",
        planId: pricedPlan.id,
        configuredAt: opts.createdAt.toISOString(),
      },
      expiresAt: opts.sessionExpiresAt ?? opts.expiresAt,
    },
  });

  const quote = await prisma.recommendationQuote.create({
    data: {
      sessionId: session.id,
      planId: pricedPlan.id,
      role: RecommendationQuoteRole.RECOMMENDED,
      status: opts.status ?? RecommendationQuoteStatus.ACTIVE,
      score: 100,
      scoreBreakdown: { screenshot: true },
      reasons: ["phase5 screenshot fixture"],
      profileSnapshot: { source: "CLOUD_SERVER", planId: pricedPlan.id },
      planSnapshot: toPlanSnapshot(pricedPlan, {
        createdAt: opts.createdAt,
        expiresAt: opts.expiresAt,
      }),
      amountRial: pricedPlan.pricing.finalPriceRial,
      renewalAmountRial: pricedPlan.pricing.renewalPriceRial,
      termMonths: 1,
      termDiscountBps: 0,
      catalogItemId: pricedPlan.pricing.catalogItemId,
      providerBasePriceRialSnapshot: pricedPlan.pricing.providerBasePriceRial,
      markupBasisPointsSnapshot: pricedPlan.pricing.markupBasisPoints,
      finalPriceRialSnapshot: pricedPlan.pricing.finalPriceRial,
      currencySnapshot: "IRR",
      providerPriceCheckedAt: opts.createdAt,
      provider: "PARSPACK",
      providerApiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      providerRegion: "tehran11",
      externalPlanId: pricedPlan.sizeCode,
      externalImageId: pricedPlan.imageCode,
      externalNetworkId: null,
      externalSecurityId: null,
      providerMonthlyPriceIrr: pricedPlan.pricing.providerBasePriceRial,
      markupAmountIrr: pricedPlan.pricing.markupAmountRial,
      parchinLevel: "PARCHIN_START",
      parchinPriceIrr: pricedPlan.pricing.parchinPriceRial,
      taxBasisPointsSnapshot: pricedPlan.pricing.taxBasisPoints,
      taxAmountIrr: pricedPlan.pricing.taxAmountRial,
      quotedAt: opts.createdAt,
      expiresAt: opts.expiresAt,
      deliveryConfigurationSnapshot: {
        provider: "PARSPACK",
        region: "tehran11",
        regionLabel: "تهران",
        operatingSystem: "Ubuntu 24.04 LTS",
        serverName: `abrchin-${opts.label}`,
        accessMethod: "ONE_TIME_PASSWORD",
        vcpu: pricedPlan.vcpu,
        ramGb: pricedPlan.ramGb,
        diskGb: pricedPlan.storageGb,
      },
    },
  });

  return { session, quote, amountRial: quote.amountRial, pricedPlan };
}

async function createActivePrepaidService(
  userId: string,
  planId: string,
  amountRial: bigint,
) {
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const paidAt = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

  const order = await prisma.serviceOrder.create({
    data: {
      userId,
      title: "سرور فعال — فیکسچر اسکرین‌شات",
      description: "phase5 screenshot active service",
      amount: amountRial,
      termMonths: 1,
      status: ServiceOrderStatus.PAID,
      planId,
      planCode: "DEV_STARTER",
      paidAt,
      productFlowState: "ACTIVE",
      provider: "PARSPACK",
      providerApiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      parchinLevel: "PARCHIN_START",
    },
  });

  const infra = await prisma.infrastructureOrder.create({
    data: {
      serviceOrderId: order.id,
      userId,
      planId,
      provider: "PARSPACK",
      providerApiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      parchinLevel: "PARCHIN_START",
      deliveryMode: DeliveryMode.MANAGED,
      status: InfrastructureOrderStatus.ACTIVE,
      requiredFundingRial: amountRial,
      desiredInstanceName: `abrchin-phase5-${Date.now()}`,
      productFlowState: "ACTIVE",
    },
  });

  const instance = await prisma.cloudInstance.create({
    data: {
      infrastructureOrderId: infra.id,
      userId,
      provider: "PARSPACK",
      providerApiVersion: "v1",
      providerInstanceId: `phase5-shot-${Date.now()}`,
      name: "abrchin-phase5-active",
      region: "tehran11",
      size: "irLinuxVPS4",
      image: "ubuntu24-cloudinit-qcow2",
      deliveryMode: DeliveryMode.MANAGED,
      ipv4: "203.0.113.42",
      providerState: "active",
      providerObservedAt: paidAt,
      status: CloudInstanceStatus.ACTIVE,
      provisionedAt: paidAt,
      deliveredAt: paidAt,
      healthCheckedAt: now,
    },
  });

  await prisma.serviceSubscription.create({
    data: {
      cloudInstanceId: instance.id,
      sourceOrderId: order.id,
      userId,
      planId,
      status: SubscriptionStatus.ACTIVE,
      parchinLevel: "PARCHIN_START",
      renewalPriceRial: amountRial,
      currentPeriodStart: paidAt,
      currentPeriodEnd: periodEnd,
      nextRenewalAt: periodEnd,
      graceEndsAt: new Date(periodEnd.getTime() + 3 * 24 * 60 * 60 * 1000),
      termMonths: 1,
      autoRenew: false,
    },
  });

  return { order, infra, instance };
}

async function main() {
  process.env.PARSPACK_PUBLIC_SALE_ENABLED = "true";

  const user = await prisma.user.upsert({
    where: { mobile: MOBILE },
    update: {
      role: "CUSTOMER",
      accountStatus: "ACTIVE",
      mobileVerifiedAt: new Date(),
    },
    create: {
      mobile: MOBILE,
      role: "CUSTOMER",
      accountStatus: "ACTIVE",
      mobileVerifiedAt: new Date(),
      displayName: "مشتری اسکرین‌شات",
    },
  });

  const { starter, plus } = await ensurePricing();

  const now = new Date();
  const activeExpires = new Date(
    now.getTime() + RECOMMENDATION_QUOTE_VALIDITY_MS,
  );
  const expiredCreated = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const expiredAt = new Date(now.getTime() - 30 * 60 * 1000);

  const sufficient = await createQuoteForUser(user.id, "DEV_STARTER", {
    createdAt: now,
    expiresAt: activeExpires,
    label: "sufficient",
  });
  const insufficient = await createQuoteForUser(user.id, "DEV_STARTER_PLUS", {
    createdAt: now,
    expiresAt: activeExpires,
    label: "insufficient",
  });
  const expired = await createQuoteForUser(user.id, "DEV_STARTER", {
    createdAt: expiredCreated,
    expiresAt: expiredAt,
    status: RecommendationQuoteStatus.EXPIRED,
    label: "expired",
    // Session must stay alive so getOwnedRecommendationQuote can render expiry UI.
    sessionExpiresAt: activeExpires,
  });

  const walletBalance = sufficient.amountRial;
  await prisma.wallet.upsert({
    where: { userId: user.id },
    update: { availableBalance: walletBalance, status: WalletStatus.ACTIVE },
    create: {
      userId: user.id,
      availableBalance: walletBalance,
      status: WalletStatus.ACTIVE,
    },
  });

  const active = await createActivePrepaidService(
    user.id,
    starter.id,
    sufficient.amountRial,
  );

  const upgrade = await createUpgradeQuote({
    instanceId: active.instance.id,
    userId: user.id,
    targetPlanId: plus.id,
  });

  const session = await createUserSession(user.id, {
    ip: "127.0.0.1",
    userAgent: "phase5-screenshot",
  });

  const out = {
    mobile: MOBILE,
    userId: user.id,
    sessionToken: session.token,
    cookie: `abrchin_session=${session.token}`,
    walletBalanceRial: walletBalance.toString(),
    starterPlanId: starter.id,
    plusPlanId: plus.id,
    quotes: {
      sufficient: sufficient.quote.id,
      insufficient: insufficient.quote.id,
      expired: expired.quote.id,
      sufficientAmount: sufficient.amountRial.toString(),
      insufficientAmount: insufficient.amountRial.toString(),
    },
    urls: {
      configuration: `/cloud-servers?plan=${starter.id}`,
      checkoutSufficient: `/account/order/quote/${sufficient.quote.id}`,
      checkoutInsufficient: `/account/order/quote/${insufficient.quote.id}`,
      quoteExpired: `/account/order/quote/${expired.quote.id}`,
      cancel: `/account/orders/${active.order.id}#cancel-service`,
      upgradeChooser: `/account/services/${active.instance.id}/upgrade`,
      upgradeQuote: `/account/upgrade/${upgrade.id}`,
    },
    active: {
      orderId: active.order.id,
      instanceId: active.instance.id,
    },
    upgradeQuoteId: upgrade.id,
  };

  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
