import { createHash, randomUUID } from "node:crypto";

import {
  InfrastructureProductKind,
  InfrastructureProvider,
  ParchinLevel,
  RecommendationFlowStatus,
  RecommendationQuoteRole,
  RecommendationQuoteStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  getActivePlanById,
  getActiveReadyServerPlanById,
  listActivePlans,
  toPlanSnapshot,
  type PricedInfrastructurePlan,
} from "@/lib/orders/plans";
import {
  snapshotParchinServiceContract,
  toParchinServiceContract,
} from "@/lib/parchin/service-contract";
import {
  getCatalogFreshness,
} from "@/lib/infrastructure/multi-provider-catalog-service";
import { isRegionEnabledForSale } from "@/lib/infrastructure/provider-region-config";
import { assertProviderRoute } from "@/lib/infrastructure/provider-routing";
import {
  assertPublicSaleEnabled,
  isPublicSaleEnabled,
} from "@/lib/infrastructure/public-sale-policy";
import { createCloudProviderAdapter } from "@/lib/infrastructure/provider-factory";
import {
  findFreshAvailableInventory,
  lockAvailableInventoryTx,
  reserveLockedInventoryForQuoteTx,
} from "@/lib/infrastructure/preprovisioned-inventory";
import {
  resolveProviderSelectionDefaults,
  revalidateLockedSelection,
} from "@/lib/infrastructure/selection-revalidation";
import {
  bootstrapCatalogCheckoutFlowTx,
  transitionProductFlowTx,
  type ProductFlowTransitionInput,
} from "@/lib/product-flow/service";
import { adjustRecommendationProfile, buildRecommendation } from "@/lib/recommendation/engine";
import { rankProviderOffers } from "@/lib/recommendation/provider-ranking";
import type {
  AnswerSources,
  ProviderOffer,
  PublicRecommendationQuote,
  RankedProviderOffer,
  RecommendationAnswers,
  RecommendationDirection,
  RecommendationOfferRole,
  RecommendationResult,
  ResourceProfile,
} from "@/lib/recommendation/types";
import { WalletError } from "@/lib/wallet/errors";
import { serializeQuoteLineItems } from "@/lib/pricing/quote-line-items";
import { isBillingTermMonths } from "@/lib/billing/lifecycle-policy";
import {
  normalizeCouponCode,
  resolveServerPurchaseCoupon,
} from "@/lib/coupons/service";
import {
  createCatalogGuestSessionCredential,
  requireConversationAccess,
} from "@/lib/recommendation/session-service";
import {
  assertParchinLevelAllowed,
  recommendedParchinLevel,
} from "@/lib/parchin/recommendation";
import {
  generateCustomerServerName,
  isCustomerSshSelfServeEnabled,
  normalizeCustomerImageIdentity,
  normalizeCustomerServerName,
} from "@/lib/infrastructure/image-identity";
import { storefrontParchinTitleForLevel } from "@/lib/storefront/tiers";

/** Customer-purchasable infrastructure quotes lock the customer price for exactly 60 minutes. */
export const RECOMMENDATION_QUOTE_VALIDITY_MS = 60 * 60 * 1000;
const READY_SERVER_PROFILE_SOURCE = "READY_SERVER";
const CLOUD_SERVER_PROFILE_SOURCE = "CLOUD_SERVER";

export { recommendedParchinLevel };
export { normalizeCustomerServerName };

export type SelectedQuote = {
  role: RecommendationOfferRole;
  profile: ResourceProfile;
  rankedOffer: RankedProviderOffer;
  plan: PricedInfrastructurePlan;
};

type LockedDeliveryConfiguration = {
  provider: InfrastructureProvider;
  providerApiVersion: string;
  productKind: InfrastructureProductKind;
  region: string;
  regionLabel: string;
  externalPlanId: string;
  externalImageId: string;
  externalNetworkId: string | null;
  externalSecurityId: string | null;
  topologyVerificationMode: "STRICT_OBSERVED" | "PROVIDER_MANAGED";
  operatingSystem: string;
  accessMethod:
    | "ONE_TIME_PASSWORD"
    | "SSH_KEY"
    | "WINDOWS_PASSWORD";
  planId?: string;
  catalogItemId?: string | null;
  imageAssetId?: string;
  sshKeyName?: string | null;
  sshKeyId?: string | null;
  sshKeyFingerprint?: string | null;
  serverName?: string;
  configuredAt: string;
};

export type CatalogDeliverySelection = {
  imageAssetId: string;
  accessMethod: "ONE_TIME_PASSWORD" | "SSH_KEY" | "WINDOWS_PASSWORD";
  sshKeyName?: string | null;
  /** Customer-chosen display/hostname for the AbrChin server. */
  serverName: string;
};

function parseLockedDeliveryConfiguration(
  value: Prisma.JsonValue | null,
): LockedDeliveryConfiguration | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const configuration = value as Record<string, unknown>;
  if (
    configuration.provider !== InfrastructureProvider.ARVAN ||
    configuration.providerApiVersion !== "v1" ||
    configuration.productKind !== InfrastructureProductKind.CLOUD_SERVER ||
    typeof configuration.planId !== "string" ||
    typeof configuration.region !== "string" ||
    typeof configuration.externalPlanId !== "string" ||
    typeof configuration.externalImageId !== "string" ||
    typeof configuration.externalNetworkId !== "string" ||
    typeof configuration.externalSecurityId !== "string" ||
    configuration.topologyVerificationMode !== "STRICT_OBSERVED" ||
    typeof configuration.operatingSystem !== "string" ||
    ![
      "ONE_TIME_PASSWORD",
      "SSH_KEY",
      "WINDOWS_PASSWORD",
    ].includes(String(configuration.accessMethod))
  ) {
    return null;
  }
  return configuration as unknown as LockedDeliveryConfiguration;
}

function sessionAnswers(value: Prisma.JsonValue): RecommendationAnswers {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecommendationAnswers)
    : {};
}

function sessionSources(value: Prisma.JsonValue): AnswerSources {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as AnswerSources)
    : {};
}

const selections: Array<{
  role: RecommendationOfferRole;
  direction: RecommendationDirection;
}> = [
  { role: "RECOMMENDED", direction: "balanced" },
  { role: "ECONOMY", direction: "economy" },
  { role: "GROWTH", direction: "performance" },
];

function bigintToSafeNumber(value: bigint): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error("invalid_plan_price");
  }
  return numeric;
}

async function requireFreshCatalog(provider: InfrastructureProvider) {
  const freshness = await getCatalogFreshness(provider);
  if (!freshness.fresh) {
    throw new WalletError(
      "quote_unavailable",
      "قیمت یا ظرفیت این سرویس تازه نیست؛ پس از بررسی مجدد دوباره تلاش کن.",
    );
  }
}

async function requireRegionSaleEnabled(input: {
  provider: InfrastructureProvider;
  providerApiVersion: string;
  productKind: InfrastructureProductKind;
  offerSource: string;
  regionCode: string;
}) {
  if (
    input.provider !== InfrastructureProvider.ARVAN ||
    input.offerSource !== "API_CATALOG"
  ) {
    return;
  }
  if (
    !(await isRegionEnabledForSale({
      provider: input.provider,
      apiVersion: input.providerApiVersion,
      regionCode: input.regionCode,
    }))
  ) {
    throw new WalletError(
      "provider_sale_disabled",
      "فروش عمومی این موقعیت موقتاً غیرفعال است؛ مبلغی برداشت نشد.",
    );
  }
}

/**
 * Launch catalog purchases are fulfilled manually by Admin after payment.
 * Customer checkout therefore locks the published SKU + chosen OS from the
 * stored Arvan/ParsPack catalog and must not depend on live provider topology,
 * mutation access, or a second availability probe.
 */
async function lockAdminFulfilledCatalogPlan(
  plan: PricedInfrastructurePlan,
  delivery: CatalogDeliverySelection,
): Promise<{
  configuration: LockedDeliveryConfiguration;
  providerPriceCheckedAt: Date;
  providerHourlyPriceIrr: bigint | null;
}> {
  const compatible = Array.isArray(plan.catalogItem.compatibleImageCodes)
    ? plan.catalogItem.compatibleImageCodes.filter(
        (code): code is string => typeof code === "string" && code.length > 0,
      )
    : [];
  const syntheticPrefix = "catalog-code:";
  const syntheticCode = delivery.imageAssetId.startsWith(syntheticPrefix)
    ? delivery.imageAssetId.slice(syntheticPrefix.length)
    : null;
  const storedImage = syntheticCode
    ? null
    : await prisma.providerCatalogAsset.findFirst({
        where: {
          id: delivery.imageAssetId,
          provider: plan.provider,
          apiVersion: plan.providerApiVersion,
          regionCode: plan.regionCode,
          kind: "IMAGE",
        },
      });
  const externalImageId = storedImage?.externalId ?? syntheticCode;
  if (!externalImageId || !compatible.includes(externalImageId)) {
    throw new WalletError(
      "quote_unavailable",
      "سیستم‌عامل انتخاب‌شده برای این سرور معتبر نیست.",
    );
  }
  const imageIdentity = normalizeCustomerImageIdentity({
    name: storedImage?.name ?? externalImageId,
    externalId: externalImageId,
    rawPayload: storedImage?.rawPayload,
  });
  const expectedAccessMethod = imageIdentity.windows
    ? "WINDOWS_PASSWORD"
    : "ONE_TIME_PASSWORD";
  if (delivery.accessMethod !== expectedAccessMethod) {
    throw new WalletError(
      "quote_unavailable",
      "روش تحویل با سیستم‌عامل انتخاب‌شده سازگار نیست.",
    );
  }
  const regionConfig = await prisma.providerRegionConfig.findUnique({
    where: {
      provider_apiVersion_regionCode: {
        provider: plan.provider,
        apiVersion: plan.providerApiVersion,
        regionCode: plan.regionCode,
      },
    },
    select: { displayName: true },
  });
  const checkedAt =
    plan.catalogItem.lastSyncedAt ?? plan.pricing.providerPriceCheckedAt;
  return {
    configuration: {
      provider: plan.provider,
      providerApiVersion: plan.providerApiVersion,
      productKind: plan.productKind,
      region: plan.regionCode,
      regionLabel: regionConfig?.displayName ?? plan.regionCode,
      externalPlanId: plan.catalogItem.externalPlanId ?? plan.sizeCode,
      externalImageId,
      externalNetworkId: null,
      externalSecurityId: null,
      topologyVerificationMode: "PROVIDER_MANAGED",
      operatingSystem: imageIdentity.displayName,
      accessMethod: expectedAccessMethod,
      imageAssetId: storedImage?.id ?? `${syntheticPrefix}${externalImageId}`,
      sshKeyName: null,
      sshKeyId: null,
      sshKeyFingerprint: null,
      serverName: delivery.serverName,
      configuredAt: checkedAt.toISOString(),
    },
    providerPriceCheckedAt: checkedAt,
    providerHourlyPriceIrr: plan.catalogItem.providerHourlyPriceIrr,
  };
}

async function lockAndRevalidatePlan(
  plan: PricedInfrastructurePlan,
  delivery: CatalogDeliverySelection,
): Promise<{
  configuration: LockedDeliveryConfiguration;
  providerPriceCheckedAt: Date;
  providerHourlyPriceIrr: bigint | null;
}> {
  if (plan.offerSource === "API_CATALOG") {
    return lockAdminFulfilledCatalogPlan(plan, delivery);
  }
  await requireRegionSaleEnabled(plan);
  assertProviderRoute({
    productKind: plan.productKind,
    provider: plan.provider,
    apiVersion: plan.providerApiVersion,
  });
  const externalPlanId = plan.catalogItem.externalPlanId ?? plan.sizeCode;
  const offerSource = plan.offerSource;
  const preprovisioned = offerSource === "PREPROVISIONED_INVENTORY";
  const manualAdmin = offerSource === "MANUAL_ADMIN";
  const manualImageAssetId = `manual:${plan.id}`;
  const image = manualAdmin
    ? delivery.imageAssetId === manualImageAssetId
      ? {
          id: manualImageAssetId,
          externalId: plan.imageCode,
          name: plan.imageCode,
          rawPayload: { ssh_key: false, ssh_password: true },
        }
      : null
    : await prisma.providerCatalogAsset.findFirst({
        where: {
          id: delivery.imageAssetId,
          provider: plan.provider,
          apiVersion: plan.providerApiVersion,
          regionCode: plan.regionCode,
          kind: "IMAGE",
          status: "ACTIVE",
          available: true,
        },
      });
  const compatible = Array.isArray(plan.catalogItem.compatibleImageCodes)
    ? plan.catalogItem.compatibleImageCodes.filter(
        (code): code is string => typeof code === "string",
      )
    : [];
  if (!image || !compatible.includes(image.externalId)) {
    throw new WalletError(
      "quote_unavailable",
      "سیستم‌عامل انتخاب‌شده دیگر با این سرور سازگار نیست.",
    );
  }
  const imageIdentity = normalizeCustomerImageIdentity({
    name: image.name,
    externalId: image.externalId,
    rawPayload: image.rawPayload,
  });
  const windows = imageIdentity.windows;
  const rawImage =
    image.rawPayload &&
    typeof image.rawPayload === "object" &&
    !Array.isArray(image.rawPayload)
      ? (image.rawPayload as Record<string, unknown>)
      : {};
  if (
    (delivery.accessMethod === "SSH_KEY" &&
      rawImage.ssh_key === false) ||
    (delivery.accessMethod === "ONE_TIME_PASSWORD" &&
      rawImage.ssh_password === false)
  ) {
    throw new WalletError(
      "quote_unavailable",
      "روش دسترسی برای این سیستم‌عامل پشتیبانی نمی‌شود.",
    );
  }
  if (
    (windows && delivery.accessMethod !== "WINDOWS_PASSWORD") ||
    (!windows && delivery.accessMethod === "WINDOWS_PASSWORD")
  ) {
    throw new WalletError(
      "quote_unavailable",
      "روش دسترسی با سیستم‌عامل انتخاب‌شده سازگار نیست.",
    );
  }
  let lockedSshKey: {
    id: string | null;
    name: string;
    fingerprint: string | null;
  } | null = null;
  if (
    offerSource !== "API_CATALOG" &&
    (!plan.offerLastVerifiedAt ||
      !plan.offerPriceValidUntil ||
      plan.offerPriceValidUntil.getTime() <= Date.now())
  ) {
    throw new WalletError(
      "quote_unavailable",
      "اعتبار قیمت این پیشنهاد تمام شده است.",
    );
  }
  if (delivery.accessMethod === "SSH_KEY") {
    if (!isCustomerSshSelfServeEnabled()) {
      throw new WalletError(
        "quote_unavailable",
        "انتخاب کلید SSH فعلاً برای خرید مستقیم در دسترس نیست.",
      );
    }
    if (preprovisioned || manualAdmin) {
      throw new WalletError(
        "quote_unavailable",
        "برای موجودی آمادهٔ ابرچین فقط دسترسی رمز یک‌بارمصرف قابل تحویل است.",
      );
    }
    const keyName = delivery.sshKeyName?.trim() ?? "";
    if (!/^[a-zA-Z0-9._-]{1,128}$/.test(keyName)) {
      throw new WalletError(
        "quote_unavailable",
        "کلید SSH معتبر انتخاب نشده است.",
      );
    }
    const adapter = createCloudProviderAdapter(
      plan.provider,
      plan.providerApiVersion,
    );
    const key = (await adapter.listSshKeys(plan.regionCode)).find(
      (candidate) => candidate.name === keyName,
    );
    if (!key) {
      throw new WalletError(
        "quote_unavailable",
        "کلید SSH انتخاب‌شده در موقعیت سرور موجود نیست.",
      );
    }
    lockedSshKey = {
      id: key.id,
      name: key.name,
      fingerprint: key.fingerprint,
    };
  }
  const inventoryPreview = preprovisioned
    ? await findFreshAvailableInventory({
        planId: plan.id,
        catalogItemId: plan.catalogItem.id,
        provider: plan.provider,
        apiVersion: plan.providerApiVersion,
        regionCode: plan.regionCode,
        externalPlanId,
        externalImageId: image.externalId,
      })
    : null;
  if (preprovisioned && !inventoryPreview) {
    throw new WalletError(
      "inventory_unavailable",
      "سرور آمادهٔ سالم و تازه‌ای برای این انتخاب موجود نیست.",
    );
  }
  const defaults = preprovisioned
    ? {
        externalNetworkId: inventoryPreview!.observedNetworkId,
        externalSecurityId: inventoryPreview!.observedSecurityId,
        topologyVerificationMode: "STRICT_OBSERVED" as const,
      }
    : manualAdmin
      ? {
          externalNetworkId: null,
          externalSecurityId: null,
          topologyVerificationMode: "PROVIDER_MANAGED" as const,
        }
    : await resolveProviderSelectionDefaults({
        provider: plan.provider,
        providerApiVersion: plan.providerApiVersion,
        productKind: plan.productKind,
        region: plan.regionCode,
      });
  const selection = {
    provider: plan.provider,
    providerApiVersion: plan.providerApiVersion,
    productKind: plan.productKind,
    region: plan.regionCode,
    externalPlanId,
    externalImageId: image.externalId,
    externalNetworkId: defaults.externalNetworkId,
    externalSecurityId: defaults.externalSecurityId,
  };
  const current = preprovisioned || manualAdmin
    ? {
        available:
          !manualAdmin || (plan.catalogItem.manualAvailableUnits ?? 0) > 0,
        monthlyPriceIrr: plan.pricing.providerBasePriceRial,
        hourlyPriceIrr: plan.catalogItem.providerHourlyPriceIrr,
        currency: "IRR" as const,
        checkedAt:
          plan.offerLastVerifiedAt ??
          plan.pricing.providerPriceCheckedAt,
      }
    : await revalidateLockedSelection(selection);
  if (!current.available) {
    throw new WalletError(
      "inventory_unavailable",
      "موجودی این سرور آماده تمام شده است.",
    );
  }
  if (
    current.monthlyPriceIrr !==
      plan.pricing.providerBasePriceRial ||
    (plan.productKind === InfrastructureProductKind.CLOUD_SERVER &&
      current.hourlyPriceIrr !==
        plan.catalogItem.providerHourlyPriceIrr) ||
    current.currency !== plan.pricing.currency
  ) {
    throw new WalletError(
      "quote_revalidation_failed",
      "قیمت یا ظرفیت این سرویس تغییر کرده است؛ Quote تازه دریافت کن.",
    );
  }
  const regionConfig = await prisma.providerRegionConfig.findUnique({
    where: {
      provider_apiVersion_regionCode: {
        provider: plan.provider,
        apiVersion: plan.providerApiVersion,
        regionCode: plan.regionCode,
      },
    },
    select: { displayName: true },
  });
  return {
    configuration: {
      provider: plan.provider,
      providerApiVersion: plan.providerApiVersion,
      productKind: plan.productKind,
      region: plan.regionCode,
      regionLabel: regionConfig?.displayName ?? plan.regionCode,
      externalPlanId,
      externalImageId: image.externalId,
      externalNetworkId: defaults.externalNetworkId,
      externalSecurityId: defaults.externalSecurityId,
      topologyVerificationMode: defaults.topologyVerificationMode,
      operatingSystem: imageIdentity.displayName,
      accessMethod: delivery.accessMethod,
      imageAssetId: image.id,
      sshKeyName: lockedSshKey?.name ?? null,
      sshKeyId: lockedSshKey?.id ?? null,
      sshKeyFingerprint: lockedSshKey?.fingerprint ?? null,
      serverName: delivery.serverName,
      configuredAt: current.checkedAt.toISOString(),
    },
    providerPriceCheckedAt: current.checkedAt,
    providerHourlyPriceIrr: current.hourlyPriceIrr,
  };
}

function planToProviderOffer(
  plan: PricedInfrastructurePlan,
  capturedAt: Date,
  expiresAt: Date,
): ProviderOffer | null {
  if (!plan.vcpu || !plan.ramGb || !plan.storageGb) return null;

  return {
    id: plan.id,
    planId: plan.id,
    provider: plan.provider,
    providerLabel: plan.provider,
    regionCode: plan.regionCode,
    countryCode: "IR",
    deliveryModes: [plan.deliveryMode],
    vcpu: plan.vcpu,
    ramGb: plan.ramGb,
    storageGb: plan.storageGb,
    salePriceRial: bigintToSafeNumber(plan.salePriceRial),
    available: plan.active,
    // Launch: Parchin-managed delivery covers operational recovery posture.
    // Do not hard-reject every offer as "missing_backup" when no separate
    // backup SKU exists yet.
    supportsBackup: plan.parchinIncluded === true,
    supportsResize: true,
    reliabilityScore: 85,
    capturedAt,
    expiresAt,
  };
}

function quoteReasons(
  role: RecommendationOfferRole,
  recommendation: RecommendationResult,
  offer: RankedProviderOffer,
): string[] {
  const roleReason =
    role === "ECONOMY"
      ? "کم‌هزینه‌ترین چینش معتبر است که از حداقل امن نیازت پایین‌تر نمی‌رود."
      : role === "GROWTH"
        ? "برای رشد نزدیک، پیک مصرف و ارتقای بعدی حاشیه‌ی بیشتری نگه می‌دارد."
        : "بهترین توازن قیمت، ظرفیت، قابلیت‌ها و پایداری برای پاسخ‌های فعلی توست.";

  const reasons = [
    roleReason,
    `امتیاز تناسب ظرفیت ${Math.round(offer.scoreBreakdown.capacity)} از ۱۰۰ است.`,
    `امتیاز پایداری این مسیر ${Math.round(offer.scoreBreakdown.reliability)} از ۱۰۰ است.`,
    ...recommendation.reasons,
  ];

  return [...new Set(reasons)].slice(0, 5);
}

function budgetCeilingRial(
  budget: "under_500k" | "500k_2m" | "2m_5m" | "over_5m" | "unknown" | undefined,
) {
  switch (budget) {
    case "under_500k":
      return 5_000_000n;
    case "500k_2m":
      return 20_000_000n;
    case "2m_5m":
      return 50_000_000n;
    default:
      return null;
  }
}

export function selectQuotes(
  recommendation: RecommendationResult,
  plans: PricedInfrastructurePlan[],
  now: Date,
  expiresAt: Date,
  options?: {
    budget?: "under_500k" | "500k_2m" | "2m_5m" | "over_5m" | "unknown";
  },
): SelectedQuote[] {
  const ceiling = budgetCeilingRial(options?.budget);
  const budgetFiltered =
    ceiling == null
      ? plans
      : plans.filter((plan) => plan.pricing.finalPriceRial <= ceiling);
  const pool = budgetFiltered.length > 0 ? budgetFiltered : plans;
  const offers = pool
    .map((plan) => planToProviderOffer(plan, now, expiresAt))
    .filter((offer): offer is ProviderOffer => Boolean(offer));
  const planById = new Map(pool.map((plan) => [plan.id, plan]));
  const usedPlanIds = new Set<string>();
  const selected: SelectedQuote[] = [];

  const usedResourceFingerprints = new Set<string>();
  function planResourceFingerprint(plan: PricedInfrastructurePlan) {
    return `${plan.pricing.vcpu ?? plan.vcpu ?? 0}:${plan.pricing.ramGb ?? plan.ramGb ?? 0}:${plan.pricing.storageGb ?? plan.storageGb ?? 0}`;
  }
  for (const selection of selections) {
    const profile = adjustRecommendationProfile(recommendation, selection.direction);
    const { ranked } = rankProviderOffers(profile, offers, now);
    let rankedOffer = ranked.find((offer) => {
      if (usedPlanIds.has(offer.planId)) return false;
      const plan = planById.get(offer.planId);
      if (!plan) return false;
      return !usedResourceFingerprints.has(planResourceFingerprint(plan));
    });

    // Founder rule: always recommend a real catalog server, even if no offer
    // fully clears every hard floor (e.g. temporary capability gaps).
    if (!rankedOffer) {
      const fallback = [...offers]
        .filter((offer) => !usedPlanIds.has(offer.planId))
        .sort(
          (a, b) =>
            a.salePriceRial - b.salePriceRial ||
            b.vcpu + b.ramGb - (a.vcpu + a.ramGb),
        )[0];
      if (fallback) {
        rankedOffer = {
          ...fallback,
          score: 50,
          scoreBreakdown: {
            price: 50,
            capacity: 50,
            networkFit: fallback.countryCode === "IR" ? 100 : 40,
            capability: 50,
            reliability: fallback.reliabilityScore,
          },
        };
      }
    }
    if (!rankedOffer) continue;

    const plan = planById.get(rankedOffer.planId);
    if (!plan) continue;

    usedPlanIds.add(plan.id);
    usedResourceFingerprints.add(planResourceFingerprint(plan));
    selected.push({
      role: selection.role,
      profile,
      rankedOffer,
      plan,
    });
  }

  return selected.sort(
    (a, b) =>
      (a.role === "ECONOMY" ? 0 : a.role === "RECOMMENDED" ? 1 : 2) -
      (b.role === "ECONOMY" ? 0 : b.role === "RECOMMENDED" ? 1 : 2),
  );
}

export function toPublicRecommendationQuote(quote: {
  id: string;
  role: RecommendationQuoteRole;
  amountRial: bigint;
  renewalAmountRial: bigint;
  reasons: Prisma.JsonValue;
  planSnapshot: Prisma.JsonValue;
  expiresAt: Date;
  termMonths?: number | null;
  termDiscountBps?: number | null;
  couponCodeSnapshot?: string | null;
  couponDiscountBpsSnapshot?: number | null;
  lineItemsSnapshot?: Prisma.JsonValue | null;
}): PublicRecommendationQuote {
  const snapshot = quote.planSnapshot as Record<string, unknown>;
  const reasons = Array.isArray(quote.reasons)
    ? quote.reasons.filter((reason): reason is string => typeof reason === "string")
    : [];
  const termMonths =
    quote.termMonths === 3 ||
    quote.termMonths === 6 ||
    quote.termMonths === 12
      ? quote.termMonths
      : 1;
  // Never expose provider cost vs AbrChin markup split to customers.
  // Collapse those internal economics into one customer-safe sale line.
  const INTERNAL_COST_LINE_TYPES = new Set([
    "PROVIDER_INFRASTRUCTURE",
    "INFRASTRUCTURE_MARKUP",
  ]);
  const rawLineItems = Array.isArray(quote.lineItemsSnapshot)
    ? quote.lineItemsSnapshot.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const row = item as Record<string, unknown>;
        if (
          typeof row.type !== "string" ||
          typeof row.label !== "string" ||
          (typeof row.amountIrr !== "string" && typeof row.amountIrr !== "number")
        ) {
          return [];
        }
        return [
          {
            type: row.type,
            label: row.label,
            amountRial: String(row.amountIrr),
          },
        ];
      })
    : [];
  let infrastructureSaleRial = 0n;
  let sawInternalCostSplit = false;
  const lineItems: Array<{ type: string; label: string; amountRial: string }> =
    [];
  for (const item of rawLineItems) {
    if (INTERNAL_COST_LINE_TYPES.has(item.type)) {
      sawInternalCostSplit = true;
      try {
        infrastructureSaleRial += BigInt(item.amountRial);
      } catch {
        // Ignore malformed historical amounts; never leak the raw split.
      }
      continue;
    }
    lineItems.push(item);
  }
  if (sawInternalCostSplit) {
    lineItems.unshift({
      type: "INFRASTRUCTURE_SALE",
      label: "زیرساخت و خدمات ابرچین",
      amountRial: infrastructureSaleRial.toString(),
    });
  }

  return {
    id: quote.id,
    role: quote.role,
    title: typeof snapshot.title === "string" ? snapshot.title : "چینش ابری",
    description: typeof snapshot.description === "string" ? snapshot.description : null,
    deliveryMode: "MANAGED",
    vcpu: typeof snapshot.vcpu === "number" ? snapshot.vcpu : null,
    ramGb: typeof snapshot.ramGb === "number" ? snapshot.ramGb : null,
    storageGb: typeof snapshot.storageGb === "number" ? snapshot.storageGb : null,
    amountRial: quote.amountRial.toString(),
    renewalAmountRial: quote.renewalAmountRial.toString(),
    termMonths,
    termDiscountBps:
      typeof quote.termDiscountBps === "number" ? quote.termDiscountBps : 0,
    couponCode: quote.couponCodeSnapshot ?? null,
    couponDiscountBps: quote.couponDiscountBpsSnapshot ?? null,
    lineItems,
    deliveryEstimateMinutes:
      typeof snapshot.deliveryEstimateMinutes === "number"
        ? snapshot.deliveryEstimateMinutes
        : 15,
    parchinIncluded: snapshot.parchinIncluded === true,
    parchinLevel:
      snapshot.parchinLevel === "PARCHIN_ACTIVE" ||
      snapshot.parchinLevel === "PARCHIN_STABLE"
        ? snapshot.parchinLevel
        : "PARCHIN_START",
    reasons,
    expiresAt: quote.expiresAt.toISOString(),
  };
}

function isReadyServerProfile(value: Prisma.JsonValue | null): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    value.source === READY_SERVER_PROFILE_SOURCE
  );
}

function isCloudServerProfile(value: Prisma.JsonValue | null): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    value.source === CLOUD_SERVER_PROFILE_SOURCE
  );
}

function catalogCheckoutRequestHash(input: {
  planId: string;
  expectedProductKind: InfrastructureProductKind;
  delivery: CatalogDeliverySelection;
  termMonths: 1 | 3 | 6 | 12;
  couponCode: string | null;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        planId: input.planId,
        expectedProductKind: input.expectedProductKind,
        imageAssetId: input.delivery.imageAssetId,
        accessMethod: input.delivery.accessMethod,
        sshKeyName: input.delivery.sshKeyName?.trim() || null,
        serverName: input.delivery.serverName,
        termMonths: input.termMonths,
        couponCode: input.couponCode,
      }),
    )
    .digest("hex");
}

async function createCatalogServerQuote(params: {
  planId: string;
  userId?: string | null;
  now?: Date;
  expectedProductKind: InfrastructureProductKind;
  delivery: CatalogDeliverySelection;
  idempotencyKey: string;
  termMonths?: 1 | 3 | 6 | 12;
  couponCode?: string | null;
}) {
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(params.idempotencyKey)) {
    throw new WalletError(
      "invalid_idempotency_key",
      "شناسه یکتای درخواست معتبر نیست.",
    );
  }
  const serverName = normalizeCustomerServerName(params.delivery.serverName);
  if (!serverName) {
    throw new WalletError(
      "invalid_server_name",
      "نام سرور معتبر نیست؛ حداقل ۲ کاراکتر حرف یا عدد باشد.",
    );
  }
  const delivery = { ...params.delivery, serverName };
  const termMonths = isBillingTermMonths(params.termMonths) ? params.termMonths : 1;
  const couponCode = normalizeCouponCode(params.couponCode);
  let couponDiscountBps: number | null = null;
  if (couponCode) {
    const coupon = await resolveServerPurchaseCoupon({
      code: couponCode,
      userId: params.userId,
      termMonths,
    });
    couponDiscountBps = coupon.discountBps;
  }
  const requestHash = catalogCheckoutRequestHash({
    ...params,
    delivery,
    termMonths,
    couponCode,
  });
  const guestCredential = params.userId
    ? null
    : createCatalogGuestSessionCredential(params.idempotencyKey);
  const route = await prisma.infrastructurePlan.findUnique({
    where: { id: params.planId },
    select: {
      provider: true,
      providerApiVersion: true,
      productKind: true,
      offerSource: true,
      regionCode: true,
    },
  });
  if (
    !route ||
    route.productKind !== params.expectedProductKind ||
    route.providerApiVersion !== "v1"
  ) {
    throw new WalletError("quote_unavailable", "این انتخاب معتبر نیست.");
  }
  try {
    assertProviderRoute({
      productKind: route.productKind,
      provider: route.provider,
      apiVersion: route.providerApiVersion,
    });
  } catch {
    throw new WalletError("quote_unavailable", "این انتخاب معتبر نیست.");
  }
  assertPublicSaleEnabled(route);
  await requireRegionSaleEnabled(route);
  const existing = await prisma.recommendationSession.findUnique({
    where: {
      catalogCheckoutIdempotencyKey: params.idempotencyKey,
    },
    include: {
      quotes: {
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });
  if (existing) {
    if (
      existing.catalogCheckoutRequestHash !== requestHash ||
      existing.userId !== (params.userId ?? null)
    ) {
      throw new WalletError(
        "idempotency_conflict",
        "این شناسه برای درخواست دیگری استفاده شده است.",
      );
    }
    const quote = existing.quotes[0];
    if (!quote) throw new Error("catalog_quote_not_created");
    return {
      sessionId: existing.id,
      guestToken: guestCredential?.token ?? null,
      quote: toPublicRecommendationQuote(quote),
      expiresAt: quote.expiresAt,
    };
  }
  const termPricing = {
    termMonths,
    couponDiscountBps,
    couponCode,
  };
  const plan =
    params.expectedProductKind ===
    InfrastructureProductKind.READY_INSTANT_SERVER
      ? await getActiveReadyServerPlanById(params.planId, termPricing)
      : await getActivePlanById(params.planId, termPricing);
  if (!plan) {
    throw new WalletError(
      "quote_unavailable",
      "این سرور دیگر قیمت یا ظرفیت معتبر ندارد.",
    );
  }
  const locked = await lockAndRevalidatePlan(plan, delivery);

  const now = params.now ?? new Date();
  const expiresAt = new Date(now.getTime() + RECOMMENDATION_QUOTE_VALIDITY_MS);
  const profileSource =
    params.expectedProductKind ===
    InfrastructureProductKind.READY_INSTANT_SERVER
      ? READY_SERVER_PROFILE_SOURCE
      : CLOUD_SERVER_PROFILE_SOURCE;
  const profileSnapshot = {
    source: profileSource,
    planId: plan.id,
    regionCode: plan.regionCode,
    sizeCode: plan.sizeCode,
    imageCode: plan.imageCode,
    vcpu: plan.pricing.vcpu,
    ramGb: plan.pricing.ramGb,
    storageGb: plan.pricing.storageGb,
  } satisfies Prisma.InputJsonObject;
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`catalog:${params.idempotencyKey}`}, 0)
      )::text AS locked
    `;
    const repeated = await tx.recommendationSession.findUnique({
      where: {
        catalogCheckoutIdempotencyKey: params.idempotencyKey,
      },
      include: {
        quotes: {
          orderBy: { createdAt: "asc" },
          take: 1,
        },
      },
    });
    if (repeated) {
      if (
        repeated.catalogCheckoutRequestHash !== requestHash ||
        repeated.userId !== (params.userId ?? null)
      ) {
        throw new WalletError(
          "idempotency_conflict",
          "این شناسه برای درخواست دیگری استفاده شده است.",
        );
      }
      const quote = repeated.quotes[0];
      if (!quote) throw new Error("catalog_quote_not_created");
      return { session: repeated, quote };
    }
    const inventory =
      plan.offerSource === "PREPROVISIONED_INVENTORY"
        ? await lockAvailableInventoryTx(tx, {
            planId: plan.id,
            catalogItemId: plan.catalogItem.id,
            provider: plan.provider,
            apiVersion: plan.providerApiVersion,
            regionCode: plan.regionCode,
            externalPlanId:
              plan.catalogItem.externalPlanId ?? plan.sizeCode,
            externalImageId: locked.configuration.externalImageId,
            externalNetworkId: locked.configuration.externalNetworkId!,
            externalSecurityId: locked.configuration.externalSecurityId!,
            now,
          })
        : null;
    const effectiveConfiguration = {
      ...(inventory
        ? {
            ...locked.configuration,
            externalNetworkId: inventory.observedNetworkId,
            externalSecurityId: inventory.observedSecurityId,
            configuredAt: inventory.lastObservedAt.toISOString(),
          }
        : locked.configuration),
      serverName,
    };
    const created = await tx.recommendationSession.create({
      data: {
        userId: params.userId ?? null,
        guestAccessTokenHash: guestCredential?.hash ?? null,
        status: RecommendationFlowStatus.QUOTED,
        productFlowState: "DRAFT",
        catalogCheckoutIdempotencyKey: params.idempotencyKey,
        catalogCheckoutRequestHash: requestHash,
        answers: {
          source: profileSource,
          planId: plan.id,
        },
        answerSources: {},
        profile: profileSnapshot,
        confidence: "high",
        architectureEscalation: false,
        selectedParchinLevel: plan.pricing.parchinLevel,
        deliveryConfiguration:
          effectiveConfiguration as unknown as Prisma.InputJsonValue,
        expiresAt,
      },
    });
    await bootstrapCatalogCheckoutFlowTx(tx, {
      recommendationSessionId: created.id,
      idempotencyKey: `catalog-bootstrap:${params.idempotencyKey}`,
      actorUserId: params.userId ?? null,
      metadata: {
        planId: plan.id,
        productKind: plan.productKind,
        region: plan.regionCode,
        externalPlanId:
          plan.catalogItem.externalPlanId ?? plan.sizeCode,
        externalImageId: effectiveConfiguration.externalImageId,
        externalNetworkId: effectiveConfiguration.externalNetworkId,
        externalSecurityId: effectiveConfiguration.externalSecurityId,
        topologyVerificationMode:
          effectiveConfiguration.topologyVerificationMode,
        accessMethod: effectiveConfiguration.accessMethod,
      },
    });
    const bootstrapped = await tx.recommendationSession.findUniqueOrThrow({
      where: { id: created.id },
      select: { productFlowRevision: true },
    });
    const quoteId = randomUUID();
    const quote = await tx.recommendationQuote.create({
      data: {
        id: quoteId,
        sessionId: created.id,
        role: RecommendationQuoteRole.RECOMMENDED,
        status: RecommendationQuoteStatus.ACTIVE,
        planId: plan.id,
        score: 100,
        scoreBreakdown: {
          source: profileSource,
          liveCatalog:
            plan.offerSource !== "PREPROVISIONED_INVENTORY" &&
            plan.offerSource !== "MANUAL_ADMIN",
          inventoryReserved: Boolean(inventory),
        },
        reasons: [
          plan.offerSource === "PREPROVISIONED_INVENTORY"
            ? "یک سرور واقعی، سالم و تازه‌بررسی‌شده برای این Quote رزرو شده است."
            : plan.offerSource === "MANUAL_ADMIN"
              ? "قیمت و موجودی دستی این سرور برای Quote بررسی شده است."
            : "قیمت و ظرفیت همین سرور پیش از ساخت Quote دوباره بررسی شده است.",
          "منابع، موقعیت و سیستم‌عامل در Quote شصت‌دقیقه‌ای قفل شده‌اند.",
          "پرچین پایه بخشی اجباری از تحویل امن این سرور است.",
        ],
        profileSnapshot,
        planSnapshot: toPlanSnapshot(plan, {
          createdAt: now,
          expiresAt,
        }) as Prisma.InputJsonValue,
        amountRial: plan.pricing.finalPriceRial,
        renewalAmountRial: plan.pricing.renewalPriceRial,
        termMonths: plan.pricing.termMonths,
        termDiscountBps: plan.pricing.termDiscountBps,
        couponCodeSnapshot: couponCode,
        couponDiscountBpsSnapshot: couponDiscountBps,
        catalogItemId: plan.pricing.catalogItemId,
        providerBasePriceRialSnapshot:
          plan.pricing.providerBasePriceRial,
        markupBasisPointsSnapshot: plan.pricing.markupBasisPoints,
        finalPriceRialSnapshot: plan.pricing.finalPriceRial,
        currencySnapshot: plan.pricing.currency,
        providerPriceCheckedAt: locked.providerPriceCheckedAt,
        provider: plan.provider,
        providerApiVersion: plan.providerApiVersion,
        productKind: plan.productKind,
        providerRegion: plan.regionCode,
        externalPlanId:
          plan.catalogItem.externalPlanId ?? plan.sizeCode,
        externalImageId: effectiveConfiguration.externalImageId,
        externalNetworkId: effectiveConfiguration.externalNetworkId,
        externalSecurityId: effectiveConfiguration.externalSecurityId,
        vcpuSnapshot: plan.pricing.vcpu,
        ramMbSnapshot:
          plan.pricing.ramGb == null
            ? null
            : plan.pricing.ramGb * 1024,
        diskGbSnapshot: plan.pricing.storageGb,
        operatingSystemSnapshot: locked.configuration.operatingSystem,
        providerHourlyPriceIrr: locked.providerHourlyPriceIrr,
        providerMonthlyPriceIrr:
          plan.pricing.providerBasePriceRial,
        markupAmountIrr: plan.pricing.markupAmountRial,
        parchinLevel: plan.pricing.parchinLevel,
        parchinPriceIrr: plan.pricing.parchinPriceRial,
        parchinServiceSnapshot: await (async () => {
          const row = await tx.parchinPricingConfig.findUnique({
            where: { level: plan.pricing.parchinLevel },
          });
          if (!row) return undefined;
          const contract = toParchinServiceContract(row);
          return snapshotParchinServiceContract({
            ...contract,
            title: storefrontParchinTitleForLevel(plan.pricing.parchinLevel),
          });
        })(),
        providerAddonsSnapshot: [],
        deliveryConfigurationSnapshot:
          effectiveConfiguration as unknown as Prisma.InputJsonValue,
        taxBasisPointsSnapshot: plan.pricing.taxBasisPoints,
        taxAmountIrr: plan.pricing.taxAmountRial,
        lineItemsSnapshot: serializeQuoteLineItems(
          plan.pricing.lineItems,
        ),
        commercialEconomicsSnapshot:
          (plan.pricing.commercialEconomicsSnapshot as
            | Prisma.InputJsonValue
            | undefined) ?? undefined,
        quotedAt: now,
        catalogVersion: plan.catalogItem.catalogVersion,
        providerPayloadHash: plan.catalogItem.payloadHash,
        preprovisionedInventoryItemId: inventory?.id ?? null,
        expiresAt,
      },
    });
    if (inventory) {
      await reserveLockedInventoryForQuoteTx(tx, {
        inventoryItemId: inventory.id,
        quoteId: quote.id,
        revision: bootstrapped.productFlowRevision,
        expiresAt,
        now,
      });
    }
    return { session: created, quote };
  });

  return {
    sessionId: result.session.id,
    guestToken: guestCredential?.token ?? null,
    quote: toPublicRecommendationQuote(result.quote),
    expiresAt: result.quote.expiresAt,
  };
}

export async function createReadyServerQuote(params: {
  planId: string;
  delivery: CatalogDeliverySelection;
  idempotencyKey: string;
  userId?: string | null;
  now?: Date;
  termMonths?: 1 | 3 | 6 | 12;
  couponCode?: string | null;
}) {
  return createCatalogServerQuote({
    ...params,
    expectedProductKind:
      InfrastructureProductKind.READY_INSTANT_SERVER,
  });
}

export async function createCloudServerQuote(params: {
  planId: string;
  delivery: CatalogDeliverySelection;
  idempotencyKey: string;
  userId?: string | null;
  now?: Date;
  termMonths?: 1 | 3 | 6 | 12;
  couponCode?: string | null;
}) {
  return createCatalogServerQuote({
    ...params,
    expectedProductKind: InfrastructureProductKind.CLOUD_SERVER,
  });
}

export async function getCatalogServerDeliveryOptions(params: {
  planId: string;
  expectedProductKind: InfrastructureProductKind;
}) {
  const plan =
    params.expectedProductKind ===
    InfrastructureProductKind.READY_INSTANT_SERVER
      ? await getActiveReadyServerPlanById(params.planId)
      : await getActivePlanById(params.planId);
  if (!plan || plan.productKind !== params.expectedProductKind) {
    throw new WalletError("quote_unavailable", "این انتخاب معتبر نیست.");
  }
  assertProviderRoute({
    productKind: plan.productKind,
    provider: plan.provider,
    apiVersion: plan.providerApiVersion,
  });
  assertPublicSaleEnabled({
    provider: plan.provider,
    productKind: plan.productKind,
    offerSource: plan.offerSource,
  });
  if (plan.offerSource === "MANUAL_ADMIN") {
    const identity = normalizeCustomerImageIdentity({
      name: plan.imageCode,
      externalId: plan.imageCode,
    });
    const accessMethods = identity.windows
      ? (["WINDOWS_PASSWORD"] as const)
      : (["ONE_TIME_PASSWORD"] as const);
    return {
      planId: plan.id,
      region: plan.regionCode,
      defaultServerName: generateCustomerServerName(),
      sshSelfServeAvailable: false,
      images: [
        {
          id: `manual:${plan.id}`,
          label: identity.displayName,
          displayName: identity.displayName,
          distribution: identity.distribution,
          version: identity.version,
          architecture: identity.architecture,
          windows: identity.windows,
          accessMethods,
          defaultAccessMethod: accessMethods[0],
          sshSelectable: false,
        },
      ],
    };
  }
  const compatible = Array.isArray(plan.catalogItem.compatibleImageCodes)
    ? plan.catalogItem.compatibleImageCodes.filter(
        (code): code is string => typeof code === "string" && code.length > 0,
      )
    : [];
  const storedImages = await prisma.providerCatalogAsset.findMany({
    where: {
      provider: plan.provider,
      apiVersion: plan.providerApiVersion,
      regionCode: plan.regionCode,
      kind: "IMAGE",
      externalId: { in: compatible },
    },
    orderBy: { name: "asc" },
  });
  const storedByCode = new Map(
    storedImages.map((image) => [image.externalId, image]),
  );
  const seenLabels = new Set<string>();
  const images = compatible.flatMap((code) => {
    const stored = storedByCode.get(code) ?? null;
    const identity = normalizeCustomerImageIdentity({
      name: stored?.name ?? code,
      externalId: code,
      rawPayload: stored?.rawPayload,
    });
    if (seenLabels.has(identity.displayName)) return [];
    seenLabels.add(identity.displayName);
    const accessMethods = identity.windows
      ? (["WINDOWS_PASSWORD"] as const)
      : (["ONE_TIME_PASSWORD"] as const);
    return [{
      id: stored?.id ?? `catalog-code:${code}`,
      label: identity.displayName,
      displayName: identity.displayName,
      distribution: identity.distribution,
      version: identity.version,
      architecture: identity.architecture,
      windows: identity.windows,
      accessMethods: [...accessMethods],
      defaultAccessMethod: accessMethods[0],
      sshSelectable: false,
    }];
  });
  return {
    planId: plan.id,
    region: plan.regionCode,
    defaultServerName: generateCustomerServerName(),
    sshSelfServeAvailable: false,
    images,
  };
}

export async function createRecommendationQuotes(params: {
  userId?: string | null;
  now?: Date;
  includeComparisons?: boolean;
  sessionId?: string;
  guestToken?: string | null;
  requestedParchinLevel?: ParchinLevel;
  termMonths?: 1 | 3 | 6 | 12;
  couponCode?: string | null;
}) {
  if (!params.sessionId) {
    throw new Error("conversation_session_required");
  }
  const existingSession = await requireConversationAccess({
    sessionId: params.sessionId,
    userId: params.userId,
    guestToken: params.guestToken,
  });
  const initialFlowState = existingSession.productFlowState ?? "DRAFT";
  if (
    ![
      "DELIVERY_CONFIGURED",
      "QUOTED",
      "QUOTE_EXPIRED",
    ].includes(initialFlowState)
  ) {
    throw new Error("conversation_requirements_not_confirmed");
  }
  // Recommendation always draws from live AbrChin catalog (Arvan + ParsPack).
  await Promise.allSettled([
    requireFreshCatalog(InfrastructureProvider.ARVAN),
    requireFreshCatalog(InfrastructureProvider.PARSPACK),
  ]);
  const lockedConfiguration = parseLockedDeliveryConfiguration(
    existingSession.deliveryConfiguration,
  );
  if (!lockedConfiguration || !existingSession.selectedParchinLevel) {
    throw new Error("conversation_delivery_not_configured");
  }
  const now = params.now ?? new Date();
  const expiresAt = new Date(
    now.getTime() + RECOMMENDATION_QUOTE_VALIDITY_MS,
  );
  const authoritativeAnswers = sessionAnswers(existingSession.answers);
  const authoritativeSources = sessionSources(
    existingSession.answerSources,
  );
  const recommendation = buildRecommendation(
    authoritativeAnswers,
    authoritativeSources,
  );
  const minimumParchinLevel = recommendedParchinLevel(
    authoritativeAnswers,
  );
  const selectedParchinLevel =
    params.requestedParchinLevel ??
    existingSession.selectedParchinLevel;
  assertParchinLevelAllowed(selectedParchinLevel, minimumParchinLevel);
  if (selectedParchinLevel !== existingSession.selectedParchinLevel) {
    throw new Error("conversation_delivery_not_configured");
  }

  const assistedNotice = recommendation.architectureEscalation
    ? "این نیاز همراهی معماری/مهاجرت هم می‌خواهد؛ با این حال یک سرور واقعی از فهرست ابرچین هم پیشنهاد می‌شود."
    : null;

  const termMonths = isBillingTermMonths(params.termMonths)
    ? params.termMonths
    : 1;
  const couponCode = normalizeCouponCode(params.couponCode);
  let couponDiscountBps: number | null = null;
  if (couponCode) {
    const coupon = await resolveServerPurchaseCoupon({
      code: couponCode,
      userId: params.userId,
      termMonths,
      now,
    });
    couponDiscountBps = coupon.discountBps;
  }
  const termPricing = {
    termMonths,
    couponDiscountBps,
    couponCode,
  };

  const plans = await listActivePlans(selectedParchinLevel);
  const candidates = selectQuotes(recommendation, plans, now, expiresAt, {
    budget: authoritativeAnswers.budget,
  });
  const configuredCandidate = candidates.find(
    ({ plan }) => plan.id === lockedConfiguration.planId,
  );
  if (!configuredCandidate) {
    throw new WalletError(
      "quote_unavailable",
      "چینش انتخاب‌شده دیگر حداقل‌های این نیاز را پوشش نمی‌دهد.",
    );
  }
  const pricedConfigured = await getActivePlanById(
    configuredCandidate.plan.id,
    termPricing,
  );
  if (!pricedConfigured) {
    throw new WalletError(
      "quote_unavailable",
      "چینش انتخاب‌شده دیگر قابل فروش نیست.",
    );
  }
  const configuredPlan = pricedConfigured;
  const current = await revalidateLockedSelection({
    provider: lockedConfiguration.provider,
    providerApiVersion: lockedConfiguration.providerApiVersion,
    productKind: lockedConfiguration.productKind,
    region: lockedConfiguration.region,
    externalPlanId: lockedConfiguration.externalPlanId,
    externalImageId: lockedConfiguration.externalImageId,
    externalNetworkId: lockedConfiguration.externalNetworkId,
    externalSecurityId: lockedConfiguration.externalSecurityId,
  });
  if (
    current.monthlyPriceIrr !==
      configuredPlan.pricing.providerBasePriceRial ||
    current.hourlyPriceIrr !==
      configuredPlan.catalogItem.providerHourlyPriceIrr ||
    current.currency !== configuredPlan.pricing.currency
  ) {
    throw new WalletError(
      "quote_revalidation_failed",
      "قیمت یا ظرفیت انتخاب تغییر کرده است؛ Quote تازه دریافت کن.",
    );
  }
  const lockedServerName =
    normalizeCustomerServerName(
      lockedConfiguration &&
        typeof (lockedConfiguration as unknown as { serverName?: string })
          .serverName === "string"
        ? (lockedConfiguration as unknown as { serverName: string }).serverName
        : null,
    ) ?? generateCustomerServerName();
  const main = {
    ...configuredCandidate,
    plan: configuredPlan,
    role: "RECOMMENDED" as const,
    configuration: lockedConfiguration,
    providerPriceCheckedAt: current.checkedAt,
    providerHourlyPriceIrr: current.hourlyPriceIrr,
  };
  const comparisons = params.includeComparisons
    ? candidates
        .filter(
          ({ plan }) =>
            plan.id !== configuredPlan.id &&
            plan.regionCode === configuredPlan.regionCode &&
            typeof lockedConfiguration.imageAssetId === "string",
        )
        .slice(0, 2)
    : [];
  const validatedComparisons = await Promise.allSettled(
    comparisons.map(async (selected) => {
      const priced = await getActivePlanById(selected.plan.id, termPricing);
      if (!priced) throw new WalletError("quote_unavailable", "پلن در دسترس نیست.");
      return {
        ...selected,
        plan: priced,
        ...(await lockAndRevalidatePlan(priced, {
          imageAssetId: lockedConfiguration.imageAssetId!,
          accessMethod: lockedConfiguration.accessMethod,
          sshKeyName: lockedConfiguration.sshKeyName,
          serverName: lockedServerName,
        })),
      };
    }),
  );
  const selected = [
    main,
    ...validatedComparisons.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    ),
  ];
  const status =
    selected.length > 0
      ? RecommendationFlowStatus.QUOTED
      : RecommendationFlowStatus.READY_TO_COMPARE;
  const session = await prisma.$transaction(async (tx) => {
    await tx.recommendationQuote.updateMany({
      where: {
        sessionId: existingSession.id,
        status: {
          in: [
            RecommendationQuoteStatus.ACTIVE,
            RecommendationQuoteStatus.SELECTED,
          ],
        },
      },
      data: { status: RecommendationQuoteStatus.INVALIDATED },
    });
    await tx.recommendationSession.update({
      where: { id: existingSession.id },
      data: {
      userId: params.userId ?? null,
      status,
      answers: authoritativeAnswers as Prisma.InputJsonValue,
      answerSources: authoritativeSources as Prisma.InputJsonValue,
      profile: {
        ...recommendation.profile,
        workloadClassification: recommendation.workloadClassification,
      } as Prisma.InputJsonValue,
      confidence: recommendation.confidence,
      architectureEscalation: recommendation.architectureEscalation,
      expiresAt,
      revision: { increment: 1 },
      },
    });

    let currentState = initialFlowState as ProductFlowTransitionInput["from"];
    if (currentState !== "DELIVERY_CONFIGURED") {
      await transitionProductFlowTx(tx, {
        owner: { recommendationSessionId: existingSession.id },
        from: currentState,
        to: "DELIVERY_CONFIGURED",
        reason: "configured_selection_requoted",
        idempotencyKey: `quote-reconfigure:${existingSession.id}:${existingSession.revision + 1}`,
        actorUserId: params.userId ?? null,
      });
      currentState = "DELIVERY_CONFIGURED";
    }
    await transitionProductFlowTx(tx, {
      owner: { recommendationSessionId: existingSession.id },
      from: currentState,
      to: "QUOTED",
      reason: "configured_selection_quoted",
      idempotencyKey: `quote-flow:${existingSession.id}:${existingSession.revision + 1}`,
      actorUserId: params.userId ?? null,
      metadata: {
        planId: main.plan.id,
        imageId: main.configuration.externalImageId,
      },
    });

    if (selected.length > 0) {
      const parchinLevels = [
        ...new Set(selected.map(({ plan }) => plan.pricing.parchinLevel)),
      ];
      const parchinRows = await tx.parchinPricingConfig.findMany({
        where: { level: { in: parchinLevels } },
      });
      const parchinSnapshotByLevel = new Map(
        parchinRows.map((row) => [
          row.level,
          snapshotParchinServiceContract(toParchinServiceContract(row)),
        ]),
      );
      await tx.recommendationQuote.createMany({
        data: selected.map(
          ({
            role,
            profile,
            rankedOffer,
            plan,
            configuration,
            providerPriceCheckedAt,
            providerHourlyPriceIrr,
          }) => ({
          role,
          status: RecommendationQuoteStatus.ACTIVE,
          sessionId: existingSession.id,
          planId: plan.id,
          score: rankedOffer.score,
          scoreBreakdown: rankedOffer.scoreBreakdown as Prisma.InputJsonValue,
          reasons: quoteReasons(role, recommendation, rankedOffer),
          profileSnapshot: {
            ...profile,
            workloadClassification: recommendation.workloadClassification,
          } as Prisma.InputJsonValue,
          planSnapshot: toPlanSnapshot(plan, { createdAt: now, expiresAt }) as Prisma.InputJsonValue,
          amountRial: plan.pricing.finalPriceRial,
          renewalAmountRial: plan.pricing.renewalPriceRial,
          termMonths: plan.pricing.termMonths,
          termDiscountBps: plan.pricing.termDiscountBps,
          couponCodeSnapshot: couponCode,
          couponDiscountBpsSnapshot: couponDiscountBps,
          catalogItemId: plan.pricing.catalogItemId,
          providerBasePriceRialSnapshot: plan.pricing.providerBasePriceRial,
          markupBasisPointsSnapshot: plan.pricing.markupBasisPoints,
          finalPriceRialSnapshot: plan.pricing.finalPriceRial,
          currencySnapshot: plan.pricing.currency,
          providerPriceCheckedAt,
          provider: plan.provider,
          providerApiVersion: plan.providerApiVersion,
          productKind: plan.productKind,
          providerRegion: plan.regionCode,
          externalPlanId:
            plan.catalogItem.externalPlanId ?? plan.sizeCode,
          externalImageId: configuration.externalImageId,
          externalNetworkId: configuration.externalNetworkId,
          externalSecurityId: configuration.externalSecurityId,
          vcpuSnapshot: plan.pricing.vcpu,
          ramMbSnapshot:
            plan.pricing.ramGb == null ? null : plan.pricing.ramGb * 1024,
          diskGbSnapshot: plan.pricing.storageGb,
          operatingSystemSnapshot: configuration.operatingSystem,
          providerHourlyPriceIrr,
          providerMonthlyPriceIrr: plan.pricing.providerBasePriceRial,
          markupAmountIrr: plan.pricing.markupAmountRial,
          parchinLevel: plan.pricing.parchinLevel,
          parchinPriceIrr: plan.pricing.parchinPriceRial,
          parchinServiceSnapshot:
            parchinSnapshotByLevel.get(plan.pricing.parchinLevel),
          providerAddonsSnapshot: [],
          deliveryConfigurationSnapshot:
            configuration as unknown as Prisma.InputJsonValue,
          taxBasisPointsSnapshot: plan.pricing.taxBasisPoints,
          taxAmountIrr: plan.pricing.taxAmountRial,
          lineItemsSnapshot: serializeQuoteLineItems(
            plan.pricing.lineItems,
          ),
          commercialEconomicsSnapshot:
            (plan.pricing.commercialEconomicsSnapshot as
              | Prisma.InputJsonValue
              | undefined) ?? undefined,
          quotedAt: now,
          catalogVersion: plan.catalogItem.catalogVersion,
          providerPayloadHash: plan.catalogItem.payloadHash,
          expiresAt,
          }),
        ),
      });
    }
    return tx.recommendationSession.findUniqueOrThrow({
      where: { id: existingSession.id },
      include: {
      quotes: {
        where: {
          status: RecommendationQuoteStatus.ACTIVE,
          createdAt: { gte: now },
        },
      },
      },
    });
  });
  const capacityNotice =
    selected.length === 0
      ? recommendation.profile.backupPolicy === "DAILY"
        ? "نیازت بکاپ واقعی می‌خواهد، اما هیچ پلن فعال فعلی این قابلیت را به‌طور قابل اثبات پوشش نمی‌دهد؛ خرید خودکار متوقف شد."
        : "هیچ ظرفیت فعالی همه‌ی حداقل‌های این پیشنهاد را پوشش نمی‌دهد؛ برای کم‌کردن منابع یا بررسی دستی ادامه بده."
      : selected.length < 3
        ? `فعلاً فقط ${selected.length.toLocaleString("fa-IR")} چینش معتبر همه‌ی حداقل‌ها را پوشش می‌دهد.`
        : null;
  const quoteNotice = [assistedNotice, capacityNotice]
    .filter(Boolean)
    .join(" ");

  const {
    listCompassServicePackages,
    selectCompassServicePackages,
    serializeCompassServicePackages,
  } = await import("@/lib/recommendation/service-packages");
  const allServices = await listCompassServicePackages();
  const servicePackages = serializeCompassServicePackages(
    selectCompassServicePackages(
      authoritativeAnswers,
      allServices,
      recommendation.architectureEscalation,
    ),
  );

  return {
    sessionId: session.id,
    recommendation,
    quotes: session.quotes
      .filter(
        (quote) =>
          params.includeComparisons ||
          quote.role === RecommendationQuoteRole.RECOMMENDED,
      )
      .map(toPublicRecommendationQuote),
    quoteNotice,
    servicePackages,
    expiresAt,
  };
}

export async function getActiveRecommendationQuote(
  id: string,
  userId?: string | null,
  guestToken?: string | null,
  now = new Date(),
) {
  const quote = await prisma.recommendationQuote.findFirst({
    where: {
      id,
      status: { in: [RecommendationQuoteStatus.ACTIVE, RecommendationQuoteStatus.SELECTED] },
      expiresAt: { gt: now },
      plan: {
        active: true,
        publicationStatus: "PUBLISHED",
        catalogMappingStatus: "MAPPED",
        deliveryMode: "MANAGED",
        parchinIncluded: true,
      },
    },
    include: { plan: true, session: true, serviceOrder: true },
  });
  if (!quote) return null;
  if (
    !isPublicSaleEnabled({
      provider: quote.plan.provider,
      productKind: quote.plan.productKind,
      offerSource: quote.plan.offerSource,
    })
  ) {
    return null;
  }
  try {
    await requireRegionSaleEnabled(quote.plan);
  } catch {
    return null;
  }
  try {
    await requireConversationAccess({
      sessionId: quote.sessionId,
      userId,
      guestToken,
    });
    return quote;
  } catch {
    return null;
  }
}

export async function getActiveReadyServerQuote(
  id: string,
  userId?: string | null,
  guestToken?: string | null,
  now = new Date(),
) {
  const quote = await getActiveRecommendationQuote(
    id,
    userId,
    guestToken,
    now,
  );
  return quote && isReadyServerProfile(quote.session.profile) ? quote : null;
}

export async function getActiveCloudServerQuote(
  id: string,
  userId?: string | null,
  guestToken?: string | null,
  now = new Date(),
) {
  const quote = await getActiveRecommendationQuote(
    id,
    userId,
    guestToken,
    now,
  );
  return quote && isCloudServerProfile(quote.session.profile) ? quote : null;
}

/**
 * Read-only ownership lookup for expired/invalid quotes.
 * Used to render an explicit refresh CTA — never mutates.
 */
export async function getOwnedRecommendationQuote(
  id: string,
  userId?: string | null,
  guestToken?: string | null,
) {
  const quote = await prisma.recommendationQuote.findUnique({
    where: { id },
    include: { plan: true, session: true, serviceOrder: true },
  });
  if (!quote) return null;
  try {
    await requireConversationAccess({
      sessionId: quote.sessionId,
      userId,
      guestToken,
    });
    return quote;
  } catch {
    return null;
  }
}

export async function refreshRecommendationQuote(params: {
  quoteId: string;
  userId: string;
}) {
  const previous = await prisma.recommendationQuote.findUnique({
    where: { id: params.quoteId },
    include: { session: true },
  });
  if (
    !previous ||
    (previous.session.userId != null && previous.session.userId !== params.userId)
  ) {
    throw new Error("quote_not_found");
  }
  let replacement: PublicRecommendationQuote | null = null;
  if (isReadyServerProfile(previous.session.profile)) {
    const delivery = previous.deliveryConfigurationSnapshot as
      | Record<string, unknown>
      | null;
    if (
      !delivery ||
      typeof delivery.imageAssetId !== "string" ||
      !["ONE_TIME_PASSWORD", "SSH_KEY", "WINDOWS_PASSWORD"].includes(
        String(delivery.accessMethod),
      )
    ) {
      throw new Error("delivery_configuration_required");
    }
    replacement = (
      await createReadyServerQuote({
        planId: previous.planId,
        userId: params.userId,
        idempotencyKey: `quote-refresh:${previous.id}`,
        delivery: {
          imageAssetId: delivery.imageAssetId,
          accessMethod: delivery.accessMethod as
            | "ONE_TIME_PASSWORD"
            | "SSH_KEY"
            | "WINDOWS_PASSWORD",
          serverName:
            typeof delivery.serverName === "string"
              ? delivery.serverName
              : "abrchin-server",
          sshKeyName:
            typeof delivery.sshKeyName === "string"
              ? delivery.sshKeyName
              : null,
        },
      })
    ).quote;
  }
  if (isCloudServerProfile(previous.session.profile)) {
    const delivery = previous.deliveryConfigurationSnapshot as
      | Record<string, unknown>
      | null;
    if (
      !delivery ||
      typeof delivery.imageAssetId !== "string" ||
      !["ONE_TIME_PASSWORD", "SSH_KEY", "WINDOWS_PASSWORD"].includes(
        String(delivery.accessMethod),
      )
    ) {
      throw new Error("delivery_configuration_required");
    }
    replacement = (
      await createCloudServerQuote({
        planId: previous.planId,
        userId: params.userId,
        idempotencyKey: `quote-refresh:${previous.id}`,
        delivery: {
          imageAssetId: delivery.imageAssetId,
          accessMethod: delivery.accessMethod as
            | "ONE_TIME_PASSWORD"
            | "SSH_KEY"
            | "WINDOWS_PASSWORD",
          serverName:
            typeof delivery.serverName === "string"
              ? delivery.serverName
              : "abrchin-server",
          sshKeyName:
            typeof delivery.sshKeyName === "string"
              ? delivery.sshKeyName
              : null,
        },
      })
    ).quote;
  }
  if (!replacement) {
    const refreshed = await createRecommendationQuotes({
      userId: params.userId,
      sessionId: previous.session.id,
    });
    replacement =
      refreshed.quotes.find((quote) => quote.role === previous.role) ??
      refreshed.quotes.find((quote) => quote.role === "RECOMMENDED") ??
      refreshed.quotes[0] ??
      null;
  }
  await prisma.recommendationQuote.updateMany({
    where: {
      id: previous.id,
      status: {
        in: [
          RecommendationQuoteStatus.ACTIVE,
          RecommendationQuoteStatus.SELECTED,
        ],
      },
    },
    data: { status: RecommendationQuoteStatus.INVALIDATED },
  });
  return replacement;
}
