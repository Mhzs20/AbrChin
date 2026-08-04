import { ResourceChangeStatus, ResourceVersionState } from "@prisma/client";

import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { recordProviderConfirmedResourceVersion } from "@/lib/billing/resource-timeline";
import { prisma } from "@/lib/db";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { readRequestMeta } from "@/lib/session";
import { AuditActions, writeAuditLog } from "@/lib/audit/service";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const admin = await requireAdminUser();
    const meta = await readRequestMeta(request);
    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const idempotencyKey =
      typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
        ? body.idempotencyKey.trim()
        : `fulfill:${id}:${admin.id}`;
    const vcpu = Number(body.vcpu);
    const ramMb = Number(body.ramMb);
    const diskGb = Number(body.diskGb);
    const note = typeof body.note === "string" ? body.note.trim() : "";

    const change = await prisma.resourceChangeRequest.findUnique({
      where: { id },
      include: { cloudInstance: true },
    });
    if (!change) return jsonError("درخواست پیدا نشد.", 404);
    if (
      change.status !== ResourceChangeStatus.APPROVED &&
      change.status !== ResourceChangeStatus.PROVIDER_MUTATION_PENDING
    ) {
      return jsonError("ابتدا درخواست را تأیید کنید.", 409);
    }

    const action =
      change.requestedResources &&
      typeof change.requestedResources === "object" &&
      !Array.isArray(change.requestedResources)
        ? (change.requestedResources as Record<string, unknown>).action
        : null;

    const version = await recordProviderConfirmedResourceVersion({
      cloudInstanceId: change.cloudInstanceId,
      planId: change.planId,
      state:
        action === "TERMINATE"
          ? ResourceVersionState.TERMINATED
          : ResourceVersionState.ACTIVE,
      resources: {
        vcpu: Number.isInteger(vcpu) && vcpu > 0 ? vcpu : 1,
        ramMb: Number.isInteger(ramMb) && ramMb > 0 ? ramMb : 1024,
        diskGb: Number.isInteger(diskGb) && diskGb >= 0 ? diskGb : 0,
        ipv4Count: 1,
        backupEnabled: false,
        snapshotCount: 0,
      },
      providerEventId: `manual-fulfill:${id}`,
      providerConfirmedAt: new Date(),
      idempotencyKey,
      sourceChangeRequestId: change.id,
    });

    if (action === "TERMINATE") {
      await prisma.cloudInstance.update({
        where: { id: change.cloudInstanceId },
        data: { status: "TERMINATED" },
      });
    }

    await writeAuditLog({
      actorUserId: admin.id,
      action: AuditActions.RESOURCE_CHANGE_APPROVED,
      entityType: "ResourceChangeRequest",
      entityId: change.id,
      afterData: {
        status: "APPLIED",
        manualFulfillment: true,
        note: note || null,
        resourceVersionId: version.id,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
      idempotencyKey: `audit:fulfill:${idempotencyKey}`,
    });

    return jsonOk({ ok: true, resourceVersionId: version.id });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    console.error(
      "[admin/resource-changes/fulfill]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("ثبت انجام دستی ممکن نیست.", 500);
  }
}
