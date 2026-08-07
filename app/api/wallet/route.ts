import { prisma } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { bigintToString, formatTomanFa, rialToToman } from "@/lib/money";
import { AuthRequiredError, requireCurrentUser } from "@/lib/session";
import { getWalletForUser } from "@/lib/wallet/ensure-wallet";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireCurrentUser();
    const wallet = await getWalletForUser(user.id);
    if (!wallet) {
      return jsonOk({
        wallet: {
          id: null,
          currency: "IRR",
          status: "ACTIVE",
          balanceRial: "0",
          balanceToman: "0",
          balanceTomanFa: formatTomanFa(0n),
        },
        recentTransactions: [],
      });
    }
    const recent = await prisma.walletLedgerEntry.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    return jsonOk({
      wallet: {
        id: wallet.id,
        currency: wallet.currency,
        status: wallet.status,
        balanceRial: bigintToString(wallet.availableBalance),
        balanceToman: bigintToString(rialToToman(wallet.availableBalance)),
        balanceTomanFa: formatTomanFa(wallet.availableBalance),
      },
      recentTransactions: recent.map((entry) => ({
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
    console.error("[wallet]", error instanceof Error ? error.message : "unknown");
    return jsonError("دریافت کیف پول ممکن نیست.", 500);
  }
}
