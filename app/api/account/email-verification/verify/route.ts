import { panelApiError, requireCustomer } from "@/lib/auth/guards";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { verifyEmailVerificationCode } from "@/lib/identity/email-verification";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const user = await requireCustomer();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("درخواست نامعتبر است.", 400);
    }
    const payload =
      typeof body === "object" && body ? (body as Record<string, unknown>) : {};
    const code = typeof payload.code === "string" ? payload.code : "";

    const result = await verifyEmailVerificationCode({
      userId: user.id,
      code,
    });
    if (!result.ok) {
      return jsonError(result.error, 400);
    }
    return jsonOk({ ok: true, emailVerified: true });
  } catch (error) {
    const accessError = panelApiError(error);
    if (accessError) return jsonError(accessError.message, accessError.status);
    console.error(
      "[account/email-verification/verify]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("تأیید ایمیل ممکن نشد.", 500);
  }
}
