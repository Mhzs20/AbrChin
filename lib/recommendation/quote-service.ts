import {
  InfrastructureProductKind,
  InfrastructureProvider,
  ParchinLevel,
  RecommendationFlowStatus,
  RecommendationQuoteRole,
  RecommendationQuoteStatus,
  type Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  getActivePlanById,
  getActiveReadyServerPlanById,
  listActivePlans,
  toPlanSnapshot,
  type PricedInfrastructurePlan,
} from "@/lib/orders/plans";
import { refreshProviderCatalogForPricing } from "@/lib/infrastructure/catalog-service";
import { refreshMultiProviderCatalog } from "@/lib/infrastructure/multi-provider-catalog-service";
import { assertProviderRoute } from "@/lib/infrastructure/provider-routing";
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
import { requireConversationAccess } from "@/lib/recommendation/session-service";
import {
  assertParchinLevelAllowed,
  recommendedParchinLevel,
} from "@/lib/parchin/recommendation";

export const RECOMMENDATION_QUOTE_VALIDITY_MS = 10 * 60 * 1000;
const READY_SERVER_PROFILE_SOURCE = "READY_SERVER";
const CLOUD_SERVER_PROFILE_SOURCE = "CLOUD_SERVER";

export { recommendedParchinLevel } from "@/lib/parchin/recommendation";

type SelectedQuote = {
  role: RecommendationOfferRole;
  profile: ResourceProfile;
  rankedOffer: RankedProviderOffer;
  plan: PricedInfrastructurePlan;
};

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
    // Parchin Base controls delivery and credentials. It must not be treated as
    // a scheduled backup product until a real backup capability is connected.
    supportsBackup: false,
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

function selectQuotes(
  recommendation: RecommendationResult,
  plans: PricedInfrastructurePlan[],
  now: Date,
  expiresAt: Date,
): SelectedQuote[] {
  const offers = plans
    .map((plan) => planToProviderOffer(plan, now, expiresAt))
    .filter((offer): offer is ProviderOffer => Boolean(offer));
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const usedPlanIds = new Set<string>();
  const selected: SelectedQuote[] = [];

  for (const selection of selections) {
    const profile = adjustRecommendationProfile(recommendation, selection.direction);
    const { ranked } = rankProviderOffers(profile, offers, now);
    const rankedOffer = ranked.find((offer) => !usedPlanIds.has(offer.planId));
    if (!rankedOffer) continue;

    const plan = planById.get(rankedOffer.planId);
    if (!plan) continue;

    usedPlanIds.add(plan.id);
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
}): PublicRecommendationQuote {
  const snapshot = quote.planSnapshot as Record<string, unknown>;
  const reasons = Array.isArray(quote.reasons)
    ? quote.reasons.filter((reason): reason is string => typeof reason === "string")
    : [];

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

async function createCatalogServerQuote(params: {
  planId: string;
  userId?: string | null;
  now?: Date;
  expectedProductKind: InfrastructureProductKind;
}) {
  const route = await prisma.infrastructurePlan.findUnique({
    where: { id: params.planId },
    select: { provider: true, providerApiVersion: true, productKind: true },
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
  if (route.provider === InfrastructureProvider.ARVAN) {
    await refreshMultiProviderCatalog(InfrastructureProvider.ARVAN);
  } else {
    await refreshProviderCatalogForPricing();
  }
  const plan =
    params.expectedProductKind ===
    InfrastructureProductKind.READY_INSTANT_SERVER
      ? await getActiveReadyServerPlanById(params.planId)
      : await getActivePlanById(params.planId);
  if (!plan) {
    throw new WalletError(
      "quote_unavailable",
      "این سرور دیگر قیمت یا ظرفیت معتبر ندارد.",
    );
  }

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
  const session = await prisma.recommendationSession.create({
    data: {
      userId: params.userId ?? null,
      status: RecommendationFlowStatus.QUOTED,
      productFlowState: "QUOTED",
      answers: {
        source: profileSource,
        planId: plan.id,
      },
      answerSources: {},
      profile: profileSnapshot,
      confidence: "high",
      architectureEscalation: false,
      expiresAt,
      quotes: {
        create: {
          role: RecommendationQuoteRole.RECOMMENDED,
          status: RecommendationQuoteStatus.ACTIVE,
          planId: plan.id,
          score: 100,
          scoreBreakdown: {
            source: profileSource,
            liveCatalog: true,
          },
          reasons: [
            "قیمت و ظرفیت همین سرور پیش از ساخت Quote دوباره بررسی شده است.",
            "منابع، موقعیت و سیستم‌عامل در Quote ده‌دقیقه‌ای قفل شده‌اند.",
            "پرچین پایه بخشی اجباری از تحویل امن این سرور است.",
          ],
          profileSnapshot,
          planSnapshot: toPlanSnapshot(plan, {
            createdAt: now,
            expiresAt,
          }) as Prisma.InputJsonValue,
          amountRial: plan.pricing.finalPriceRial,
          renewalAmountRial: plan.pricing.finalPriceRial,
          catalogItemId: plan.pricing.catalogItemId,
          providerBasePriceRialSnapshot: plan.pricing.providerBasePriceRial,
          markupBasisPointsSnapshot: plan.pricing.markupBasisPoints,
          finalPriceRialSnapshot: plan.pricing.finalPriceRial,
          currencySnapshot: plan.pricing.currency,
          providerPriceCheckedAt: plan.pricing.providerPriceCheckedAt,
          provider: plan.provider,
          providerApiVersion: plan.providerApiVersion,
          productKind: plan.productKind,
          providerRegion: plan.regionCode,
          externalPlanId:
            plan.catalogItem.externalPlanId ?? plan.sizeCode,
          externalImageId: plan.imageCode,
          vcpuSnapshot: plan.pricing.vcpu,
          ramMbSnapshot:
            plan.pricing.ramGb == null ? null : plan.pricing.ramGb * 1024,
          diskGbSnapshot: plan.pricing.storageGb,
          operatingSystemSnapshot: plan.imageCode,
          providerHourlyPriceIrr:
            plan.catalogItem.providerHourlyPriceIrr,
          providerMonthlyPriceIrr: plan.pricing.providerBasePriceRial,
          markupAmountIrr: plan.pricing.markupAmountRial,
          parchinLevel: plan.pricing.parchinLevel,
          parchinPriceIrr: plan.pricing.parchinPriceRial,
          providerAddonsSnapshot: [],
          taxBasisPointsSnapshot: plan.pricing.taxBasisPoints,
          taxAmountIrr: plan.pricing.taxAmountRial,
          lineItemsSnapshot: serializeQuoteLineItems(
            plan.pricing.lineItems,
          ),
          quotedAt: now,
          catalogVersion: plan.catalogItem.catalogVersion,
          providerPayloadHash: plan.catalogItem.payloadHash,
          expiresAt,
        },
      },
    },
    include: { quotes: true },
  });
  const quote = session.quotes[0];
  if (!quote) throw new Error("ready_server_quote_not_created");

  return {
    sessionId: session.id,
    quote: toPublicRecommendationQuote(quote),
    expiresAt,
  };
}

export async function createReadyServerQuote(params: {
  planId: string;
  userId?: string | null;
  now?: Date;
}) {
  return createCatalogServerQuote({
    ...params,
    expectedProductKind:
      InfrastructureProductKind.READY_INSTANT_SERVER,
  });
}

export async function createCloudServerQuote(params: {
  planId: string;
  userId?: string | null;
  now?: Date;
}) {
  return createCatalogServerQuote({
    ...params,
    expectedProductKind: InfrastructureProductKind.CLOUD_SERVER,
  });
}

export async function createRecommendationQuotes(params: {
  answers: RecommendationAnswers;
  sources: AnswerSources;
  userId?: string | null;
  now?: Date;
  includeComparisons?: boolean;
  sessionId?: string;
  guestToken?: string | null;
  requestedParchinLevel?: ParchinLevel;
}) {
  if (!params.sessionId) {
    throw new Error("conversation_session_required");
  }
  await refreshMultiProviderCatalog(InfrastructureProvider.ARVAN);
  const now = params.now ?? new Date();
  const expiresAt = new Date(now.getTime() + RECOMMENDATION_QUOTE_VALIDITY_MS);
  const recommendation = buildRecommendation(params.answers, params.sources);
  const minimumParchinLevel = recommendedParchinLevel(params.answers);
  const selectedParchinLevel =
    params.requestedParchinLevel ?? minimumParchinLevel;
  assertParchinLevelAllowed(selectedParchinLevel, minimumParchinLevel);
  const plans = await listActivePlans(selectedParchinLevel);
  const existingSession = await requireConversationAccess({
    sessionId: params.sessionId,
    userId: params.userId,
    guestToken: params.guestToken,
  });
  if (
    !["REQUIREMENTS_COMPLETE", "QUOTED", "QUOTE_EXPIRED"].includes(
      existingSession.productFlowState ?? "",
    )
  ) {
    throw new Error("conversation_requirements_not_confirmed");
  }

  if (recommendation.architectureEscalation) {
    const sessionData = {
        userId: params.userId ?? null,
        status: RecommendationFlowStatus.ESCALATED,
        productFlowState: "REQUIREMENTS_COMPLETE",
        answers: params.answers as Prisma.InputJsonValue,
        answerSources: params.sources as Prisma.InputJsonValue,
        profile: {
          ...recommendation.profile,
          workloadClassification: recommendation.workloadClassification,
        } as Prisma.InputJsonValue,
        confidence: recommendation.confidence,
        architectureEscalation: true,
        expiresAt,
      };
    const session = await prisma.recommendationSession.update({
      where: { id: existingSession.id },
      data: sessionData,
    });
    return {
      sessionId: session.id,
      recommendation,
      quotes: [],
      quoteNotice:
        "این نیاز از خرید خودکار یک سرور عبور کرده؛ پاسخ‌ها حفظ شدند تا معماری و مسیر بازگشت با همراهی بررسی شوند.",
      expiresAt,
    };
  }

  const selected = selectQuotes(recommendation, plans, now, expiresAt);
  const status =
    selected.length > 0
      ? RecommendationFlowStatus.QUOTED
      : RecommendationFlowStatus.READY_TO_COMPARE;

  await prisma.recommendationQuote.updateMany({
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
  const sessionData = {
      userId: params.userId ?? null,
      status,
      productFlowState:
        selected.length > 0 ? "QUOTED" : "REQUIREMENTS_COMPLETE",
      answers: params.answers as Prisma.InputJsonValue,
      answerSources: params.sources as Prisma.InputJsonValue,
      profile: {
        ...recommendation.profile,
        workloadClassification: recommendation.workloadClassification,
      } as Prisma.InputJsonValue,
      confidence: recommendation.confidence,
      architectureEscalation: false,
      expiresAt,
      quotes: {
        create: selected.map(({ role, profile, rankedOffer, plan }) => ({
          role,
          status: RecommendationQuoteStatus.ACTIVE,
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
          renewalAmountRial: plan.pricing.finalPriceRial,
          catalogItemId: plan.pricing.catalogItemId,
          providerBasePriceRialSnapshot: plan.pricing.providerBasePriceRial,
          markupBasisPointsSnapshot: plan.pricing.markupBasisPoints,
          finalPriceRialSnapshot: plan.pricing.finalPriceRial,
          currencySnapshot: plan.pricing.currency,
          providerPriceCheckedAt: plan.pricing.providerPriceCheckedAt,
          provider: plan.provider,
          providerApiVersion: plan.providerApiVersion,
          productKind: plan.productKind,
          providerRegion: plan.regionCode,
          externalPlanId:
            plan.catalogItem.externalPlanId ?? plan.sizeCode,
          externalImageId: plan.imageCode,
          vcpuSnapshot: plan.pricing.vcpu,
          ramMbSnapshot:
            plan.pricing.ramGb == null ? null : plan.pricing.ramGb * 1024,
          diskGbSnapshot: plan.pricing.storageGb,
          operatingSystemSnapshot: plan.imageCode,
          providerHourlyPriceIrr:
            plan.catalogItem.providerHourlyPriceIrr,
          providerMonthlyPriceIrr: plan.pricing.providerBasePriceRial,
          markupAmountIrr: plan.pricing.markupAmountRial,
          parchinLevel: plan.pricing.parchinLevel,
          parchinPriceIrr: plan.pricing.parchinPriceRial,
          providerAddonsSnapshot: [],
          taxBasisPointsSnapshot: plan.pricing.taxBasisPoints,
          taxAmountIrr: plan.pricing.taxAmountRial,
          lineItemsSnapshot: serializeQuoteLineItems(
            plan.pricing.lineItems,
          ),
          quotedAt: now,
          catalogVersion: plan.catalogItem.catalogVersion,
          providerPayloadHash: plan.catalogItem.payloadHash,
          expiresAt,
        })),
      },
    };
  const session = await prisma.recommendationSession.update({
    where: { id: existingSession.id },
    data: sessionData,
    include: {
      quotes: {
        where: {
          status: RecommendationQuoteStatus.ACTIVE,
          createdAt: { gte: now },
        },
      },
    },
  });
  if (
    selected.length > 0 &&
    existingSession.productFlowState === "REQUIREMENTS_COMPLETE"
  ) {
    const flow = [
      ["REQUIREMENTS_COMPLETE", "RECOMMENDED"],
      ["RECOMMENDED", "PARCHIN_SELECTED"],
      ["PARCHIN_SELECTED", "DELIVERY_CONFIGURED"],
      ["DELIVERY_CONFIGURED", "QUOTED"],
    ] as const;
    await prisma.productFlowTransition.createMany({
      data: flow.map(([fromState, toState], index) => ({
        recommendationSessionId: existingSession.id,
        fromState,
        toState,
        reason: "recommendation_quote_created",
        idempotencyKey: `quote-flow:${existingSession.id}:${now.getTime()}:${index}`,
      })),
    });
  }
  const quoteNotice =
    selected.length === 0
      ? recommendation.profile.backupPolicy === "DAILY"
        ? "نیازت بکاپ واقعی می‌خواهد، اما هیچ پلن فعال فعلی این قابلیت را به‌طور قابل اثبات پوشش نمی‌دهد؛ خرید خودکار متوقف شد."
        : "هیچ ظرفیت فعالی همه‌ی حداقل‌های این پیشنهاد را پوشش نمی‌دهد؛ برای کم‌کردن منابع یا بررسی دستی ادامه بده."
      : selected.length < 3
        ? `فعلاً فقط ${selected.length.toLocaleString("fa-IR")} چینش معتبر همه‌ی حداقل‌ها را پوشش می‌دهد.`
        : null;

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
    expiresAt,
  };
}

export async function getActiveRecommendationQuote(
  id: string,
  userId?: string | null,
  now = new Date(),
) {
  return prisma.recommendationQuote.findFirst({
    where: {
      id,
      status: { in: [RecommendationQuoteStatus.ACTIVE, RecommendationQuoteStatus.SELECTED] },
      expiresAt: { gt: now },
      plan: {
        active: true,
        deliveryMode: "MANAGED",
        parchinIncluded: true,
      },
      session: userId
        ? {
            OR: [{ userId }, { userId: null }],
          }
        : { userId: null },
    },
    include: { plan: true, session: true, serviceOrder: true },
  });
}

export async function getActiveReadyServerQuote(
  id: string,
  userId?: string | null,
  now = new Date(),
) {
  const quote = await getActiveRecommendationQuote(id, userId, now);
  return quote && isReadyServerProfile(quote.session.profile) ? quote : null;
}

export async function getActiveCloudServerQuote(
  id: string,
  userId?: string | null,
  now = new Date(),
) {
  const quote = await getActiveRecommendationQuote(id, userId, now);
  return quote && isCloudServerProfile(quote.session.profile) ? quote : null;
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
    replacement = (
      await createReadyServerQuote({
        planId: previous.planId,
        userId: params.userId,
      })
    ).quote;
  }
  if (isCloudServerProfile(previous.session.profile)) {
    replacement = (
      await createCloudServerQuote({
        planId: previous.planId,
        userId: params.userId,
      })
    ).quote;
  }
  if (!replacement) {
    const refreshed = await createRecommendationQuotes({
      answers: previous.session.answers as unknown as RecommendationAnswers,
      sources: previous.session.answerSources as unknown as AnswerSources,
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
