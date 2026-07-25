import { prisma } from "@/lib/db";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { AuthRequiredError, requireCurrentUser, toPublicUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const current = await requireCurrentUser();

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
    if (error instanceof AuthRequiredError) {
      return jsonError("برای ادامه وارد شوید.", 401);
    }
    console.error("[account/profile]", error instanceof Error ? error.message : "unknown");
    return jsonError("به‌روزرسانی پروفایل ممکن نیست.", 500);
  }
}
