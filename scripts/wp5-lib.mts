import { randomBytes } from "node:crypto";

import {
  PrismaClient,
  UserRole,
  WalletStatus,
} from "@prisma/client";

import { allowAdminMobile } from "./test-admin-allowlist.mts";

export const WP5_TERMS = [1, 3, 6, 12] as const;
export type Wp5Term = (typeof WP5_TERMS)[number];

export function applyWp5TestEnv() {
  process.env.NODE_ENV = "test";
  process.env.PUBLIC_SALE_ENABLED = "true";
  process.env.MANUAL_READY_PUBLIC_SALE_ENABLED = "true";
  process.env.ARVAN_PUBLIC_SALE_ENABLED = "true";
  process.env.ARVAN_READY_PUBLIC_SALE_ENABLED = "true";
  process.env.ARVAN_CLOUD_PUBLIC_SALE_ENABLED = "false";
  process.env.ARVAN_MUTATIONS_ENABLED = "false";
  process.env.ARVAN_ENABLED = "false";
  process.env.PAYMENT_BOOTSTRAP_DEFAULT_PROVIDER = "mock";
  process.env.PAYMENT_CALLBACK_BASE_URL =
    process.env.PAYMENT_CALLBACK_BASE_URL || "http://127.0.0.1:3010";
  process.env.SMS_PROVIDER = "console";
  process.env.EMAIL_PROVIDER = "console";
  process.env.MESSAGEGO_SETTLEMENT_ENABLED = "false";
  process.env.MESSAGEGO_CUSTOMER_AI_ENABLED = "false";
  process.env.MESSAGEGO_SECRET_HANDOFF_ENABLED = "false";
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 16) {
    process.env.SESSION_SECRET = "isolated_postgres_test_secret_2026";
  }
  if (!process.env.CREDENTIAL_ENCRYPTION_KEY) {
    process.env.CREDENTIAL_ENCRYPTION_KEY =
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  }
}

export async function enableMockGateway(prisma: PrismaClient) {
  await prisma.paymentGatewayConfig.updateMany({ data: { isDefault: false } });
  await prisma.paymentGatewayConfig.update({
    where: { provider: "MOCK" },
    data: { enabled: true, isDefault: true, environment: "DEVELOPMENT" },
  });
}

export function wp5Suffix(label: string) {
  return `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}-${label}`;
}

export async function createPublishedManualArvanPlan(
  prisma: PrismaClient,
  suffix: string,
  options?: { publicationStatus?: "PUBLISHED" | "DRAFT"; monthlyRial?: bigint },
) {
  const now = new Date();
  const validUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const monthly = options?.monthlyRial ?? 1_000_000n;
  const regionCode = `wp5-${suffix}`.slice(0, 40);
  const catalog = await prisma.providerCatalogItem.create({
    data: {
      provider: "ARVAN",
      apiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      source: "MANUAL_ADMIN",
      regionCode,
      sizeCode: `wp5-${suffix}`,
      externalPlanId: `wp5-${suffix}`,
      externalKey: `manual:arvan:v1:wp5:${suffix}`,
      sizeName: "WP5 prepaid fixture",
      compatibleImageCodes: ["ubuntu-wp5"],
      vcpu: 2,
      ramMb: 4096,
      diskGb: 50,
      active: true,
      available: true,
      status: "ACTIVE",
      providerMonthlyPriceIrr: monthly,
      priceMonthlyAmount: monthly,
      priceScale: 0,
      currencyCode: "IRR",
      amountUnit: "RIAL",
      manualAvailableUnits: 1,
      manualPriceValidUntil: validUntil,
      manualLastVerifiedAt: now,
      lastSyncedAt: now,
      lastSeenAt: now,
      rawPayload: { source: "wp5_production_candidate" },
      payloadHash: `wp5-${suffix}`,
      catalogVersion: `wp5:${now.toISOString()}`,
    },
  });
  await prisma.providerCatalogState.upsert({
    where: { provider: "ARVAN" },
    update: {
      enabled: true,
      lastCatalogSync: now,
      lastSyncStatus: "SUCCEEDED",
      freshnessSlaSeconds: 900,
    },
    create: {
      id: "arvan",
      provider: "ARVAN",
      enabled: true,
      lastCatalogSync: now,
      lastSyncStatus: "SUCCEEDED",
      freshnessSlaSeconds: 900,
    },
  });
  await prisma.providerRegionConfig.upsert({
    where: {
      provider_apiVersion_regionCode: {
        provider: "ARVAN",
        apiVersion: "v1",
        regionCode,
      },
    },
    update: { saleEnabled: true, syncEnabled: true },
    create: {
      provider: "ARVAN",
      apiVersion: "v1",
      regionCode,
      displayName: `WP5 ${suffix}`,
      saleEnabled: true,
      syncEnabled: true,
    },
  });
  await prisma.providerPricingConfig.upsert({
    where: { provider: "ARVAN" },
    update: {
      apiVersion: "v1",
      enabled: true,
      markupBasisPoints: 0,
      sourceMoneyUnit: "RIAL",
    },
    create: {
      id: "arvan",
      provider: "ARVAN",
      apiVersion: "v1",
      enabled: true,
      markupBasisPoints: 0,
      sourceMoneyUnit: "RIAL",
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
      provider: "ARVAN",
      apiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      enabled: true,
      markupBasisPoints: 0,
    },
  });
  await prisma.profitCurveConfiguration.upsert({
    where: { id: "default" },
    update: { enabled: false, minimumPostDiscountGrossMarginBps: 0 },
    create: {
      id: "default",
      enabled: false,
      minimumPostDiscountGrossMarginBps: 0,
    },
  });
  await prisma.commercePricingConfig.upsert({
    where: { id: "default" },
    update: { taxBps: 0, minimumPostDiscountGrossMarginBps: 0 },
    create: { id: "default", taxBps: 0, minimumPostDiscountGrossMarginBps: 0 },
  });
  const plan = await prisma.infrastructurePlan.create({
    data: {
      code: `WP5_${suffix}`.replace(/[^A-Za-z0-9_]/g, "").slice(0, 40),
      title: "WP5 prepaid Arvan plan",
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      offerSource: "MANUAL_ADMIN",
      regionCode,
      sizeCode: catalog.sizeCode,
      imageCode: "ubuntu-wp5",
      deliveryMode: "MANAGED",
      vcpu: 2,
      ramGb: 4,
      storageGb: 50,
      salePriceRial: monthly,
      renewalPriceRial: monthly,
      estimatedProviderCostRial: monthly,
      deliveryEstimateMinutes: 15,
      parchinIncluded: true,
      minimumParchinLevel: "PARCHIN_START",
      active: true,
      publicationStatus: options?.publicationStatus ?? "PUBLISHED",
      instantDelivery: false,
      displayDuringProviderOutage: true,
      offerPriceValidUntil: validUntil,
      offerLastVerifiedAt: now,
      catalogItemId: catalog.id,
      catalogMappingStatus: "MAPPED",
      catalogMappedAt: now,
      billingModel: "PREPAID_TERM",
    },
  });
  return { catalog, plan, regionCode, now, validUntil };
}

function fixtureMobile(prefix: "091" | "098") {
  const n = BigInt(`0x${randomBytes(5).toString("hex")}`) % 100_000_000n;
  return `${prefix}${n.toString().padStart(8, "0")}`;
}

export async function createCustomerAndAdmin(
  prisma: PrismaClient,
  _suffix: string,
) {
  const customerMobile = fixtureMobile("091");
  const adminMobile = fixtureMobile("098");
  const customer = await prisma.user.create({
    data: { mobile: customerMobile, role: UserRole.CUSTOMER },
  });
  await prisma.wallet.create({
    data: {
      userId: customer.id,
      availableBalance: 0n,
      status: WalletStatus.ACTIVE,
    },
  });
  allowAdminMobile(adminMobile);
  const admin = await prisma.user.create({
    data: { mobile: adminMobile, role: UserRole.ADMIN },
  });
  return { customer, admin, customerMobile, adminMobile };
}

export function idempotencyKey(prefix: string) {
  const raw = `${prefix}-${randomBytes(8).toString("hex")}`;
  return raw.slice(0, 128).padEnd(16, "x");
}
