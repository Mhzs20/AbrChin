import { ResourceChangeStatus } from "@prisma/client";

import { panelApiError, requireCustomer } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const user = await requireCustomer();
    const body = (await request.json()) as {
      instanceId?: unknown;
      action?: unknown;
    };
    const instanceId =
      typeof body.instanceId === "string" ? body.instanceId.trim() : "";
    const action =
      body.action === "UPGRADE" || body.action === "TERMINATE"
        ? body.action
        : null;
    if (!instanceId || !action) {
      return jsonError("درخواست تغییر معتبر نیست.", 400);
    }

    const instance = await prisma.cloudInstance.findFirst({
      where: { id: instanceId, userId: user.id, status: "ACTIVE" },
      include: { infrastructureOrder: true },
    });
    if (!instance) {
      return jsonError("سرور فعال پیدا نشد.", 404);
    }

    const idempotencyKey = `customer-${action.toLowerCase()}:${instance.id}:${user.id}`;
    const existing = await prisma.resourceChangeRequest.findUnique({
      where: { idempotencyKey },
    });
    if (
      existing &&
      existing.status !== ResourceChangeStatus.CANCELED &&
      existing.status !== ResourceChangeStatus.APPLIED
    ) {
      return jsonOk({ ok: true, id: existing.id, reused: true });
    }

    const created = await prisma.resourceChangeRequest.create({
      data: {
        cloudInstanceId: instance.id,
        planId: instance.infrastructureOrder.planId,
        requestedById: user.id,
        requestedResources: {
          action,
          source: "CUSTOMER_PANEL",
          providerMutationExecuted: false,
        },
        estimateSnapshot: {
          note: "request_only",
          action,
        },
        incrementalBufferRial: 0n,
        status: ResourceChangeStatus.WAITING_ADMIN_APPROVAL,
        idempotencyKey: existing
          ? `${idempotencyKey}:${Date.now()}`
          : idempotencyKey,
      },
    });

    return jsonOk({ ok: true, id: created.id, reused: false });
  } catch (error) {
    const panelError = panelApiError(error);
    if (panelError) return jsonError(panelError.message, panelError.status);
    console.error(
      "[account/resource-changes]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("ثبت درخواست تغییر ممکن نیست.", 500);
  }
}
