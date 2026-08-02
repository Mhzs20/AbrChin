import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { getClientIp, jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { adminCredentialRevealLimiter } from "@/lib/rate-limit";
import {
  InstanceCredentialError,
  revealInstanceCredentialForAdmin,
} from "@/lib/security/instance-credentials";
import { readRequestMeta } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const admin = await requireAdminUser();
    const { id } = await params;
    const limit = adminCredentialRevealLimiter.check(
      `admin-credential-review:${admin.id}:${id}:${getClientIp(request)}`,
    );
    if (!limit.allowed) {
      return jsonError("تعداد بازبینی Credential زیاد است؛ کمی بعد دوباره تلاش کن.", 429, {
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }
    const credential = await revealInstanceCredentialForAdmin({ instanceId: id });
    const meta = await readRequestMeta(request);
    await writeAuditLog({
      actorUserId: admin.id,
      action: AuditActions.CREDENTIAL_ADMIN_REVIEWED,
      entityType: "cloud_instance",
      entityId: id,
      afterData: { revealed: true, containsSecret: false },
      ip: meta.ip,
      userAgent: meta.userAgent,
      idempotencyKey: `credential-admin-reviewed:${admin.id}:${id}:${Date.now()}`,
    });
    return jsonOk({ credential });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    if (error instanceof InstanceCredentialError) {
      return jsonError(error.message, error.code === "not_found" ? 404 : 409, {
        code: error.code,
      });
    }
    console.error("[admin/credential-review]", error instanceof Error ? error.message : "unknown");
    return jsonError("بازبینی Credential ممکن نیست.", 500);
  }
}
