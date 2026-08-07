import { SupportRequestPriority, SupportRequestStatus } from "@prisma/client";

import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { jsonError, jsonOk } from "@/lib/http";
import {
  listAdminSupportRequests,
  toPublicSupportRequest,
} from "@/lib/support/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAdminUser();
    const url = new URL(request.url);
    const statusRaw = url.searchParams.get("status");
    const priorityRaw = url.searchParams.get("priority");
    const status =
      statusRaw &&
      Object.values(SupportRequestStatus).includes(
        statusRaw as SupportRequestStatus,
      )
        ? (statusRaw as SupportRequestStatus)
        : null;
    const priority =
      priorityRaw &&
      Object.values(SupportRequestPriority).includes(
        priorityRaw as SupportRequestPriority,
      )
        ? (priorityRaw as SupportRequestPriority)
        : null;
    const rows = await listAdminSupportRequests({ status, priority });
    return jsonOk({
      requests: rows.map((row) => ({
        ...toPublicSupportRequest(row),
        user: row.user,
        cloudInstance: row.cloudInstance,
      })),
    });
  } catch (error) {
    const access = adminApiError(error);
    if (access) return jsonError(access.message, access.status);
    return jsonError("دریافت درخواست‌ها ممکن نیست.", 500);
  }
}
