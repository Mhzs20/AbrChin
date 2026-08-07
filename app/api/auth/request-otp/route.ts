import { requestLoginOtp } from "@/lib/auth-service";
import { getClientIp, jsonError, jsonOk } from "@/lib/http";
import { normalizeIranMobile } from "@/lib/mobile";
import { otpIpLimiter, otpMobileLimiter } from "@/lib/rate-limit";
import { SmsDeliveryError } from "@/lib/sms";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("درخواست نامعتبر است.", 400);
    }

    const mobileRaw = typeof body === "object" && body && "mobile" in body ? (body as { mobile: unknown }).mobile : null;
    const normalized = normalizeIranMobile(mobileRaw);
    if (!normalized.ok) {
      return jsonError(normalized.error, 400);
    }

    const ip = getClientIp(request);
    const mobileLimit = await otpMobileLimiter.check(`otp:mobile:${normalized.mobile}`);
    if (!mobileLimit.allowed) {
      return jsonError("تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.", 429, {
        retryAfterSeconds: mobileLimit.retryAfterSeconds,
      });
    }

    const ipLimit = await otpIpLimiter.check(`otp:ip:${ip}`);
    if (!ipLimit.allowed) {
      return jsonError("تعداد درخواست‌ها از این آدرس بیش از حد مجاز است.", 429, {
        retryAfterSeconds: ipLimit.retryAfterSeconds,
      });
    }

    const result = await requestLoginOtp(normalized.mobile);
    if (!result.ok) {
      return jsonError(result.error, 429, {
        retryAfterSeconds: result.retryAfterSeconds ?? 60,
      });
    }

    // Deliberately identical success response whether user exists or not.
    return jsonOk({
      ok: true,
      message: "اگر شماره معتبر باشد، کد تأیید ارسال می‌شود.",
      resendAvailableIn: result.resendAvailableIn,
    });
  } catch (error) {
    if (error instanceof SmsDeliveryError) {
      console.error(`[auth/request-otp] sms_delivery_failed code=${error.code}`);
    } else {
      console.error("[auth/request-otp]", error instanceof Error ? error.message : "unknown");
    }
    // Enumeration-safe generic failure for callers.
    return jsonError("ارسال کد با مشکل مواجه شد. لطفاً دوباره تلاش کنید.", 500);
  }
}
