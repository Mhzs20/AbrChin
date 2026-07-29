import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

export type AuditInput = {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  beforeData?: Prisma.InputJsonValue;
  afterData?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
};

export async function writeAuditLog(input: AuditInput, tx?: Prisma.TransactionClient) {
  const client = tx ?? prisma;
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
  RECONCILIATION: "reconciliation",
  PROVIDER_TOGGLE: "provider_toggle",
  NOTIFICATION_RESOLVE: "notification_resolve",
  CREDENTIAL_READY: "credential_ready",
  CREDENTIAL_REVEALED: "credential_revealed",
} as const;
