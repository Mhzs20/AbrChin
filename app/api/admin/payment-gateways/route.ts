import { jsonError, jsonOk } from "@/lib/http";
import { listGatewayConfigs } from "@/lib/payments";
import { AuthRequiredError, requireCurrentUser } from "@/lib/session";
import { WalletError } from "@/lib/wallet/ledger";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const user = await requireCurrentUser();
  if (user.role !== "ADMIN") {
    throw new WalletError("forbidden", "دسترسی مجاز نیست.");
  }
  return user;
}

export async function GET() {
  try {
    await requireAdmin();
    const gateways = await listGatewayConfigs();
    return jsonOk({ gateways });
  } catch (error) {
    if (error instanceof AuthRequiredError) return jsonError("برای ادامه وارد شوید.", 401);
    if (error instanceof WalletError && error.code === "forbidden") return jsonError(error.message, 403);
    console.error("[admin/payment-gateways]", error instanceof Error ? error.message : "unknown");
    return jsonError("دریافت درگاه‌ها ممکن نیست.", 500);
  }
}
