/**
 * Minimal, deterministic fixture for the Phase 0 fail-closed browser smoke.
 *
 * This file intentionally imports no Next.js/application modules so it can be
 * executed directly against the isolated PostgreSQL-compatible test database.
 */
import { createHash, createHmac } from "node:crypto";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const sessionSecret =
  process.env.SESSION_SECRET ?? "phase0_browser_session_secret_2026";
const sessionToken = "phase0-browser-session-token-abrchin-2026";

function tokenHash(token: string) {
  return createHmac("sha256", sessionSecret)
    .update(token, "utf8")
    .digest("hex");
}

async function main() {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);

  const user = await prisma.user.create({
    data: {
      mobile: "09121111111",
      displayName: "کاربر تست مرورگر فاز صفر",
      role: "CUSTOMER",
      accountStatus: "ACTIVE",
      mobileVerifiedAt: now,
      registrationCompletedAt: now,
    },
  });

  await Promise.all([
    prisma.wallet.create({
      data: {
        userId: user.id,
        availableBalance: 5_000_000n,
        status: "ACTIVE",
      },
    }),
    prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: tokenHash(sessionToken),
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        ipAddress: "127.0.0.1",
        userAgent: "phase0-browser-smoke",
      },
    }),
    prisma.providerCatalogState.create({
      data: {
        id: "phase0-arvan-v1",
        provider: "ARVAN",
        apiVersion: "v1",
        enabled: true,
        lastCatalogSync: now,
        lastSyncStatus: "SUCCEEDED",
        freshnessSlaSeconds: 900,
        catalogItemCount: 1,
        pricedItemCount: 1,
      },
    }),
    prisma.storefrontAssortmentSettings.upsert({
      where: { id: "default" },
      update: {
        showHourlyPrice: false,
        showDailyPrice: false,
        showMonthlyPrice: true,
      },
      create: {
        id: "default",
        showHourlyPrice: false,
        showDailyPrice: false,
        showMonthlyPrice: true,
      },
    }),
  ]);

  await prisma.providerRegionConfig.create({
    data: {
      provider: "ARVAN",
      apiVersion: "v1",
      regionCode: "tehran11",
      displayName: "تهران ۱۱، ایران",
      saleEnabled: true,
      syncEnabled: true,
    },
  });

  const catalogItem = await prisma.providerCatalogItem.create({
    data: {
      provider: "ARVAN",
      apiVersion: "v1",
      productKind: "CLOUD_SERVER",
      source: "API_CATALOG",
      regionCode: "tehran11",
      sizeCode: "phase0-cloud-2-4",
      externalPlanId: "phase0-cloud-2-4",
      externalKey: "phase0:arvan:cloud-2-4",
      sizeName: "ابرچین نو",
      compatibleImageCodes: ["ubuntu24-cloudinit-qcow2"],
      vcpu: 2,
      ramMb: 4096,
      diskGb: 50,
      available: true,
      active: true,
      status: "ACTIVE",
      priceMonthlyAmount: 120_000_000_000n,
      priceScale: 6,
      currencyCode: "IRR",
      amountUnit: "TOMAN",
      providerMonthlyPriceIrr: 1_200_000n,
      lastSyncedAt: now,
      lastSeenAt: now,
      rawPayload: { fixture: "phase0-browser" },
      payloadHash: "phase0-browser-catalog-item",
      catalogVersion: now.toISOString(),
    },
  });

  const plan = await prisma.infrastructurePlan.create({
    data: {
      code: "PHASE0_CLOUD_NO",
      title: "چینش نو",
      description: "چینش نمونه برای اثبات توقف امن فروش عمومی",
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "CLOUD_SERVER",
      regionCode: "tehran11",
      sizeCode: "phase0-cloud-2-4",
      imageCode: "ubuntu24-cloudinit-qcow2",
      deliveryMode: "MANAGED",
      vcpu: 2,
      ramGb: 4,
      storageGb: 50,
      salePriceRial: 1_500_000n,
      renewalPriceRial: 1_500_000n,
      estimatedProviderCostRial: 1_200_000n,
      deliveryEstimateMinutes: 60,
      parchinIncluded: true,
      minimumParchinLevel: "PARCHIN_START",
      active: true,
      publicationStatus: "PUBLISHED",
      offerSource: "API_CATALOG",
      billingModel: "PREPAID_TERM",
      catalogItemId: catalogItem.id,
      catalogMappingStatus: "MAPPED",
      catalogMappedAt: now,
    },
  });

  await prisma.storefrontAssortmentSlot.create({
    data: {
      tier: "NO",
      role: "PRIMARY",
      sortOrder: 1,
      catalogItemId: catalogItem.id,
      enabled: true,
    },
  });

  const recommendationSession = await prisma.recommendationSession.create({
    data: {
      userId: user.id,
      status: "QUOTED",
      answers: { source: "PHASE0_BROWSER" },
      answerSources: {},
      profile: { source: "CLOUD_SERVER", planId: plan.id },
      productFlowState: "QUOTED",
      productFlowRevision: 1,
      selectedParchinLevel: "PARCHIN_START",
      deliveryConfiguration: {
        operatingSystem: "Ubuntu 24.04 LTS",
        serverName: "abrchin-phase0",
        accessMethod: "ONE_TIME_PASSWORD",
      },
      expiresAt,
    },
  });

  const quote = await prisma.recommendationQuote.create({
    data: {
      sessionId: recommendationSession.id,
      planId: plan.id,
      role: "RECOMMENDED",
      status: "ACTIVE",
      score: 100,
      scoreBreakdown: { fixture: true },
      reasons: ["چینش متوازن برای تست مرورگر"],
      profileSnapshot: { source: "CLOUD_SERVER", planId: plan.id },
      planSnapshot: {
        title: plan.title,
        description: plan.description,
        provider: plan.provider,
        productKind: plan.productKind,
        regionCode: plan.regionCode,
        imageCode: plan.imageCode,
        vcpu: plan.vcpu,
        ramGb: plan.ramGb,
        storageGb: plan.storageGb,
        deliveryEstimateMinutes: plan.deliveryEstimateMinutes,
        parchinIncluded: true,
        parchinLevel: "PARCHIN_START",
      },
      amountRial: 1_500_000n,
      renewalAmountRial: 1_500_000n,
      termMonths: 1,
      termDiscountBps: 0,
      catalogItemId: catalogItem.id,
      providerBasePriceRialSnapshot: 1_200_000n,
      markupBasisPointsSnapshot: 2_500,
      finalPriceRialSnapshot: 1_500_000n,
      currencySnapshot: "IRR",
      providerPriceCheckedAt: now,
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "CLOUD_SERVER",
      providerRegion: "tehran11",
      externalPlanId: "phase0-cloud-2-4",
      externalImageId: "ubuntu24-cloudinit-qcow2",
      vcpuSnapshot: 2,
      ramMbSnapshot: 4096,
      diskGbSnapshot: 50,
      operatingSystemSnapshot: "Ubuntu 24.04 LTS",
      providerMonthlyPriceIrr: 1_200_000n,
      markupAmountIrr: 300_000n,
      parchinLevel: "PARCHIN_START",
      parchinPriceIrr: 0n,
      taxBasisPointsSnapshot: 0,
      taxAmountIrr: 0n,
      lineItemsSnapshot: [
        {
          type: "INFRASTRUCTURE_SALE",
          label: "زیرساخت و خدمات ابرچین",
          amountIrr: "1500000",
        },
      ],
      quotedAt: now,
      catalogVersion: now.toISOString(),
      providerPayloadHash: "phase0-browser-catalog-item",
      expiresAt,
      deliveryConfigurationSnapshot: {
        provider: "ARVAN",
        region: "tehran11",
        regionLabel: "تهران",
        operatingSystem: "Ubuntu 24.04 LTS",
        serverName: "abrchin-phase0",
        accessMethod: "ONE_TIME_PASSWORD",
      },
    },
  });

  const guests = [];
  for (const label of ["desktop", "mobile"] as const) {
    const guestToken = `phase2-guest-${label}-token-abrchin-2026`;
    const guestSession = await prisma.recommendationSession.create({
      data: {
        guestAccessTokenHash: createHash("sha256")
          .update(guestToken)
          .digest("hex"),
        status: "QUOTED",
        answers: { source: "PHASE2_GUEST_BROWSER" },
        answerSources: {},
        profile: { source: "CLOUD_SERVER", planId: plan.id },
        productFlowState: "QUOTED",
        productFlowRevision: 1,
        selectedParchinLevel: "PARCHIN_START",
        deliveryConfiguration: {
          operatingSystem: "Ubuntu 24.04 LTS",
          serverName: `abrchin-phase2-${label}`,
          accessMethod: "ONE_TIME_PASSWORD",
        },
        expiresAt,
      },
    });
    const guestQuote = await prisma.recommendationQuote.create({
      data: {
        sessionId: guestSession.id,
        planId: plan.id,
        role: "RECOMMENDED",
        status: "ACTIVE",
        score: 100,
        scoreBreakdown: { fixture: true, guest: label },
        reasons: ["پیش‌فاکتور مهمان با انتخاب immutable"],
        profileSnapshot: { source: "CLOUD_SERVER", planId: plan.id },
        planSnapshot: {
          title: plan.title,
          description: plan.description,
          provider: plan.provider,
          productKind: plan.productKind,
          regionCode: plan.regionCode,
          imageCode: plan.imageCode,
          vcpu: plan.vcpu,
          ramGb: plan.ramGb,
          storageGb: plan.storageGb,
          deliveryEstimateMinutes: plan.deliveryEstimateMinutes,
          parchinIncluded: true,
          parchinLevel: "PARCHIN_START",
        },
        amountRial: 1_500_000n,
        renewalAmountRial: 1_500_000n,
        termMonths: 1,
        termDiscountBps: 0,
        catalogItemId: catalogItem.id,
        providerBasePriceRialSnapshot: 1_200_000n,
        markupBasisPointsSnapshot: 2_500,
        finalPriceRialSnapshot: 1_500_000n,
        currencySnapshot: "IRR",
        providerPriceCheckedAt: now,
        provider: "ARVAN",
        providerApiVersion: "v1",
        productKind: "CLOUD_SERVER",
        providerRegion: "tehran11",
        externalPlanId: "phase0-cloud-2-4",
        externalImageId: "ubuntu24-cloudinit-qcow2",
        vcpuSnapshot: 2,
        ramMbSnapshot: 4096,
        diskGbSnapshot: 50,
        operatingSystemSnapshot: "Ubuntu 24.04 LTS",
        providerMonthlyPriceIrr: 1_200_000n,
        markupAmountIrr: 300_000n,
        parchinLevel: "PARCHIN_START",
        parchinPriceIrr: 0n,
        taxBasisPointsSnapshot: 0,
        taxAmountIrr: 0n,
        lineItemsSnapshot: [
          {
            type: "INFRASTRUCTURE_SALE",
            label: "زیرساخت و خدمات ابرچین",
            amountIrr: "1500000",
          },
        ],
        quotedAt: now,
        catalogVersion: now.toISOString(),
        providerPayloadHash: "phase0-browser-catalog-item",
        expiresAt,
        deliveryConfigurationSnapshot: {
          provider: "ARVAN",
          region: "tehran11",
          regionLabel: "تهران",
          operatingSystem: "Ubuntu 24.04 LTS",
          serverName: `abrchin-phase2-${label}`,
          accessMethod: "ONE_TIME_PASSWORD",
        },
      },
    });
    guests.push({
      label,
      guestToken,
      sessionId: guestSession.id,
      quoteId: guestQuote.id,
    });
  }

  const trackingOrder = await prisma.serviceOrder.create({
    data: {
      userId: user.id,
      title: "سفارش در انتظار تأیید ساخت",
      amount: 1_500_000n,
      termMonths: 1,
      currency: "IRR",
      status: "PAID",
      planId: plan.id,
      planCode: plan.code,
      planSnapshot: {
        title: plan.title,
        provider: plan.provider,
        productKind: plan.productKind,
        regionCode: plan.regionCode,
        imageCode: plan.imageCode,
        vcpu: plan.vcpu,
        ramGb: plan.ramGb,
        storageGb: plan.storageGb,
      },
      quoteExpiresAt: expiresAt,
      provider: plan.provider,
      providerApiVersion: plan.providerApiVersion,
      productKind: plan.productKind,
      parchinLevel: "PARCHIN_START",
      productFlowState: "PAID",
      paidAt: now,
    },
  });
  await prisma.infrastructureOrder.create({
    data: {
      serviceOrderId: trackingOrder.id,
      userId: user.id,
      planId: plan.id,
      provider: plan.provider,
      providerApiVersion: plan.providerApiVersion,
      productKind: plan.productKind,
      parchinLevel: "PARCHIN_START",
      providerSelectionSnapshot: {
        fixture: "phase4_tracking",
        provider: plan.provider,
        providerApiVersion: plan.providerApiVersion,
        productKind: plan.productKind,
        offerSource: plan.offerSource,
      },
      productFlowState: "PAID",
      deliveryMode: plan.deliveryMode,
      status: "WAITING_ADMIN_FUNDING",
      requiredFundingRial: 1_200_000n,
      desiredInstanceName: "abrchin-phase4-tracking",
    },
  });

  console.log(
    JSON.stringify({
      source: "scripts/seed-phase0-browser-fixture.mts",
      userId: user.id,
      sessionToken,
      planId: plan.id,
      quoteId: quote.id,
      trackingOrderId: trackingOrder.id,
      guests,
    }),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
