import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import {
  OperatingExpenseError,
  postExpense,
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
    const idempotencyKey = readIdempotencyKey(request);
    const expense = await postExpense({
      expenseId: id,
      actorUserId: admin.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      idempotencyKey: idempotencyKey ?? `opex-post:${id}`,
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
    console.error(
      "[admin/accounting/expenses/post]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("ثبت نهایی هزینه ممکن نیست.", 500);
  }
}
