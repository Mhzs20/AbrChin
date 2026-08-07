import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import {
  OperatingExpenseError,
  reverseExpense,
} from "@/lib/accounting/expenses";
import { accountingJsonOk } from "@/lib/accounting/serialize";
import {
  jsonError,
  readIdempotencyKey,
  rejectCrossOrigin,
} from "@/lib/http";
import { readRequestMeta } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const admin = await requireAdminUser();
    const { id } = await context.params;
    const meta = await readRequestMeta(request);
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const reason = typeof body.reason === "string" ? body.reason : "";
    const idempotencyKey = readIdempotencyKey(request);
    const expense = await reverseExpense({
      expenseId: id,
      actorUserId: admin.id,
      reason,
      ip: meta.ip,
      userAgent: meta.userAgent,
      idempotencyKey: idempotencyKey ?? `opex-reverse:${id}`,
    });
    return accountingJsonOk({
      expense: {
        ...expense,
        amountRial: expense.amountRial.toString(),
        date: expense.date.toISOString(),
        postedAt: expense.postedAt?.toISOString() ?? null,
        reversedAt: expense.reversedAt?.toISOString() ?? null,
        createdAt: expense.createdAt.toISOString(),
        updatedAt: expense.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    if (error instanceof OperatingExpenseError) {
      return jsonError(error.message, 400, { code: error.code });
    }
    if (error instanceof SyntaxError) {
      return jsonError("بدنه درخواست معتبر نیست.", 400);
    }
    console.error(
      "[admin/accounting/expenses/reverse]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("برگشت هزینه ممکن نیست.", 500);
  }
}
