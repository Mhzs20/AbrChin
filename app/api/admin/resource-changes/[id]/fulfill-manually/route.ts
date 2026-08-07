import { ResourceChangeStatus, ResourceVersionState } from "@prisma/client";

import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { completeCancellationAfterTermination } from "@/lib/orders/customer-cancel-service";
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
      change.status !== ResourceChangeStatus.PROVIDER_MUTATION_PENDING &&
      change.status !== ResourceChangeStatus.WAITING_ADMIN_APPROVAL
    ) {
      return jsonError("وضعیت درخواست برای انجام دستی مناسب نیست.", 409);
    }

    const action =
      change.requestedResources &&
      typeof change.requestedResources === "object" &&
      !Array.isArray(change.requestedResources)
        ? (change.requestedResources as Record<string, unknown>).action
        : null;

    if (action === "TERMINATE") {
      // Approve if still waiting so lifecycle moves CANCEL_REQUESTED → TERMINATING.
      if (change.status === ResourceChangeStatus.WAITING_ADMIN_APPROVAL) {
        await prisma.resourceChangeRequest.update({
          where: { id: change.id },
          data: {
            status: ResourceChangeStatus.APPROVED,
            approvedById: admin.id,
            approvedAt: new Date(),
          },
        });
      }
      const refund = await completeCancellationAfterTermination({
        resourceChangeRequestId: change.id,
        actorUserId: admin.id,
        reason:
          note ||
          "خاتمه دستی سرور پس از درخواست لغو مشتری و بازگشت اعتبار به کیف پول",
        ip: meta.ip,
        userAgent: meta.userAgent,
        terminalResources: {
          vcpu: Number.isInteger(vcpu) && vcpu > 0 ? vcpu : 1,
          ramMb: Number.isInteger(ramMb) && ramMb > 0 ? ramMb : 1024,
          diskGb: Number.isInteger(diskGb) && diskGb >= 0 ? diskGb : 0,
        },
      });
      return jsonOk({
        ok: true,
        action: "TERMINATE",
        refund,
      });
    }

    const version = await recordProviderConfirmedResourceVersion({
      cloudInstanceId: change.cloudInstanceId,
      planId: change.planId,
      state: ResourceVersionState.ACTIVE,
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
