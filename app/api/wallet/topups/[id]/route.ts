import { prisma } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { bigintToString, formatTomanFa, rialToToman } from "@/lib/money";
import { AuthRequiredError, requireCurrentUser } from "@/lib/session";
import { ensureWalletForUser } from "@/lib/wallet/ensure-wallet";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireCurrentUser();
    const { id } = await params;
    const wallet = await ensureWalletForUser(user.id);
    const topUp = await prisma.walletTopUp.findFirst({
      where: { id, walletId: wallet.id },
    });
    if (!topUp) return jsonError("درخواست شارژ پیدا نشد.", 404);

    return jsonOk({
      topUp: {
        id: topUp.id,
        status: topUp.status,
        gateway: topUp.gateway,
        amountRial: bigintToString(topUp.amount),
        amountToman: bigintToString(rialToToman(topUp.amount)),
        amountTomanFa: formatTomanFa(topUp.amount),
        createdAt: topUp.createdAt.toISOString(),
        verifiedAt: topUp.verifiedAt?.toISOString() ?? null,
        expiresAt: topUp.expiresAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) return jsonError("برای ادامه وارد شوید.", 401);
    console.error("[wallet/topups/:id]", error instanceof Error ? error.message : "unknown");
    return jsonError("دریافت وضعیت شارژ ممکن نیست.", 500);
  }
}
