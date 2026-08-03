import { panelApiError, requireCustomer } from "@/lib/auth/guards";
import { getClientIp, jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { credentialRevealLimiter } from "@/lib/rate-limit";
import {
  InstanceCredentialError,
  revealInstanceCredential,
} from "@/lib/security/instance-credentials";
import { readRequestMeta } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const user = await requireCustomer();
    const { id } = await params;
    const limit = credentialRevealLimiter.check(
      `credential-reveal:${user.id}:${id}:${getClientIp(request)}`,
    );
    if (!limit.allowed) {
      return jsonError("تعداد تلاش برای نمایش اطلاعات دسترسی زیاد است؛ کمی بعد دوباره تلاش کن.", 429, {
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }
    const meta = await readRequestMeta(request);
    const credential = await revealInstanceCredential({
      instanceId: id,
      userId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return jsonOk({ credential });
  } catch (error) {
    const accessError = panelApiError(error);
    if (accessError) return jsonError(accessError.message, accessError.status);
    if (error instanceof InstanceCredentialError) {
      const status = error.code === "not_found" ? 404 : 409;
      return jsonError(error.message, status, { code: error.code });
    }
    console.error("[account/instance-credentials]", error instanceof Error ? error.message : "unknown");
    return jsonError("نمایش اطلاعات دسترسی ممکن نیست.", 500);
  }
}
