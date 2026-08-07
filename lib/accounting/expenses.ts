import {
  AccountingQuality,
  OperatingExpenseCategory,
  OperatingExpenseStatus,
} from "@prisma/client";

import {
  AUTOMATIC_PROVIDER_COGS_CODES,
  type AccountCode,
} from "@/lib/accounting/accounts";
import {
  postManualExpensePosted,
  postManualExpenseReversed,
} from "@/lib/accounting/posting";
import { writeAuditLog } from "@/lib/audit/service";
import { prisma } from "@/lib/db";

export class OperatingExpenseError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "OperatingExpenseError";
  }
}

export type CreateDraftExpenseInput = {
  date: Date;
  amountRial: bigint;
  category: OperatingExpenseCategory;
  title: string;
  description?: string | null;
  vendor?: string | null;
  reference?: string | null;
  notes?: string | null;
  actorUserId: string;
};

export type PostExpenseInput = {
  expenseId: string;
  actorUserId: string;
  ip?: string | null;
  userAgent?: string | null;
  idempotencyKey?: string | null;
};

export type ReverseExpenseInput = {
  expenseId: string;
  actorUserId: string;
  reason: string;
  ip?: string | null;
  userAgent?: string | null;
  idempotencyKey?: string | null;
};

const CATEGORY_TO_ACCOUNT: Record<OperatingExpenseCategory, AccountCode> = {
  GATEWAY_FEES: "GATEWAY_FEES",
  SMS_EXPENSE: "SMS_EXPENSE",
  SUPPORT_OPERATIONS: "SUPPORT_OPERATIONS",
  HOSTING_OPERATIONS: "HOSTING_OPERATIONS",
  MARKETING_EXPENSE: "MARKETING_EXPENSE",
  PAYROLL_CONTRACTOR: "PAYROLL_CONTRACTOR",
  OTHER_OPERATING_EXPENSE: "OTHER_OPERATING_EXPENSE",
};

function assertManualCategory(category: OperatingExpenseCategory) {
  const account = CATEGORY_TO_ACCOUNT[category];
  if (
    (AUTOMATIC_PROVIDER_COGS_CODES as readonly string[]).includes(account)
  ) {
    throw new OperatingExpenseError(
      "provider_cogs_not_allowed",
      "دسته‌بندی بهای تمام‌شده خودکار ارائه‌دهنده مجاز نیست.",
    );
  }
  return account;
}

function assertPositiveAmount(amountRial: bigint) {
  if (amountRial <= 0n) {
    throw new OperatingExpenseError(
      "invalid_amount",
      "مبلغ هزینه باید بزرگ‌تر از صفر باشد.",
    );
  }
}

export async function createDraftExpense(input: CreateDraftExpenseInput) {
  assertPositiveAmount(input.amountRial);
  assertManualCategory(input.category);
  const title = input.title.trim();
  if (title.length < 2) {
    throw new OperatingExpenseError("invalid_title", "عنوان هزینه نامعتبر است.");
  }
  return prisma.operatingExpense.create({
    data: {
      date: input.date,
      amountRial: input.amountRial,
      category: input.category,
      title,
      description: input.description?.trim() || null,
      vendor: input.vendor?.trim() || null,
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
      status: OperatingExpenseStatus.DRAFT,
      createdById: input.actorUserId,
    },
  });
}

/**
 * Draft expenses are excluded from P&L. Posted expenses are included via journal.
 * Posted rows cannot be edited or deleted — reverse and create a new expense.
 */
export async function postExpense(input: PostExpenseInput) {
  return prisma.$transaction(async (tx) => {
    const expense = await tx.operatingExpense.findUniqueOrThrow({
      where: { id: input.expenseId },
    });
    if (expense.status === OperatingExpenseStatus.POSTED) {
      return expense;
    }
    if (expense.status === OperatingExpenseStatus.REVERSED) {
      throw new OperatingExpenseError(
        "already_reversed",
        "هزینه برگشت‌خورده قابل ثبت مجدد نیست.",
      );
    }
    const account = assertManualCategory(expense.category);
    const journal = await postManualExpensePosted(
      {
        id: expense.id,
        amountRial: expense.amountRial,
        category: account,
        title: expense.title,
        date: expense.date,
      },
      tx,
    );
    const posted = await tx.operatingExpense.update({
      where: { id: expense.id },
      data: {
        status: OperatingExpenseStatus.POSTED,
        postedById: input.actorUserId,
        postedAt: new Date(),
        journalEntryId: journal.id,
      },
    });
    await writeAuditLog(
      {
        actorUserId: input.actorUserId,
        action: "operating_expense_posted",
        entityType: "operating_expense",
        entityId: expense.id,
        beforeData: {
          status: expense.status,
          amountRial: expense.amountRial.toString(),
        },
        afterData: {
          status: posted.status,
          journalEntryId: journal.id,
          amountRial: posted.amountRial.toString(),
          category: posted.category,
          quality: AccountingQuality.FINAL,
        },
        ip: input.ip,
        userAgent: input.userAgent,
        idempotencyKey:
          input.idempotencyKey ?? `audit:opex-post:${expense.id}`,
      },
      tx,
    );
    return posted;
  });
}

export async function reverseExpense(input: ReverseExpenseInput) {
  const reason = input.reason.trim();
  if (reason.length < 3) {
    throw new OperatingExpenseError(
      "invalid_reason",
      "دلیل برگشت هزینه الزامی است.",
    );
  }
  return prisma.$transaction(async (tx) => {
    const expense = await tx.operatingExpense.findUniqueOrThrow({
      where: { id: input.expenseId },
    });
    if (expense.status === OperatingExpenseStatus.REVERSED) {
      return expense;
    }
    if (expense.status !== OperatingExpenseStatus.POSTED) {
      throw new OperatingExpenseError(
        "not_posted",
        "فقط هزینه ثبت‌شده قابل برگشت است.",
      );
    }
    await postManualExpenseReversed(
      { id: expense.id, journalEntryId: expense.journalEntryId },
      tx,
    );
    const reversed = await tx.operatingExpense.update({
      where: { id: expense.id },
      data: {
        status: OperatingExpenseStatus.REVERSED,
        reversedById: input.actorUserId,
        reversedAt: new Date(),
        reversalReason: reason,
      },
    });
    await writeAuditLog(
      {
        actorUserId: input.actorUserId,
        action: "operating_expense_reversed",
        entityType: "operating_expense",
        entityId: expense.id,
        beforeData: {
          status: expense.status,
          journalEntryId: expense.journalEntryId,
        },
        afterData: {
          status: reversed.status,
          reason,
        },
        ip: input.ip,
        userAgent: input.userAgent,
        idempotencyKey:
          input.idempotencyKey ?? `audit:opex-reverse:${expense.id}`,
      },
      tx,
    );
    return reversed;
  });
}

export async function listOperatingExpenses(input?: {
  status?: OperatingExpenseStatus;
  from?: Date;
  to?: Date;
}) {
  return prisma.operatingExpense.findMany({
    where: {
      ...(input?.status ? { status: input.status } : {}),
      ...(input?.from || input?.to
        ? {
            date: {
              ...(input.from ? { gte: input.from } : {}),
              ...(input.to ? { lte: input.to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
}
