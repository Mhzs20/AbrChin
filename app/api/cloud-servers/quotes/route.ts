import { getClientIp, jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { readyServerQuoteIpLimiter } from "@/lib/rate-limit";
import { createReadyServerQuote } from "@/lib/recommendation/quote-service";
import { getCurrentUser } from "@/lib/session";
import { WalletError } from "@/lib/wallet/errors";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  const limit = readyServerQuoteIpLimiter.check(
    `ready-server:${getClientIp(request)}`,
  );
  if (!limit.allowed) {
    return jsonError(
      "تعداد درخواست‌های قیمت زیاد است؛ کمی بعد دوباره تلاش کن.",
      429,
      { retryAfterSeconds: limit.retryAfterSeconds },
    );
  }

  try {
    const body: unknown = await request.json();
    const planId =
      typeof body === "object" &&
      body !== null &&
      typeof (body as Record<string, unknown>).planId === "string"
        ? String((body as Record<string, unknown>).planId).trim()
        : "";
    if (!planId) return jsonError("انتخاب سرور معتبر نیست.", 400);

    const user = await getCurrentUser();
    const result = await createReadyServerQuote({
      planId,
      userId: user?.id ?? null,
    });
    return jsonOk({
      quote: result.quote,
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonError("درخواست نامعتبر است.", 400);
    }
    if (error instanceof WalletError) {
      const status =
        error.code === "quote_unavailable" ||
        error.code === "quote_revalidation_failed"
          ? 409
          : 400;
      return jsonError(error.message, status);
    }
    console.error(
      "[ready-server:quote]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("ساخت Quote زنده فعلاً ممکن نیست.", 500);
  }
}
