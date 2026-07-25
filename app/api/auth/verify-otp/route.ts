import { cookies } from "next/headers";

import { verifyLoginOtp } from "@/lib/auth-service";
import { getClientIp, jsonError, jsonOk } from "@/lib/http";
import { normalizeIranMobile } from "@/lib/mobile";
import { verifyIpLimiter, verifyMobileLimiter } from "@/lib/rate-limit";
import { buildSessionCookie, readRequestMeta } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("درخواست نامعتبر است.", 400);
    }

    const payload = typeof body === "object" && body ? (body as Record<string, unknown>) : {};
    const normalized = normalizeIranMobile(payload.mobile);
    if (!normalized.ok) {
      return jsonError(normalized.error, 400);
    }

    const code = typeof payload.code === "string" ? payload.code.trim().replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))) : "";

    const ip = getClientIp(request);
    const mobileLimit = verifyMobileLimiter.check(`verify:mobile:${normalized.mobile}`);
    if (!mobileLimit.allowed) {
      return jsonError("تعداد تلاش‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.", 429, {
        retryAfterSeconds: mobileLimit.retryAfterSeconds,
      });
    }

    const ipLimit = verifyIpLimiter.check(`verify:ip:${ip}`);
    if (!ipLimit.allowed) {
      return jsonError("تعداد تلاش‌ها از این آدرس بیش از حد مجاز است.", 429, {
        retryAfterSeconds: ipLimit.retryAfterSeconds,
      });
    }

    const meta = await readRequestMeta(request);
    const result = await verifyLoginOtp(normalized.mobile, code, meta);
    if (!result.ok) {
      return jsonError(result.error, 400);
    }

    const jar = await cookies();
    jar.set(buildSessionCookie(result.sessionToken));

    return jsonOk({
      ok: true,
      user: result.user,
    });
  } catch (error) {
    console.error("[auth/verify-otp]", error instanceof Error ? error.message : "unknown");
    return jsonError("تأیید کد با مشکل مواجه شد. لطفاً دوباره تلاش کنید.", 500);
  }
}
