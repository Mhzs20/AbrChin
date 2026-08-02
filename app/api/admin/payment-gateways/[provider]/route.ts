import { panelApiError, requireAdmin } from "@/lib/auth/guards";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import {
  listGatewayConfigs,
  parseProviderParam,
  PaymentError,
  updateGatewayConfig,
} from "@/lib/payments";
import { readRequestMeta } from "@/lib/session";
import { PaymentGatewayEnvironment } from "@prisma/client";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ provider: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const admin = await requireAdmin();
    const meta = await readRequestMeta(request);
    const { provider: providerRaw } = await context.params;
    const provider = parseProviderParam(providerRaw);
    if (!provider) return jsonError("درگاه نامعتبر است.", 400);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("درخواست نامعتبر است.", 400);
    }

    const payload = typeof body === "object" && body ? (body as Record<string, unknown>) : {};
    if ("merchant" in payload || "merchantId" in payload || "secret" in payload || "apiKey" in payload) {
      return jsonError("درخواست نامعتبر است.", 400);
    }

    const enabled = typeof payload.enabled === "boolean" ? payload.enabled : undefined;
    const priority =
      typeof payload.priority === "number" && Number.isInteger(payload.priority) && payload.priority > 0
        ? payload.priority
        : undefined;

    let environment: PaymentGatewayEnvironment | undefined;
    if (typeof payload.environment === "string") {
      if (
        payload.environment === "DEVELOPMENT" ||
        payload.environment === "SANDBOX" ||
        payload.environment === "PRODUCTION"
      ) {
        environment = payload.environment;
      } else {
        return jsonError("محیط نامعتبر است.", 400);
      }
    }

    await updateGatewayConfig({
      provider,
      enabled,
      priority,
      environment,
      audit: { actorUserId: admin.id, ip: meta.ip, userAgent: meta.userAgent },
    });

    const gateways = await listGatewayConfigs();
    return jsonOk({ gateways, message: "تنظیمات درگاه به‌روزرسانی شد." });
  } catch (error) {
    const accessError = panelApiError(error);
    if (accessError) return jsonError(accessError.message, accessError.status);
    if (error instanceof PaymentError) return jsonError(error.message, 400);
    console.error("[admin/payment-gateways/:provider]", error instanceof Error ? error.message : "unknown");
    return jsonError("به‌روزرسانی درگاه ممکن نیست.", 500);
  }
}
