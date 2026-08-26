import { panelApiError, requireCustomer } from "@/lib/auth/guards";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { customerViewContainsForbiddenSecret } from "@/lib/messagego/customer/view";
import {
  getCustomerAiSurface,
  handoffCustomerProviderCredential,
} from "@/lib/messagego/customer/surface";
import { assertNoJsonNumberMoney } from "@/lib/messagego/settlement/amount";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireCustomer();
    const surface = await getCustomerAiSurface(user.id);
    assertNoJsonNumberMoney(surface);
    return jsonOk({
      control_plane: surface.control_plane,
      connections: surface.connections,
    });
  } catch (error) {
    const access = panelApiError(error);
    if (access) return jsonError(access.message, access.status);
    return jsonError("دریافت وضعیت اتصال هوش مصنوعی ممکن نیست.", 500);
  }
}

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
    const credential = typeof payload.credential === "string" ? payload.credential : "";
    const result = await handoffCustomerProviderCredential({
      userId: user.id,
      productId: typeof payload.product_id === "string" ? payload.product_id : "",
      workspaceId: typeof payload.workspace_id === "string" ? payload.workspace_id : "",
      alias: typeof payload.alias === "string" ? payload.alias : "",
      ownershipMode:
        typeof payload.ownership_mode === "string" ? payload.ownership_mode : "",
      familyAlias: typeof payload.family_alias === "string" ? payload.family_alias : "",
      credential,
    });
    if (customerViewContainsForbiddenSecret(result.connection, [credential])) {
      return jsonError("پاسخ اتصال حاوی Secret بود و رد شد.", 500, {
        code: "secret_boundary",
      });
    }
    assertNoJsonNumberMoney(result.connection);
    if (!result.ok) {
      return jsonError(
        result.code === "control_plane_unavailable" || result.code === "handoff_unavailable"
          ? "اتصال MessageGo در دسترس نیست؛ تحویل کلید انجام نشد."
          : "تحویل یک‌باره کلید به MessageGo ناموفق بود.",
        409,
        { code: result.code, connection: result.connection },
      );
    }
    return jsonOk({ connection: result.connection });
  } catch (error) {
    const access = panelApiError(error);
    if (access) return jsonError(access.message, access.status);
    return jsonError("ثبت اتصال هوش مصنوعی ممکن نیست.", 500);
  }
}
