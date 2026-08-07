import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import {
  FinanceConfigurationError,
  applyFinanceConfiguration,
  readFinanceConfiguration,
  rollbackFinanceConfiguration,
  type FinanceConfigurationInput,
} from "@/lib/admin/finance-configuration";
import { parseFinanceConfigurationBody } from "@/lib/admin/finance-configuration-parse";
import {
  jsonError,
  jsonOk,
  readIdempotencyKey,
  rejectCrossOrigin,
} from "@/lib/http";
import { readRequestMeta } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminUser();
    const configuration = await readFinanceConfiguration();
    return jsonOk({ configuration });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    return jsonError("خواندن تنظیمات مالی ممکن نیست.", 500);
  }
}

export async function PATCH(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const admin = await requireAdminUser();
    const idempotencyKey = readIdempotencyKey(request);
    if (!idempotencyKey) {
      return jsonError("شناسه یکتای درخواست الزامی است.", 400);
    }
    const meta = await readRequestMeta(request);
    const body = (await request.json()) as Record<string, unknown>;

    if (typeof body.rollbackToRevisionId === "string") {
      const revision = await rollbackFinanceConfiguration({
        revisionId: body.rollbackToRevisionId,
        actorUserId: admin.id,
        reason: typeof body.reason === "string" ? body.reason : null,
        idempotencyKey,
        meta,
      });
      const configuration = await readFinanceConfiguration();
      return jsonOk({ revisionId: revision.id, configuration });
    }

    let input: FinanceConfigurationInput;
    try {
      input = parseFinanceConfigurationBody(body);
    } catch {
      return jsonError("تنظیمات مالی معتبر نیست.", 400);
    }
    const revision = await applyFinanceConfiguration({
      input,
      actorUserId: admin.id,
      idempotencyKey,
      meta,
    });
    const configuration = await readFinanceConfiguration();
    return jsonOk({ revisionId: revision.id, configuration });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    if (error instanceof FinanceConfigurationError) {
      const status =
        error.code === "margin_confirmation_required"
          ? 428
          : error.code === "card_quote_parity_failed"
            ? 409
            : error.code === "revision_not_found"
              ? 404
              : error.code === "profit_curve_not_monotonic" ||
                  error.code === "invalid_profit_curve"
                ? 400
                : 400;
      return jsonError(error.message, status, { code: error.code });
    }
    if (error instanceof SyntaxError) {
      return jsonError("بدنه درخواست معتبر نیست.", 400);
    }
    console.error(
      "[admin/finance/configuration]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("ذخیره تنظیمات مالی ممکن نیست.", 500);
  }
}
