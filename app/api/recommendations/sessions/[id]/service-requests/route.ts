import {
  AdminNotificationStatus,
  AdminNotificationType,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { getRecommendationGuestToken } from "@/lib/recommendation/guest-session-cookie";
import { requireConversationAccess } from "@/lib/recommendation/session-service";
import {
  listCompassServicePackages,
  type CompassServicePackageCode,
} from "@/lib/recommendation/service-packages";
import { getCurrentUser } from "@/lib/session";
import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { readRequestMeta } from "@/lib/session";

export const dynamic = "force-dynamic";

const codes = new Set<CompassServicePackageCode>([
  "SITE_MIGRATION",
  "INITIAL_SETUP",
  "DOMAIN_SSL",
  "BACKUP_RESTORE",
  "ARCHITECTURE_LIGHT",
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const { id: sessionId } = await context.params;
    const user = await getCurrentUser();
    const guestToken =
      request.headers.get("x-recommendation-session-token") ??
      (await getRecommendationGuestToken());
    const session = await requireConversationAccess({
      sessionId,
      userId: user?.id ?? null,
      guestToken,
    });
    if (!user) {
      return jsonError("برای ثبت درخواست خدمت وارد شو.", 401);
    }

    const body = (await request.json()) as { packageCode?: unknown };
    const packageCode =
      typeof body.packageCode === "string" &&
      codes.has(body.packageCode as CompassServicePackageCode)
        ? (body.packageCode as CompassServicePackageCode)
        : null;
    if (!packageCode) {
      return jsonError("بسته خدمت نامعتبر است.", 400);
    }

    const packages = await listCompassServicePackages();
    const selected = packages.find((pack) => pack.code === packageCode);
    if (!selected) {
      return jsonError("این بسته خدمت فعال نیست.", 409);
    }

    const meta = await readRequestMeta(request);
    const idempotencyKey = `compass-service:${session.id}:${packageCode}:${user.id}`;
    const existing = await prisma.adminNotification.findFirst({
      where: {
        type: AdminNotificationType.NEEDS_RECONCILIATION,
        title: { contains: packageCode },
        message: { contains: session.id },
        status: AdminNotificationStatus.UNREAD,
      },
    });
    if (existing) {
      return jsonOk({ ok: true, alreadyRequested: true, requestId: existing.id });
    }

    const notification = await prisma.adminNotification.create({
      data: {
        type: AdminNotificationType.NEEDS_RECONCILIATION,
        title: `درخواست خدمت قطب‌نما: ${selected.title} [${packageCode}]`,
        message: `کاربر ${user.mobile ?? user.id} بسته «${selected.title}» (${packageCode}) را از گفت‌وگوی ${session.id} درخواست کرد. مبلغ اعلامی: ${selected.priceRial.toString()} ریال. اجرا فقط پس از بررسی Admin.`,
        status: AdminNotificationStatus.UNREAD,
      },
    });
    await writeAuditLog({
      actorUserId: user.id,
      action: AuditActions.PLAN_UPDATE,
      entityType: "CompassServiceRequest",
      entityId: notification.id,
      afterData: {
        sessionId: session.id,
        packageCode,
        priceRial: selected.priceRial.toString(),
        idempotencyKey,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
      idempotencyKey: `audit:${idempotencyKey}`,
    });

    return jsonOk({ ok: true, requestId: notification.id });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "conversation_session_not_found"
    ) {
      return jsonError("گفت‌وگو پیدا نشد.", 404);
    }
    console.error(
      "[recommendation:service-request]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("ثبت درخواست خدمت ممکن نیست.", 500);
  }
}
