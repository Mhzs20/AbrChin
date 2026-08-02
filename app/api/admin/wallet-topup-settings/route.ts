import { panelApiError, requireAdmin } from "@/lib/auth/guards";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { WalletError } from "@/lib/wallet/ledger";
import { getTopUpSettingsView, updateTopUpSuggestedAmounts } from "@/lib/wallet/topup-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    const settings = await getTopUpSettingsView();
    return jsonOk({ settings });
  } catch (error) {
    const accessError = panelApiError(error);
    if (accessError) return jsonError(accessError.message, accessError.status);
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
    const accessError = panelApiError(error);
    if (accessError) return jsonError(accessError.message, accessError.status);
    if (error instanceof WalletError) {
      const status = error.code === "forbidden" ? 403 : 400;
      return jsonError(error.message, status);
    }
    console.error("[admin/wallet-topup-settings:patch]", error instanceof Error ? error.message : "unknown");
    return jsonError("ذخیره تنظیمات شارژ ممکن نیست.", 500);
  }
}
