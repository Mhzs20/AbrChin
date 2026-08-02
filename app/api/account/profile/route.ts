import { panelApiError, requireCustomer } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { toPublicUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const current = await requireCustomer();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("درخواست نامعتبر است.", 400);
    }

    const payload = typeof body === "object" && body ? (body as Record<string, unknown>) : {};
    if (typeof payload.displayName !== "string") {
      return jsonError("نام نمایشی معتبر نیست.", 400);
    }

    const displayName = payload.displayName.trim();
    if (displayName.length < 2 || displayName.length > 64) {
      return jsonError("نام باید بین ۲ تا ۶۴ نویسه باشد.", 400);
    }

    const user = await prisma.user.update({
      where: { id: current.id },
      data: { displayName },
    });

    return jsonOk({ user: toPublicUser(user) });
  } catch (error) {
    const accessError = panelApiError(error);
    if (accessError) return jsonError(accessError.message, accessError.status);
    console.error("[account/profile]", error instanceof Error ? error.message : "unknown");
    return jsonError("به‌روزرسانی پروفایل ممکن نیست.", 500);
  }
}
