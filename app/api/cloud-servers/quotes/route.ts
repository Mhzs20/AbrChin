import { InfrastructureProductKind } from "@prisma/client";

import {
  getClientIp,
  jsonError,
  jsonOk,
  readIdempotencyKey,
  rejectCrossOrigin,
} from "@/lib/http";
import { readyServerQuoteIpLimiter } from "@/lib/rate-limit";
import { setRecommendationGuestCookie } from "@/lib/recommendation/guest-session-cookie";
import {
  createCloudServerQuote,
  getCatalogServerDeliveryOptions,
} from "@/lib/recommendation/quote-service";
import { getCurrentUser } from "@/lib/session";
import { WalletError } from "@/lib/wallet/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const planId = new URL(request.url).searchParams.get("planId")?.trim();
    if (!planId) return jsonError("انتخاب سرور معتبر نیست.", 400);
    return jsonOk(
      await getCatalogServerDeliveryOptions({
        planId,
        expectedProductKind: InfrastructureProductKind.CLOUD_SERVER,
      }),
    );
  } catch {
    return jsonError("تنظیمات معتبر تحویل در دسترس نیست.", 409);
  }
}

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  const idempotencyKey = readIdempotencyKey(request);
  if (!idempotencyKey) {
    return jsonError("شناسه یکتای درخواست الزامی است.", 400);
  }

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
    const record =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : {};
    const imageAssetId =
      typeof record.imageAssetId === "string"
        ? record.imageAssetId.trim()
        : "";
    const accessMethod =
      typeof record.accessMethod === "string"
        ? record.accessMethod
        : "";
    if (
      !planId ||
      !imageAssetId ||
      !["ONE_TIME_PASSWORD", "SSH_KEY", "WINDOWS_PASSWORD"].includes(
        accessMethod,
      )
    ) {
      return jsonError("تنظیمات تحویل معتبر نیست.", 400);
    }

    const user = await getCurrentUser();
    const result = await createCloudServerQuote({
      planId,
      idempotencyKey,
      userId: user?.id ?? null,
      delivery: {
        imageAssetId,
        accessMethod: accessMethod as
          | "ONE_TIME_PASSWORD"
          | "SSH_KEY"
          | "WINDOWS_PASSWORD",
        sshKeyName:
          typeof record.sshKeyName === "string"
            ? record.sshKeyName
            : null,
      },
    });
    const response = jsonOk({
      quote: result.quote,
      expiresAt: result.expiresAt.toISOString(),
    });
    return result.guestToken
      ? setRecommendationGuestCookie(response, result.guestToken)
      : response;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonError("درخواست نامعتبر است.", 400);
    }
    if (error instanceof WalletError) {
      const status =
        error.code === "quote_unavailable" ||
        error.code === "quote_revalidation_failed" ||
        error.code === "provider_sale_disabled"
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
