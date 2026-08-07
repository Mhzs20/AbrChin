import {
  AccountingJournalStatus,
  AccountingQuality,
  type Prisma,
} from "@prisma/client";

import {
  assertAccountCode,
  type AccountCode,
} from "@/lib/accounting/accounts";
import { prisma } from "@/lib/db";
import { IdempotencyConflictError, stableJson } from "@/lib/idempotency";

export type JournalLineInput = {
  accountCode: AccountCode | string;
  debitRial: bigint;
  creditRial: bigint;
  description?: string | null;
  metadata?: Prisma.InputJsonValue;
};

export type PostJournalEntryInput = {
  eventType: string;
  referenceType: string;
  referenceId: string;
  idempotencyKey: string;
  occurredAt: Date;
  lines: JournalLineInput[];
  quality?: AccountingQuality;
  metadata?: Prisma.InputJsonValue;
  actorUserId?: string | null;
  /** When set, this entry is the reversing counterpart of another posted entry. */
  reversesEntryId?: string | null;
  tx?: Prisma.TransactionClient;
};

export type ReverseJournalEntryInput = {
  journalEntryId: string;
  idempotencyKey: string;
  actorUserId?: string | null;
  reason?: string | null;
  tx?: Prisma.TransactionClient;
};

export class AccountingError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AccountingError";
  }
}

type Db = Prisma.TransactionClient;

function assertMoneyNonNegative(value: bigint, field: string) {
  if (value < 0n) {
    throw new AccountingError(
      "negative_amount",
      `${field} must be a non-negative integer rial amount`,
    );
  }
}

function validateLines(lines: JournalLineInput[]) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new AccountingError("empty_lines", "Journal entry requires lines");
  }
  let debitTotal = 0n;
  let creditTotal = 0n;
  const normalized = lines.map((line, index) => {
    const accountCode = assertAccountCode(String(line.accountCode));
    const debitRial = BigInt(line.debitRial);
    const creditRial = BigInt(line.creditRial);
    assertMoneyNonNegative(debitRial, `lines[${index}].debitRial`);
    assertMoneyNonNegative(creditRial, `lines[${index}].creditRial`);
    if (debitRial === 0n && creditRial === 0n) {
      throw new AccountingError(
        "zero_line",
        `lines[${index}] must have debit or credit`,
      );
    }
    if (debitRial > 0n && creditRial > 0n) {
      throw new AccountingError(
        "mixed_line",
        `lines[${index}] cannot debit and credit together`,
      );
    }
    debitTotal += debitRial;
    creditTotal += creditRial;
    return {
      accountCode,
      debitRial,
      creditRial,
      description: line.description?.trim() || null,
      metadata: line.metadata,
      sortOrder: index,
    };
  });
  if (debitTotal !== creditTotal) {
    throw new AccountingError(
      "unbalanced",
      `Unbalanced journal: debit=${debitTotal} credit=${creditTotal}`,
    );
  }
  if (debitTotal === 0n) {
    throw new AccountingError("zero_entry", "Journal totals cannot be zero");
  }
  return { normalized, debitTotal, creditTotal };
}

function assertReplayMatch(
  existing: {
    eventType: string;
    referenceType: string;
    referenceId: string;
    quality: AccountingQuality;
    metadata: Prisma.JsonValue | null;
    lines: Array<{
      accountCode: string;
      debitRial: bigint;
      creditRial: bigint;
      sortOrder: number;
    }>;
  },
  input: PostJournalEntryInput,
  normalized: ReturnType<typeof validateLines>["normalized"],
) {
  if (
    existing.eventType !== input.eventType ||
    existing.referenceType !== input.referenceType ||
    existing.referenceId !== input.referenceId ||
    existing.quality !== (input.quality ?? AccountingQuality.FINAL) ||
    stableJson(existing.metadata ?? null) !==
      stableJson(input.metadata ?? null)
  ) {
    throw new IdempotencyConflictError();
  }
  if (existing.lines.length !== normalized.length) {
    throw new IdempotencyConflictError();
  }
  const sortedExisting = [...existing.lines].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  for (let i = 0; i < normalized.length; i += 1) {
    const left = sortedExisting[i]!;
    const right = normalized[i]!;
    if (
      left.accountCode !== right.accountCode ||
      left.debitRial !== right.debitRial ||
      left.creditRial !== right.creditRial
    ) {
      throw new IdempotencyConflictError();
    }
  }
}

async function postJournalEntryTx(db: Db, input: PostJournalEntryInput) {
  const key = input.idempotencyKey.trim();
  if (!key) {
    throw new AccountingError("missing_idempotency_key", "idempotencyKey required");
  }
  const { normalized } = validateLines(input.lines);
  const quality = input.quality ?? AccountingQuality.FINAL;

  await db.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`accounting:${key}`}, 0)
    )::text AS locked
  `;

  const existing = await db.accountingJournalEntry.findUnique({
    where: { idempotencyKey: key },
    include: { lines: true },
  });
  if (existing) {
    assertReplayMatch(existing, input, normalized);
    return existing;
  }

  try {
    return await db.accountingJournalEntry.create({
      data: {
        eventType: input.eventType,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        idempotencyKey: key,
        occurredAt: input.occurredAt,
        status: AccountingJournalStatus.POSTED,
        quality,
        metadata: input.metadata ?? undefined,
        actorUserId: input.actorUserId ?? null,
        reversesEntryId: input.reversesEntryId ?? null,
        postedAt: new Date(),
        lines: {
          create: normalized.map((line) => ({
            accountCode: line.accountCode,
            debitRial: line.debitRial,
            creditRial: line.creditRial,
            description: line.description,
            metadata: line.metadata ?? undefined,
            sortOrder: line.sortOrder,
          })),
        },
      },
      include: { lines: true },
    });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    if (code === "P2002") {
      const raced = await db.accountingJournalEntry.findUniqueOrThrow({
        where: { idempotencyKey: key },
        include: { lines: true },
      });
      assertReplayMatch(raced, input, normalized);
      return raced;
    }
    throw error;
  }
}

export async function postJournalEntry(input: PostJournalEntryInput) {
  if (input.tx) return postJournalEntryTx(input.tx, input);
  return prisma.$transaction((tx) => postJournalEntryTx(tx, input));
}

async function reverseJournalEntryTx(
  db: Db,
  input: ReverseJournalEntryInput,
) {
  const key = input.idempotencyKey.trim();
  if (!key) {
    throw new AccountingError("missing_idempotency_key", "idempotencyKey required");
  }

  await db.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`accounting:${key}`}, 0)
    )::text AS locked
  `;

  const existingReversal = await db.accountingJournalEntry.findUnique({
    where: { idempotencyKey: key },
    include: { lines: true },
  });
  if (existingReversal) {
    if (
      existingReversal.reversesEntryId &&
      existingReversal.reversesEntryId !== input.journalEntryId
    ) {
      throw new IdempotencyConflictError();
    }
    if (existingReversal.reversesEntryId === input.journalEntryId) {
      await db.accountingJournalEntry.updateMany({
        where: {
          id: input.journalEntryId,
          status: AccountingJournalStatus.POSTED,
        },
        data: {
          status: AccountingJournalStatus.REVERSED,
          quality: AccountingQuality.REVERSED,
        },
      });
    }
    return existingReversal;
  }

  const original = await db.accountingJournalEntry.findUnique({
    where: { id: input.journalEntryId },
    include: { lines: true, reversedByEntry: true },
  });
  if (!original) {
    throw new AccountingError("not_found", "Journal entry not found");
  }
  if (original.status === AccountingJournalStatus.REVERSED) {
    if (original.reversedByEntry) {
      return db.accountingJournalEntry.findUniqueOrThrow({
        where: { id: original.reversedByEntry.id },
        include: { lines: true },
      });
    }
    throw new AccountingError("already_reversed", "Journal entry already reversed");
  }
  if (original.status !== AccountingJournalStatus.POSTED) {
    throw new AccountingError(
      "not_posted",
      "Only POSTED journal entries can be reversed",
    );
  }

  const reversingLines = [...original.lines]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((line) => ({
      accountCode: line.accountCode,
      debitRial: line.creditRial,
      creditRial: line.debitRial,
      description: line.description
        ? `برگشت: ${line.description}`
        : "برگشت سند حسابداری",
      metadata: line.metadata ?? undefined,
    }));

  const reversal = await postJournalEntryTx(db, {
    eventType: `${original.eventType}:reversal`,
    referenceType: original.referenceType,
    referenceId: original.referenceId,
    idempotencyKey: key,
    occurredAt: new Date(),
    quality: AccountingQuality.FINAL,
    actorUserId: input.actorUserId ?? null,
    reversesEntryId: original.id,
    metadata: {
      reversesEntryId: original.id,
      reason: input.reason ?? null,
      originalEventType: original.eventType,
    },
    lines: reversingLines,
  });

  await db.accountingJournalEntry.update({
    where: { id: original.id },
    data: {
      status: AccountingJournalStatus.REVERSED,
      quality: AccountingQuality.REVERSED,
    },
  });

  return reversal;
}

export async function reverseJournalEntry(input: ReverseJournalEntryInput) {
  if (input.tx) return reverseJournalEntryTx(input.tx, input);
  return prisma.$transaction((tx) => reverseJournalEntryTx(tx, input));
}
