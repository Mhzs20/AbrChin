import { UserRole } from "@prisma/client";

import {
  adminCreateUser,
  listAdminManagedUsers,
} from "@/lib/admin/user-admin";
import { panelApiError, requireAdmin } from "@/lib/auth/guards";
import {
  jsonError,
  jsonOk,
  readIdempotencyKey,
  rejectCrossOrigin,
} from "@/lib/http";
import { formatTomanFa } from "@/lib/money";
import { readRequestMeta } from "@/lib/session";
import { IdempotencyConflictError } from "@/lib/idempotency";
import { WalletError } from "@/lib/wallet/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    const users = await listAdminManagedUsers();
    return jsonOk({
      users: users.map((user) => ({
        id: user.id,
        mobile: user.mobile,
        displayName: user.displayName,
        role: user.role,
        accountStatus: user.accountStatus,
        blockedAt: user.blockedAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
        ordersCount: user._count.orders,
        serversCount: user._count.cloudInstances,
        balanceTomanFa: user.wallet
          ? formatTomanFa(user.wallet.availableBalance)
          : "۰",
      })),
    });
  } catch (error) {
    const accessError = panelApiError(error);
    if (accessError) return jsonError(accessError.message, accessError.status);
    return jsonError("دریافت کاربران ممکن نیست.", 500);
  }
}

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const admin = await requireAdmin();
    const idempotencyKey = readIdempotencyKey(request);
    if (!idempotencyKey) return jsonError("شناسه یکتای درخواست الزامی است.", 400);
    const body = (await request.json()) as Record<string, unknown>;
    const meta = await readRequestMeta(request);
    const result = await adminCreateUser({
      actorUserId: admin.id,
      mobile: String(body.mobile ?? ""),
      displayName:
        typeof body.displayName === "string" ? body.displayName : null,
      role: body.role === "ADMIN" ? UserRole.ADMIN : UserRole.CUSTOMER,
      reason: String(body.reason ?? ""),
      idempotencyKey,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return jsonOk({ result });
  } catch (error) {
    const accessError = panelApiError(error);
    if (accessError) return jsonError(accessError.message, accessError.status);
    if (error instanceof IdempotencyConflictError) {
      return jsonError("شناسه یکتا با درخواست قبلی تعارض دارد.", 409);
    }
    if (error instanceof WalletError) {
      return jsonError(error.message, 400, { code: error.code });
    }
    if (error instanceof SyntaxError) return jsonError("بدنه درخواست معتبر نیست.", 400);
    console.error(
      "[admin/users:create]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("ساخت کاربر ممکن نیست.", 500);
  }
}
