import { UserRole } from "@prisma/client";

import {
  adminDeleteUser,
  adminUpdateUser,
  getAdminManagedUser,
  listUserSiteActivity,
} from "@/lib/admin/user-admin";
import { panelApiError, requireAdmin } from "@/lib/auth/guards";
import {
  jsonError,
  jsonOk,
  readIdempotencyKey,
  rejectCrossOrigin,
} from "@/lib/http";
import { IdempotencyConflictError } from "@/lib/idempotency";
import { formatTomanFa } from "@/lib/money";
import { readRequestMeta } from "@/lib/session";
import { WalletError } from "@/lib/wallet/errors";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const [user, activity] = await Promise.all([
      getAdminManagedUser(id),
      listUserSiteActivity(id),
    ]);
    if (!user || !activity) return jsonError("کاربر پیدا نشد.", 404);
    return jsonOk({
      user: {
        id: user.id,
        mobile: user.mobile,
        displayName: user.displayName,
        role: user.role,
        accountStatus: user.accountStatus,
        blockedAt: user.blockedAt?.toISOString() ?? null,
        blockedReason: user.blockedReason,
        createdAt: user.createdAt.toISOString(),
        mobileVerifiedAt: user.mobileVerifiedAt?.toISOString() ?? null,
        wallet: user.wallet
          ? {
              id: user.wallet.id,
              status: user.wallet.status,
              balanceTomanFa: formatTomanFa(user.wallet.availableBalance),
            }
          : null,
        cloudInstances: user.cloudInstances.map((row) => ({
          id: row.id,
          name: row.name,
          status: row.status,
          providerInstanceId: row.providerInstanceId,
          region: row.region,
          ipv4: row.ipv4,
        })),
        orders: user.orders.map((row) => ({
          id: row.id,
          title: row.title,
          status: row.status,
          amountTomanFa: formatTomanFa(row.amount),
          createdAt: row.createdAt.toISOString(),
        })),
        sessions: user.sessions,
      },
      activity,
    });
  } catch (error) {
    const accessError = panelApiError(error);
    if (accessError) return jsonError(accessError.message, accessError.status);
    return jsonError("دریافت کاربر ممکن نیست.", 500);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;
    const idempotencyKey = readIdempotencyKey(request);
    if (!idempotencyKey) return jsonError("شناسه یکتای درخواست الزامی است.", 400);
    const body = (await request.json()) as Record<string, unknown>;
    const meta = await readRequestMeta(request);
    const result = await adminUpdateUser({
      actorUserId: admin.id,
      userId: id,
      displayName:
        body.displayName === undefined
          ? undefined
          : typeof body.displayName === "string"
            ? body.displayName
            : null,
      role:
        body.role === "ADMIN"
          ? UserRole.ADMIN
          : body.role === "CUSTOMER"
            ? UserRole.CUSTOMER
            : undefined,
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
    return jsonError("ویرایش کاربر ممکن نیست.", 500);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;
    const idempotencyKey = readIdempotencyKey(request);
    if (!idempotencyKey) return jsonError("شناسه یکتای درخواست الزامی است.", 400);
    const body = (await request.json()) as Record<string, unknown>;
    const meta = await readRequestMeta(request);
    const result = await adminDeleteUser({
      actorUserId: admin.id,
      userId: id,
      reason: String(body.reason ?? ""),
      confirmMobile: String(body.confirmMobile ?? ""),
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
      return jsonError(error.message, 409, { code: error.code });
    }
    console.error(
      "[admin/users:delete]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("حذف کامل کاربر ممکن نیست.", 500);
  }
}
