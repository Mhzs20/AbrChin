import { panelApiError, requireCustomer } from "@/lib/auth/guards";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { formatTomanFa } from "@/lib/money";
import {
  createUpgradeQuote,
  listUpgradeTargetsForInstance,
} from "@/lib/orders/upgrade-quote";
import { readRequestMeta } from "@/lib/session";
import { WalletError } from "@/lib/wallet/errors";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCustomer();
    const { id } = await context.params;
    const listed = await listUpgradeTargetsForInstance({
      instanceId: id,
      userId: user.id,
    });
    return jsonOk({
      ...listed,
      walletBalanceRial: listed.walletBalanceRial.toString(),
      walletBalanceTomanFa: formatTomanFa(listed.walletBalanceRial),
      targets: listed.targets.map((target) => ({
        ...target,
        upgradeChargeRial: target.upgradeChargeRial.toString(),
        upgradeChargeTomanFa: formatTomanFa(target.upgradeChargeRial),
      })),
    });
  } catch (error) {
    const panelError = panelApiError(error);
    if (panelError) return jsonError(panelError.message, panelError.status);
    if (error instanceof WalletError) {
      return jsonError(error.message, 400, { code: error.code });
    }
    console.error(
      "[account/instances/upgrade:get]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("بارگذاری گزینه‌های ارتقا ممکن نیست.", 500);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const user = await requireCustomer();
    const meta = await readRequestMeta(request);
    const { id } = await context.params;
    const body = (await request.json()) as { targetPlanId?: unknown };
    const targetPlanId =
      typeof body.targetPlanId === "string" ? body.targetPlanId.trim() : "";
    if (!targetPlanId) {
      return jsonError("پلن مقصد را انتخاب کن.", 400);
    }
    const quote = await createUpgradeQuote({
      instanceId: id,
      userId: user.id,
      targetPlanId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return jsonOk({ ok: true, quote });
  } catch (error) {
    const panelError = panelApiError(error);
    if (panelError) return jsonError(panelError.message, panelError.status);
    if (error instanceof WalletError) {
      const status =
        error.code === "target_unavailable" ||
        error.code === "not_found" ||
        error.code === "upgrade_not_eligible"
          ? 409
          : 400;
      return jsonError(error.message, status, { code: error.code });
    }
    console.error(
      "[account/instances/upgrade:post]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("ایجاد پیش‌فاکتور ارتقا ممکن نیست.", 500);
  }
}
