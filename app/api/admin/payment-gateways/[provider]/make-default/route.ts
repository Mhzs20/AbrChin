import { panelApiError, requireAdmin } from "@/lib/auth/guards";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import {
  listGatewayConfigs,
  makeGatewayDefault,
  parseProviderParam,
  PaymentError,
} from "@/lib/payments";
import { readRequestMeta } from "@/lib/session";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ provider: string }> };

export async function POST(request: Request, context: RouteContext) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const admin = await requireAdmin();
    const meta = await readRequestMeta(request);
    const { provider: providerRaw } = await context.params;
    const provider = parseProviderParam(providerRaw);
    if (!provider) return jsonError("درگاه نامعتبر است.", 400);

    await makeGatewayDefault({
      provider,
      audit: { actorUserId: admin.id, ip: meta.ip, userAgent: meta.userAgent },
    });

    const gateways = await listGatewayConfigs();
    return jsonOk({ gateways, message: "درگاه پیش‌فرض تغییر کرد." });
  } catch (error) {
    const accessError = panelApiError(error);
    if (accessError) return jsonError(accessError.message, accessError.status);
    if (error instanceof PaymentError) return jsonError(error.message, 400);
    console.error("[admin/payment-gateways/make-default]", error instanceof Error ? error.message : "unknown");
    return jsonError("تغییر درگاه پیش‌فرض ممکن نیست.", 500);
  }
}
