import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { refreshRecommendationQuote } from "@/lib/recommendation/quote-service";
import { AuthRequiredError, getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Explicit POST refresh for an expired/invalid recommendation quote.
 * GET/page rendering must never call refreshRecommendationQuote.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new AuthRequiredError();
    }
    const { id } = await params;
    const quote = await refreshRecommendationQuote({
      quoteId: id,
      userId: user.id,
    });
    if (!quote) {
      return jsonError("به‌روزرسانی قیمت ممکن نیست.", 409);
    }
    return jsonOk({ quote });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return jsonError("برای ادامه وارد شوید.", 401);
    }
    if (error instanceof Error) {
      if (error.message === "quote_not_found") {
        return jsonError("پیشنهاد پیدا نشد.", 404);
      }
      if (error.message === "delivery_configuration_required") {
        return jsonError("تنظیمات تحویل برای تمدید قیمت ناقص است.", 409);
      }
    }
    console.error(
      "[recommendations:quote-refresh]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("به‌روزرسانی قیمت ممکن نیست.", 500);
  }
}
