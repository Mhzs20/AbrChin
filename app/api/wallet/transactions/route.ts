import type { LedgerStatus, LedgerType } from "@prisma/client";

import { prisma } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { bigintToString, formatTomanFa, rialToToman } from "@/lib/money";
import { AuthRequiredError, requireCurrentUser } from "@/lib/session";
import { getWalletForUser } from "@/lib/wallet/ensure-wallet";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser();
    const wallet = await getWalletForUser(user.id);
    const url = new URL(request.url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
    const pageSize = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get("pageSize") || "20", 10) || 20));
    const type = url.searchParams.get("type") as LedgerType | null;
    const status = url.searchParams.get("status") as LedgerStatus | null;

    if (!wallet) {
      return jsonOk({ page, pageSize, total: 0, items: [] });
    }

    const where = {
      walletId: wallet.id,
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
    };

    const [total, items] = await Promise.all([
      prisma.walletLedgerEntry.count({ where }),
      prisma.walletLedgerEntry.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return jsonOk({
      page,
      pageSize,
      total,
      items: items.map((entry) => ({
        id: entry.id,
        type: entry.type,
        direction: entry.direction,
        status: entry.status,
        amountRial: bigintToString(entry.amount),
        amountToman: bigintToString(rialToToman(entry.amount)),
        amountTomanFa: formatTomanFa(entry.amount),
        balanceAfterTomanFa: formatTomanFa(entry.balanceAfter),
        description: entry.description,
        createdAt: entry.createdAt.toISOString(),
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
      })),
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) return jsonError("برای ادامه وارد شوید.", 401);
    console.error("[wallet/transactions]", error instanceof Error ? error.message : "unknown");
    return jsonError("دریافت تراکنش‌ها ممکن نیست.", 500);
  }
}
