import {
  adminAttachServer,
  adminTransferServer,
} from "@/lib/admin/user-admin";
import { panelApiError, requireAdmin } from "@/lib/auth/guards";
import {
  jsonError,
  jsonOk,
  readIdempotencyKey,
  rejectCrossOrigin,
} from "@/lib/http";
import { IdempotencyConflictError } from "@/lib/idempotency";
import { readRequestMeta } from "@/lib/session";
import { WalletError } from "@/lib/wallet/errors";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;
    const idempotencyKey = readIdempotencyKey(request);
    if (!idempotencyKey) return jsonError("شناسه یکتای درخواست الزامی است.", 400);
    const body = (await request.json()) as Record<string, unknown>;
    const meta = await readRequestMeta(request);
    const action = body.action === "transfer" ? "transfer" : "attach";
    const cloudInstanceId = String(body.cloudInstanceId ?? "").trim();
    if (!cloudInstanceId) return jsonError("شناسه سرور الزامی است.", 400);
    const reason = String(body.reason ?? "");

    if (action === "transfer") {
      const toUserId = String(body.toUserId ?? "").trim();
      if (!toUserId) return jsonError("کاربر مقصد الزامی است.", 400);
      const result = await adminTransferServer({
        actorUserId: admin.id,
        cloudInstanceId,
        fromUserId: id,
        toUserId,
        reason,
        idempotencyKey,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return jsonOk({ result });
    }

    const result = await adminAttachServer({
      actorUserId: admin.id,
      targetUserId: id,
      cloudInstanceId,
      reason,
      idempotencyKey,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return jsonOk({ result });
  } catch (error) {
    const accessError = panelApiError(error);
    if (accessError) return jsonError(accessError.message, accessError.status);
    if (error instanceof IdempotencyConflictError) {
      return jsonError("شناسه یکتا با درخواست قبلی تعارض دارد.", 409);
    }
    if (error instanceof WalletError) {
      return jsonError(error.message, 400, { code: error.code });
    }
    console.error(
      "[admin/users:servers]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("انتقال یا اتصال سرور ممکن نیست.", 500);
  }
}
