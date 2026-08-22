import { AdminNotificationStatus } from "@prisma/client";

import { panelApiError, requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Marks every UNREAD admin notification as READ.
 *
 * Read-state only: RESOLVED rows and the operational incident history are
 * untouched, so nothing operational is lost — the Founder just gets the
 * badge back as a signal instead of a stuck counter.
 */
export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    await requireAdmin();
    const result = await prisma.adminNotification.updateMany({
      where: { status: AdminNotificationStatus.UNREAD },
      data: { status: AdminNotificationStatus.READ },
    });
    return jsonOk({ marked: result.count });
  } catch (error) {
    const accessError = panelApiError(error);
    if (accessError) return jsonError(accessError.message, accessError.status);
    console.error(
      "[admin/notifications/mark-all-read]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("علامت‌گذاری اعلان‌ها ممکن نیست.", 500);
  }
}
