import {
  RecommendationFlowStatus,
  RecommendationQuoteRole,
  RecommendationQuoteStatus,
  type Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  listActivePlans,
  toPlanSnapshot,
  type PricedInfrastructurePlan,
} from "@/lib/orders/plans";
import { refreshProviderCatalogForPricing } from "@/lib/infrastructure/catalog-service";
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

export const RECOMMENDATION_QUOTE_VALIDITY_MS = 10 * 60 * 1000;

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
    deliveryMode: snapshot.deliveryMode === "MANAGED" ? "MANAGED" : "RAW",
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
    reasons,
    expiresAt: quote.expiresAt.toISOString(),
  };
}

export async function createRecommendationQuotes(params: {
  answers: RecommendationAnswers;
  sources: AnswerSources;
  userId?: string | null;
  now?: Date;
}) {
  await refreshProviderCatalogForPricing();
  const now = params.now ?? new Date();
  const expiresAt = new Date(now.getTime() + RECOMMENDATION_QUOTE_VALIDITY_MS);
  const recommendation = buildRecommendation(params.answers, params.sources);
  const plans = await listActivePlans();

  if (recommendation.architectureEscalation) {
    const session = await prisma.recommendationSession.create({
      data: {
        userId: params.userId ?? null,
        status: RecommendationFlowStatus.ESCALATED,
        answers: params.answers as Prisma.InputJsonValue,
        answerSources: params.sources as Prisma.InputJsonValue,
        profile: recommendation.profile as Prisma.InputJsonValue,
        confidence: recommendation.confidence,
        architectureEscalation: true,
        expiresAt,
      },
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

  const session = await prisma.recommendationSession.create({
    data: {
      userId: params.userId ?? null,
      status,
      answers: params.answers as Prisma.InputJsonValue,
      answerSources: params.sources as Prisma.InputJsonValue,
      profile: recommendation.profile as Prisma.InputJsonValue,
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
          profileSnapshot: profile as Prisma.InputJsonValue,
          planSnapshot: toPlanSnapshot(plan, { createdAt: now, expiresAt }) as Prisma.InputJsonValue,
          amountRial: plan.pricing.finalPriceRial,
          renewalAmountRial: plan.pricing.finalPriceRial,
          catalogItemId: plan.pricing.catalogItemId,
          providerBasePriceRialSnapshot: plan.pricing.providerBasePriceRial,
          markupBasisPointsSnapshot: plan.pricing.markupBasisPoints,
          finalPriceRialSnapshot: plan.pricing.finalPriceRial,
          currencySnapshot: plan.pricing.currency,
          providerPriceCheckedAt: plan.pricing.providerPriceCheckedAt,
          expiresAt,
        })),
      },
    },
    include: { quotes: true },
  });
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
    quotes: session.quotes.map(toPublicRecommendationQuote),
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
      plan: { active: true },
      ...(userId
        ? {
            session: {
              OR: [{ userId }, { userId: null }],
            },
          }
        : {}),
    },
    include: { plan: true, session: true, serviceOrder: true },
  });
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
  const refreshed = await createRecommendationQuotes({
    answers: previous.session.answers as unknown as RecommendationAnswers,
    sources: previous.session.answerSources as unknown as AnswerSources,
    userId: params.userId,
  });
  const replacement =
    refreshed.quotes.find((quote) => quote.role === previous.role) ??
    refreshed.quotes.find((quote) => quote.role === "RECOMMENDED") ??
    refreshed.quotes[0] ??
    null;
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
