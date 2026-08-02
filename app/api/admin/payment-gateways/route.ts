import { panelApiError, requireAdmin } from "@/lib/auth/guards";
import { jsonError, jsonOk } from "@/lib/http";
import { listGatewayConfigs } from "@/lib/payments";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    const gateways = await listGatewayConfigs();
    return jsonOk({ gateways });
  } catch (error) {
    const accessError = panelApiError(error);
    if (accessError) return jsonError(accessError.message, accessError.status);
    console.error("[admin/payment-gateways]", error instanceof Error ? error.message : "unknown");
    return jsonError("دریافت درگاه‌ها ممکن نیست.", 500);
  }
}
