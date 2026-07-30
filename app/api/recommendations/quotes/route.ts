import { getClientIp, jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { ParchinLevel } from "@prisma/client";
import { recommendationQuoteIpLimiter } from "@/lib/rate-limit";
import { getRecommendationGuestToken } from "@/lib/recommendation/guest-session-cookie";
import { createRecommendationQuotes } from "@/lib/recommendation/quote-service";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  const limit = recommendationQuoteIpLimiter.check(`recommendation:${getClientIp(request)}`);
  if (!limit.allowed) {
    return jsonError("تعداد درخواست‌های پیشنهاد زیاد است؛ کمی بعد دوباره تلاش کن.", 429, {
      retryAfterSeconds: limit.retryAfterSeconds,
    });
  }

  try {
    const body: unknown = await request.json();
    const includeComparisons =
      typeof body === "object" &&
      body !== null &&
      (body as Record<string, unknown>).includeComparisons === true;
    const sessionId =
      typeof body === "object" &&
      body !== null &&
      typeof (body as Record<string, unknown>).sessionId === "string"
        ? String((body as Record<string, unknown>).sessionId)
        : undefined;
    const requestedParchinLevel =
      typeof body === "object" &&
      body !== null &&
      Object.values(ParchinLevel).includes(
        (body as Record<string, unknown>).parchinLevel as ParchinLevel,
      )
        ? ((body as Record<string, unknown>).parchinLevel as ParchinLevel)
        : undefined;
    const user = await getCurrentUser();
    const result = await createRecommendationQuotes({
      userId: user?.id ?? null,
      includeComparisons,
      sessionId,
      requestedParchinLevel,
      guestToken:
        request.headers.get("x-recommendation-session-token") ??
        (await getRecommendationGuestToken()),
    });

    return jsonOk({
      sessionId: result.sessionId,
      expiresAt: result.expiresAt.toISOString(),
      recommendation: {
        title: result.recommendation.title,
        summary: result.recommendation.summary,
        confidence: result.recommendation.confidence,
        assumptions: result.recommendation.assumptions,
        caveats: result.recommendation.caveats,
        architectureEscalation: result.recommendation.architectureEscalation,
      },
      quotes: result.quotes,
      quoteNotice: result.quoteNotice,
    });
  } catch (error) {
    if (error instanceof SyntaxError) return jsonError("درخواست نامعتبر است.", 400);
    if (
      error instanceof Error &&
      error.message === "parchin_level_below_minimum"
    ) {
      return jsonError(
        "سطح پرچین انتخاب‌شده از حداقل امن این نیاز پایین‌تر است.",
        409,
      );
    }
    if (
      error instanceof Error &&
      [
        "conversation_session_required",
        "conversation_requirements_not_confirmed",
        "conversation_delivery_not_configured",
      ].includes(error.message)
    ) {
      return jsonError(
        "ابتدا برداشت، پاسخ‌ها و تنظیمات تحویل گفت‌وگو را تأیید کن.",
        409,
      );
    }
    console.error("[recommendation:quotes]", error instanceof Error ? error.message : "unknown");
    return jsonError("ساخت پیشنهادهای واقعی فعلاً ممکن نیست.", 500);
  }
}
