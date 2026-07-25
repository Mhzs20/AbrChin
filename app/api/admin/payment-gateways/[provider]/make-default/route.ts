import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import {
  listGatewayConfigs,
  makeGatewayDefault,
  parseProviderParam,
  PaymentError,
} from "@/lib/payments";
import { AuthRequiredError, readRequestMeta, requireCurrentUser } from "@/lib/session";
import { WalletError } from "@/lib/wallet/ledger";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ provider: string }> };

async function requireAdmin() {
  const user = await requireCurrentUser();
  if (user.role !== "ADMIN") {
    throw new WalletError("forbidden", "دسترسی مجاز نیست.");
  }
  return user;
}

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
    if (error instanceof AuthRequiredError) return jsonError("برای ادامه وارد شوید.", 401);
    if (error instanceof WalletError && error.code === "forbidden") return jsonError(error.message, 403);
    if (error instanceof PaymentError) return jsonError(error.message, 400);
    console.error("[admin/payment-gateways/make-default]", error instanceof Error ? error.message : "unknown");
    return jsonError("تغییر درگاه پیش‌فرض ممکن نیست.", 500);
  }
}
