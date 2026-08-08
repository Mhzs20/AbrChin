import { panelApiError, requireCustomer } from "@/lib/auth/guards";
import { getClientIp, jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { requestEmailVerification } from "@/lib/identity/email-verification";
import { emailVerificationIpLimiter } from "@/lib/rate-limit";
import { WalletError } from "@/lib/wallet/errors";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const user = await requireCustomer();
    const ip = getClientIp(request);
    const ipLimit = await emailVerificationIpLimiter.check(
      `email-verify:ip:${ip}`,
    );
    if (!ipLimit.allowed) {
      return jsonError("تعداد درخواست‌ها بیش از حد مجاز است.", 429, {
        retryAfterSeconds: ipLimit.retryAfterSeconds,
      });
    }
    const userLimit = await emailVerificationIpLimiter.check(
      `email-verify:user:${user.id}`,
    );
    if (!userLimit.allowed) {
      return jsonError("تعداد درخواست‌ها بیش از حد مجاز است.", 429, {
        retryAfterSeconds: userLimit.retryAfterSeconds,
      });
    }

    const result = await requestEmailVerification({
      userId: user.id,
      ip,
    });
    if (!result.ok) {
      return jsonError(result.error, result.retryAfterSeconds ? 429 : 400, {
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }
    return jsonOk({
      ok: true,
      resendAvailableIn: result.resendAvailableIn,
      email: result.email,
    });
  } catch (error) {
    const accessError = panelApiError(error);
    if (accessError) return jsonError(accessError.message, accessError.status);
    if (error instanceof WalletError) {
      return jsonError(error.message, 400);
    }
    console.error(
      "[account/email-verification/request]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("ارسال کد تأیید ایمیل ممکن نشد.", 500);
  }
}
