import { createHash } from "node:crypto";

import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import {
  jsonError,
  jsonOk,
  readIdempotencyKey,
  rejectCrossOrigin,
} from "@/lib/http";
import {
  IdempotencyConflictError,
  stableJson,
} from "@/lib/idempotency";
import { observeAndRegisterPreprovisionedInventory } from "@/lib/infrastructure/preprovisioned-inventory";
import { readRequestMeta } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminUser();
    const items = await prisma.preprovisionedInventoryItem.findMany({
      orderBy: [{ inventoryStatus: "asc" }, { createdAt: "desc" }],
      take: 500,
      select: {
        id: true,
        planId: true,
        provider: true,
        apiVersion: true,
        providerResourceId: true,
        regionCode: true,
        externalPlanId: true,
        externalImageId: true,
        observedState: true,
        observedIpv4: true,
        lastObservedAt: true,
        lastHealthCheckedAt: true,
        healthStatus: true,
        inventoryStatus: true,
        reservedByOrderId: true,
        reservationExpiresAt: true,
        assignedOrderId: true,
        deliveredAt: true,
        disabledAt: true,
        credential: {
          select: { status: true, username: true, transferredAt: true },
        },
      },
    });
    return jsonOk({
      items: items.map((item) => ({
        ...item,
        lastObservedAt: item.lastObservedAt.toISOString(),
        lastHealthCheckedAt:
          item.lastHealthCheckedAt?.toISOString() ?? null,
        reservationExpiresAt:
          item.reservationExpiresAt?.toISOString() ?? null,
        deliveredAt: item.deliveredAt?.toISOString() ?? null,
        disabledAt: item.disabledAt?.toISOString() ?? null,
        credential: item.credential
          ? {
              status: item.credential.status,
              username: item.credential.username,
              transferredAt:
                item.credential.transferredAt?.toISOString() ?? null,
            }
          : null,
      })),
    });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    return jsonError("دریافت موجودی واقعی ممکن نیست.", 500);
  }
}

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const admin = await requireAdminUser();
    const idempotencyKey = readIdempotencyKey(request);
    if (!idempotencyKey) {
      return jsonError("شناسه یکتای درخواست الزامی است.", 400);
    }
    const body = (await request.json()) as Record<string, unknown>;
    const planId =
      typeof body.planId === "string" ? body.planId.trim() : "";
    const providerResourceId =
      typeof body.providerResourceId === "string"
        ? body.providerResourceId.trim()
        : "";
    const reason =
      typeof body.reason === "string" ? body.reason.trim() : "";
    if (
      !/^[a-zA-Z0-9_-]{8,128}$/.test(planId) ||
      !/^[a-zA-Z0-9._:-]{1,160}$/.test(providerResourceId) ||
      reason.length < 3 ||
      reason.length > 240
    ) {
      return jsonError("Plan، Resource ID یا دلیل معتبر نیست.", 400);
    }
    const fingerprint = createHash("sha256")
      .update(
        stableJson({
          operation: "PREPROVISIONED_INVENTORY_OBSERVE",
          actorUserId: admin.id,
          planId,
          providerResourceId,
          reason,
        }),
      )
      .digest("hex");
    const existing = await prisma.auditLog.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      const after = existing.afterData as Record<string, unknown> | null;
      if (
        existing.actorUserId !== admin.id ||
        existing.action !==
          AuditActions.PREPROVISIONED_INVENTORY_OBSERVE ||
        after?.fingerprint !== fingerprint ||
        !existing.entityId
      ) {
        throw new IdempotencyConflictError();
      }
      const replay =
        await prisma.preprovisionedInventoryItem.findUniqueOrThrow({
          where: { id: existing.entityId },
        });
      return jsonOk({
        inventory: {
          id: replay.id,
          inventoryStatus: replay.inventoryStatus,
          healthStatus: replay.healthStatus,
        },
        replay: true,
      });
    }
    const item = await observeAndRegisterPreprovisionedInventory({
      planId,
      providerResourceId,
      actorUserId: admin.id,
      reason,
    });
    const meta = await readRequestMeta(request);
    await writeAuditLog({
      actorUserId: admin.id,
      action: AuditActions.PREPROVISIONED_INVENTORY_OBSERVE,
      entityType: "preprovisioned_inventory_item",
      entityId: item.id,
      afterData: {
        fingerprint,
        planId,
        provider: item.provider,
        apiVersion: item.apiVersion,
        regionCode: item.regionCode,
        inventoryStatus: item.inventoryStatus,
        healthStatus: item.healthStatus,
        containsSecret: false,
      },
      idempotencyKey,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return jsonOk({
      inventory: {
        id: item.id,
        inventoryStatus: item.inventoryStatus,
        healthStatus: item.healthStatus,
      },
      replay: false,
    });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    if (error instanceof IdempotencyConflictError) {
      return jsonError("شناسه یکتا با درخواست قبلی تعارض دارد.", 409, {
        code: error.code,
      });
    }
    if (error instanceof SyntaxError) {
      return jsonError("بدنه درخواست معتبر نیست.", 400);
    }
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "inventory_observation_failed";
    const safeMessages: Record<string, string> = {
      invalid_inventory_plan: "پلن موجودی واقعی معتبر نیست.",
      inventory_resource_not_found: "Resource از Provider مشاهده نشد.",
      inventory_resource_mismatch:
        "Resource با Region، Plan یا Image قفل‌شده همخوان نیست.",
      inventory_already_assigned:
        "Resource قبلاً به سفارش دیگری اختصاص یافته است.",
    };
    return jsonError(
      safeMessages[code] ?? "ثبت موجودی واقعی ممکن نیست.",
      409,
      { code },
    );
  }
}
