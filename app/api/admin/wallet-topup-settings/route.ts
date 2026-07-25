import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { AuthRequiredError, requireCurrentUser } from "@/lib/session";
import { WalletError } from "@/lib/wallet/ledger";
import { getTopUpSettingsView, updateTopUpSuggestedAmounts } from "@/lib/wallet/topup-settings";

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
    const settings = await getTopUpSettingsView();
    return jsonOk({ settings });
  } catch (error) {
    if (error instanceof AuthRequiredError) return jsonError("برای ادامه وارد شوید.", 401);
    if (error instanceof WalletError && error.code === "forbidden") return jsonError(error.message, 403);
    console.error("[admin/wallet-topup-settings]", error instanceof Error ? error.message : "unknown");
    return jsonError("دریافت تنظیمات شارژ ممکن نیست.", 500);
  }
}

export async function PATCH(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const admin = await requireAdmin();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("درخواست نامعتبر است.", 400);
    }

    const payload = typeof body === "object" && body ? (body as Record<string, unknown>) : {};
    const suggestedAmountsToman = payload.suggestedAmountsToman;

    await updateTopUpSuggestedAmounts({
      suggestedAmountsToman,
      actorUserId: admin.id,
    });

    const settings = await getTopUpSettingsView();
    return jsonOk({ settings, message: "مبالغ پیشنهادی شارژ ذخیره شد." });
  } catch (error) {
    if (error instanceof AuthRequiredError) return jsonError("برای ادامه وارد شوید.", 401);
    if (error instanceof WalletError) {
      const status = error.code === "forbidden" ? 403 : 400;
      return jsonError(error.message, status);
    }
    console.error("[admin/wallet-topup-settings:patch]", error instanceof Error ? error.message : "unknown");
    return jsonError("ذخیره تنظیمات شارژ ممکن نیست.", 500);
  }
}
