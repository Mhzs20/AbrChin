import { LedgerType } from "@prisma/client";

import { prisma } from "@/lib/db";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { assertPositiveIntegerToman, bigintToString, formatTomanFa, rialToToman, tomanToRial } from "@/lib/money";
import { normalizeIranMobile } from "@/lib/mobile";
import { AuthRequiredError, requireCurrentUser } from "@/lib/session";
import { creditWallet, debitWallet, WalletError } from "@/lib/wallet/ledger";
import { ensureWalletForUser } from "@/lib/wallet/ensure-wallet";
import { readRequestMeta } from "@/lib/session";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const user = await requireCurrentUser();
  if (user.role !== "ADMIN") {
    throw new WalletError("forbidden", "دسترسی مجاز نیست.");
  }
  return user;
}

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const mobileRaw = url.searchParams.get("mobile");
    if (!mobileRaw) return jsonError("شماره موبایل لازم است.", 400);
    const normalized = normalizeIranMobile(mobileRaw);
    if (!normalized.ok) return jsonError(normalized.error, 400);

    const target = await prisma.user.findUnique({ where: { mobile: normalized.mobile } });
    if (!target) return jsonError("کاربر پیدا نشد.", 404);

    const wallet = await ensureWalletForUser(target.id);
    const ledger = await prisma.walletLedgerEntry.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    return jsonOk({
      user: {
        id: target.id,
        mobile: target.mobile,
        displayName: target.displayName,
        role: target.role,
      },
      wallet: {
        id: wallet.id,
        status: wallet.status,
        balanceRial: bigintToString(wallet.availableBalance),
        balanceTomanFa: formatTomanFa(wallet.availableBalance),
      },
      ledger: ledger.map((entry) => ({
        id: entry.id,
        type: entry.type,
        direction: entry.direction,
        amountTomanFa: formatTomanFa(entry.amount),
        balanceAfterTomanFa: formatTomanFa(entry.balanceAfter),
        description: entry.description,
        createdAt: entry.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) return jsonError("برای ادامه وارد شوید.", 401);
    if (error instanceof WalletError && error.code === "forbidden") return jsonError(error.message, 403);
    console.error("[admin/wallets]", error instanceof Error ? error.message : "unknown");
    return jsonError("عملیات ادمین ممکن نیست.", 500);
  }
}

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const admin = await requireAdmin();
    const meta = await readRequestMeta(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("درخواست نامعتبر است.", 400);
    }

    const payload = typeof body === "object" && body ? (body as Record<string, unknown>) : {};
    const normalized = normalizeIranMobile(payload.mobile);
    if (!normalized.ok) return jsonError(normalized.error, 400);

    const direction = payload.direction === "DEBIT" ? "DEBIT" : payload.direction === "CREDIT" ? "CREDIT" : null;
    if (!direction) return jsonError("نوع تعدیل نامعتبر است.", 400);

    const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
    if (reason.length < 3) return jsonError("دلیل تعدیل الزامی است.", 400);

    let amountToman: number;
    try {
      amountToman = assertPositiveIntegerToman(payload.amountToman);
    } catch {
      return jsonError("مبلغ باید عدد صحیح مثبت باشد.", 400);
    }

    const target = await prisma.user.findUnique({ where: { mobile: normalized.mobile } });
    if (!target) return jsonError("کاربر پیدا نشد.", 404);

    const amountRial = tomanToRial(amountToman);
    const idempotencyKey = `admin_adj_${admin.id}_${target.id}_${direction}_${amountRial}_${Date.now()}`;
    const metadata = {
      actorUserId: admin.id,
      actorMobile: admin.mobile,
      reason,
      ip: meta.ip,
      userAgent: meta.userAgent,
    };

    const entry =
      direction === "CREDIT"
        ? await creditWallet({
            userId: target.id,
            amountRial,
            type: LedgerType.ADMIN_ADJUSTMENT,
            idempotencyKey,
            description: reason,
            metadata,
          })
        : await debitWallet({
            userId: target.id,
            amountRial,
            type: LedgerType.ADMIN_ADJUSTMENT,
            idempotencyKey,
            description: reason,
            metadata,
          });

    const wallet = await ensureWalletForUser(target.id);
    return jsonOk({
      entry: {
        id: entry.id,
        direction: entry.direction,
        amountTomanFa: formatTomanFa(entry.amount),
        balanceAfterTomanFa: formatTomanFa(entry.balanceAfter),
      },
      wallet: {
        balanceTomanFa: formatTomanFa(wallet.availableBalance),
        balanceRial: bigintToString(wallet.availableBalance),
        balanceToman: bigintToString(rialToToman(wallet.availableBalance)),
      },
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) return jsonError("برای ادامه وارد شوید.", 401);
    if (error instanceof WalletError) {
      const status = error.code === "forbidden" ? 403 : error.code === "insufficient_funds" ? 402 : 400;
      return jsonError(error.message, status);
    }
    console.error("[admin/wallets:adjust]", error instanceof Error ? error.message : "unknown");
    return jsonError("ثبت تعدیل ممکن نیست.", 500);
  }
}
