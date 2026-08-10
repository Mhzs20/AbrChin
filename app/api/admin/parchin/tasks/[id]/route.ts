import { ParchinTaskStatus } from "@prisma/client";

import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { updateParchinTask } from "@/lib/parchin/service";
import { WalletError } from "@/lib/wallet/errors";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const admin = await requireAdminUser();
    const [{ id }, body] = await Promise.all([
      params,
      request.json() as Promise<Record<string, unknown>>,
    ]);
    const status =
      typeof body.status === "string" &&
      Object.values(ParchinTaskStatus).includes(
        body.status as ParchinTaskStatus,
      )
        ? (body.status as ParchinTaskStatus)
        : undefined;
    const task = await updateParchinTask({
      taskId: id,
      adminUserId: admin.id,
      status,
      assignedToId:
        body.assignedToId === null
          ? null
          : typeof body.assignedToId === "string"
            ? body.assignedToId
            : undefined,
      evidenceSummary:
        typeof body.evidenceSummary === "string"
          ? body.evidenceSummary
          : undefined,
      blockedReason:
        typeof body.blockedReason === "string" ? body.blockedReason : undefined,
    });
    return jsonOk({
      task: {
        id: task.id,
        status: task.status,
        assignedToId: task.assignedToId,
        completedAt: task.completedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    const access = adminApiError(error);
    if (access) return jsonError(access.message, access.status);
    if (error instanceof WalletError) {
      return jsonError(error.message, error.code === "not_found" ? 404 : 400);
    }
    const code = error instanceof Error ? error.message : "";
    if (code === "parchin_evidence_invalid") {
      return jsonError("برای تکمیل وظیفه، شاهد معتبر ثبت کن.", 400);
    }
    return jsonError("به‌روزرسانی وظیفه پرچین ممکن نیست.", 500);
  }
}
