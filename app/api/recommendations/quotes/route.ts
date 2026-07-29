import { getClientIp, jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { recommendationQuoteIpLimiter } from "@/lib/rate-limit";
import { parseRecommendationInput } from "@/lib/recommendation/input";
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
    const input = parseRecommendationInput(body);
    const user = await getCurrentUser();
    const result = await createRecommendationQuotes({
      ...input,
      userId: user?.id ?? null,
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
    if (error instanceof Error && error.message.startsWith("invalid_recommendation_answer:")) {
      return jsonError("برای ساخت پیشنهاد، پاسخ همه سؤال‌ها را کامل کن.", 400);
    }
    console.error("[recommendation:quotes]", error instanceof Error ? error.message : "unknown");
    return jsonError("ساخت پیشنهادهای واقعی فعلاً ممکن نیست.", 500);
  }
}
