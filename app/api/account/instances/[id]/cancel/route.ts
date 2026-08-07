import { panelApiError, requireCustomer } from "@/lib/auth/guards";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import {
  previewCustomerServiceCancellation,
  requestCustomerServiceCancellation,
} from "@/lib/orders/customer-cancel-service";
import { formatTomanFa } from "@/lib/money";
import { readRequestMeta } from "@/lib/session";
import { WalletError } from "@/lib/wallet/errors";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function publicPreview(preview: {
  originalPaidRial: string;
  consumedRial: string;
  nonRefundableRial: string;
  refundableRial: string;
  walletBalanceRial: string;
  walletBalanceAfterRefundRial: string;
  serviceStartedAt: string;
  asOf: string;
  termMonths: number;
}) {
  return {
    ...preview,
    originalPaidTomanFa: formatTomanFa(BigInt(preview.originalPaidRial)),
    consumedTomanFa: formatTomanFa(BigInt(preview.consumedRial)),
    nonRefundableTomanFa: formatTomanFa(BigInt(preview.nonRefundableRial)),
    refundableTomanFa: formatTomanFa(BigInt(preview.refundableRial)),
    walletBalanceTomanFa: formatTomanFa(BigInt(preview.walletBalanceRial)),
    walletBalanceAfterRefundTomanFa: formatTomanFa(
      BigInt(preview.walletBalanceAfterRefundRial),
    ),
  };
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireCustomer();
    const { id } = await params;
    const result = await previewCustomerServiceCancellation({
      instanceId: id,
      userId: user.id,
    });
    return jsonOk({
      instanceId: result.instanceId,
      orderId: result.orderId,
      serverName: result.serverName,
      lifecycle: result.lifecycle,
      preview: publicPreview(result.publicPreview),
    });
  } catch (error) {
    const panelError = panelApiError(error);
    if (panelError) return jsonError(panelError.message, panelError.status);
    if (error instanceof WalletError) {
      const status =
        error.code === "not_found"
          ? 404
          : error.code === "already_canceled"
            ? 409
            : 400;
      return jsonError(error.message, status, { code: error.code });
    }
    console.error(
      "[account/instances/cancel:get]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("محاسبه بازگشت اعتبار ممکن نیست.", 500);
  }
}

export async function POST(request: Request, { params }: Params) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const user = await requireCustomer();
    const meta = await readRequestMeta(request);
    const { id } = await params;
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const result = await requestCustomerServiceCancellation({
      instanceId: id,
      userId: user.id,
      reason: typeof body.reason === "string" ? body.reason : undefined,
      idempotencyKey:
        typeof body.idempotencyKey === "string"
          ? body.idempotencyKey
          : request.headers.get("Idempotency-Key") ?? undefined,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return jsonOk({
      ...result,
      preview: publicPreview(result.preview),
      message:
        result.lifecycle === "REFUND_CREDITED"
          ? "سرویس لغو شد و اعتبار به کیف پول برگشت."
          : result.lifecycle === "TERMINATION_FAILED"
            ? "درخواست لغو ثبت شد اما خاتمه Provider نیاز به بررسی ابرچین دارد؛ بازگشت وجه پس از خاتمه قطعی انجام می‌شود."
            : "درخواست لغو ثبت شد. پس از خاتمه قطعی سرور، اعتبار استفاده‌نشده به کیف پول برمی‌گردد.",
    });
  } catch (error) {
    const panelError = panelApiError(error);
    if (panelError) return jsonError(panelError.message, panelError.status);
    if (error instanceof WalletError) {
      const status =
        error.code === "not_found"
          ? 404
          : ["already_canceled", "idempotency_conflict"].includes(error.code)
            ? 409
            : 400;
      return jsonError(error.message, status, { code: error.code });
    }
    console.error(
      "[account/instances/cancel:post]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("ثبت لغو سرویس ممکن نیست.", 500);
  }
}
