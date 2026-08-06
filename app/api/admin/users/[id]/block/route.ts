import { adminSetUserBlock } from "@/lib/admin/user-admin";
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
    const result = await adminSetUserBlock({
      actorUserId: admin.id,
      userId: id,
      blocked: body.blocked !== false,
      reason: String(body.reason ?? ""),
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
    return jsonError("تغییر وضعیت مسدودی ممکن نیست.", 500);
  }
}
