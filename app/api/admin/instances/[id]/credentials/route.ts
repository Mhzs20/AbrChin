import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import {
  InstanceCredentialError,
  storeInstanceCredential,
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
    const body = (await request.json()) as Record<string, unknown>;
    const username = typeof body.username === "string" ? body.username : "";
    const secret = typeof body.secret === "string" ? body.secret : "";
    const ttlHours =
      typeof body.ttlHours === "number" && Number.isInteger(body.ttlHours)
        ? body.ttlHours
        : 24;

    const credential = await storeInstanceCredential({
      instanceId: id,
      adminUserId: admin.id,
      username,
      secret,
      ttlHours,
    });
    const meta = await readRequestMeta(request);
    await writeAuditLog({
      actorUserId: admin.id,
      action: AuditActions.CREDENTIAL_READY,
      entityType: "cloud_instance",
      entityId: id,
      afterData: {
        credentialId: credential.id,
        username: credential.username,
        expiresAt: credential.expiresAt.toISOString(),
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return jsonOk({
      credential: {
        status: credential.status,
        username: credential.username,
        expiresAt: credential.expiresAt.toISOString(),
      },
    });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    if (error instanceof InstanceCredentialError) {
      return jsonError(error.message, 400, { code: error.code });
    }
    console.error("[admin/instance-credentials]", error instanceof Error ? error.message : "unknown");
    return jsonError("آماده‌سازی تحویل امن ممکن نیست.", 500);
  }
}
