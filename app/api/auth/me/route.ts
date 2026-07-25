import { AuthRequiredError, requireCurrentUser } from "@/lib/session";
import { jsonError, jsonOk } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireCurrentUser();
    return jsonOk({ user });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return jsonError("برای ادامه وارد شوید.", 401);
    }
    console.error("[auth/me]", error instanceof Error ? error.message : "unknown");
    return jsonError("دریافت اطلاعات کاربر ممکن نیست.", 500);
  }
}
