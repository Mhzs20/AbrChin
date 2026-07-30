import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  IdempotencyConflictError,
  stableJson,
} from "@/lib/idempotency";

export type AuditInput = {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  beforeData?: Prisma.InputJsonValue;
  afterData?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
  idempotencyKey?: string | null;
};

export async function writeAuditLog(input: AuditInput, tx?: Prisma.TransactionClient) {
  const client = tx ?? prisma;
  if (input.idempotencyKey) {
    const existing = await client.auditLog.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      if (
        existing.actorUserId !== input.actorUserId ||
        existing.action !== input.action ||
        existing.entityType !== input.entityType ||
        existing.entityId !== (input.entityId ?? null) ||
        stableJson(existing.beforeData ?? null) !==
          stableJson(input.beforeData ?? null) ||
        stableJson(existing.afterData ?? null) !==
          stableJson(input.afterData ?? null)
      ) {
        throw new IdempotencyConflictError();
      }
      return existing;
    }
  }
  return client.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      beforeData: input.beforeData,
      afterData: input.afterData,
      ip: input.ip?.slice(0, 64) ?? null,
      userAgent: input.userAgent?.slice(0, 255) ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
    },
  });
}

export const AuditActions = {
  ROLE_CHANGE: "role_change",
  WALLET_ADJUSTMENT: "wallet_adjustment",
  REFUND: "refund",
  GATEWAY_CHANGE: "gateway_change",
  TOPUP_PRESET_CHANGE: "topup_preset_change",
  PLAN_CREATE: "plan_create",
  PLAN_UPDATE: "plan_update",
  PLAN_DISABLE: "plan_disable",
  FUNDING_CONFIRMATION: "funding_confirmation",
  PROVISIONING_RETRY: "provisioning_retry",
  HEALTH_CHECK_RETRY: "health_check_retry",
  HEALTH_CHECK_MANUAL_OBSERVE: "health_check_manual_observe",
  HEALTH_CHECK_MANUAL_RECOVERY: "health_check_manual_recovery",
  HEALTH_CHECK_MANUAL_RECOVERY_RESULT:
    "health_check_manual_recovery_result",
  RECONCILIATION: "reconciliation",
  PROVIDER_TOGGLE: "provider_toggle",
  NOTIFICATION_RESOLVE: "notification_resolve",
  CREDENTIAL_READY: "credential_ready",
  CREDENTIAL_REVEALED: "credential_revealed",
} as const;
