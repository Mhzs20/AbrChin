import { OperatingExpenseCategory } from "@prisma/client";

import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import {
  OperatingExpenseError,
  createDraftExpense,
  listOperatingExpenses,
} from "@/lib/accounting/expenses";
import { accountingJsonOk } from "@/lib/accounting/serialize";
import { isIdempotencyConflictError } from "@/lib/idempotency";
import {
  jsonError,
  readIdempotencyKey,
  rejectCrossOrigin,
} from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAdminUser();
    const url = new URL(request.url);
    const fromRaw = url.searchParams.get("from");
    const toRaw = url.searchParams.get("to");
    const from = fromRaw ? new Date(fromRaw) : undefined;
    const to = toRaw ? new Date(toRaw) : undefined;
    const expenses = await listOperatingExpenses({
      from:
        from && !Number.isNaN(from.getTime()) ? from : undefined,
      to: to && !Number.isNaN(to.getTime()) ? to : undefined,
    });
    return accountingJsonOk({
      expenses: expenses.map((row) => ({
        ...row,
        amountRial: row.amountRial.toString(),
        date: row.date.toISOString(),
        postedAt: row.postedAt?.toISOString() ?? null,
        reversedAt: row.reversedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    return jsonError("خواندن هزینه‌ها ممکن نیست.", 500);
  }
}

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const admin = await requireAdminUser();
    const idempotencyKey = readIdempotencyKey(request);
    if (!idempotencyKey) {
      return jsonError("شناسه یکتای درخواست الزامی است.", 400);
    }
    const body = (await request.json()) as Record<string, unknown>;
    const amountRaw = String(body.amountRial ?? "");
    if (!/^\d+$/.test(amountRaw)) {
      return jsonError("مبلغ هزینه معتبر نیست.", 400);
    }
    const category = body.category as OperatingExpenseCategory;
    if (!Object.values(OperatingExpenseCategory).includes(category)) {
      return jsonError("دسته‌بندی هزینه معتبر نیست.", 400);
    }
    const dateRaw = String(body.date ?? "");
    const date = new Date(dateRaw);
    if (Number.isNaN(date.getTime())) {
      return jsonError("تاریخ هزینه معتبر نیست.", 400);
    }
    const title = typeof body.title === "string" ? body.title : "";
    const expense = await createDraftExpense({
      date,
      amountRial: BigInt(amountRaw),
      category,
      title,
      description:
        typeof body.description === "string" ? body.description : null,
      vendor: typeof body.vendor === "string" ? body.vendor : null,
      reference: typeof body.reference === "string" ? body.reference : null,
      notes: typeof body.notes === "string" ? body.notes : null,
      actorUserId: admin.id,
      idempotencyKey,
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
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
    if (isIdempotencyConflictError(error)) {
      return jsonError("کلید یکتایی با بدنه متفاوت قبلاً استفاده شده است.", 409, {
        code: "idempotency_conflict",
      });
    }
    if (error instanceof OperatingExpenseError) {
      return jsonError(error.message, 400, { code: error.code });
    }
    if (error instanceof SyntaxError) {
      return jsonError("بدنه درخواست معتبر نیست.", 400);
    }
    console.error(
      "[admin/accounting/expenses]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("ثبت پیش‌نویس هزینه ممکن نیست.", 500);
  }
}
