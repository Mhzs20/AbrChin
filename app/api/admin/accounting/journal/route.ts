import { AccountingJournalStatus } from "@prisma/client";

import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { accountingJsonOk } from "@/lib/accounting/serialize";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function GET(request: Request) {
  try {
    await requireAdminUser();
    const url = new URL(request.url);
    const from = parseDate(url.searchParams.get("from"));
    const to = parseDate(url.searchParams.get("to"));
    const status = url.searchParams.get("status");
    const takeRaw = Number(url.searchParams.get("take") ?? "100");
    const take = Number.isFinite(takeRaw)
      ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500)
      : 100;

    const entries = await prisma.accountingJournalEntry.findMany({
      where: {
        ...(status &&
        Object.values(AccountingJournalStatus).includes(
          status as AccountingJournalStatus,
        )
          ? { status: status as AccountingJournalStatus }
          : {}),
        ...(from || to
          ? {
              occurredAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
      orderBy: { occurredAt: "desc" },
      take,
    });

    return accountingJsonOk({
      entries: entries.map((entry) => ({
        id: entry.id,
        eventType: entry.eventType,
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        occurredAt: entry.occurredAt.toISOString(),
        status: entry.status,
        quality: entry.quality,
        postedAt: entry.postedAt.toISOString(),
        reversesEntryId: entry.reversesEntryId,
        actorUserId: entry.actorUserId,
        metadata: entry.metadata,
        lines: entry.lines.map((line) => ({
          id: line.id,
          accountCode: line.accountCode,
          debitRial: line.debitRial.toString(),
          creditRial: line.creditRial.toString(),
          description: line.description,
          sortOrder: line.sortOrder,
        })),
      })),
      count: entries.length,
    });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    console.error(
      "[admin/accounting/journal]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("خواندن دفتر روزنامه ممکن نیست.", 500);
  }
}
