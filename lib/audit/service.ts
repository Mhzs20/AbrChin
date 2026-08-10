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

function assertAuditReplay(
  existing: {
    actorUserId: string;
    action: string;
    entityType: string;
    entityId: string | null;
    beforeData: Prisma.JsonValue | null;
    afterData: Prisma.JsonValue | null;
  },
  input: AuditInput,
) {
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
}

async function writeAuditLogTx(
  tx: Prisma.TransactionClient,
  input: AuditInput,
) {
  if (input.idempotencyKey) {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`audit:${input.idempotencyKey}`}, 0)
      )::text AS locked
    `;
    const existing = await tx.auditLog.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      assertAuditReplay(existing, input);
      return existing;
    }
  }
  const data = {
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    beforeData: input.beforeData,
    afterData: input.afterData,
    ip: input.ip?.slice(0, 64) ?? null,
    userAgent: input.userAgent?.slice(0, 255) ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
  };
  if (!input.idempotencyKey) {
    return tx.auditLog.create({ data });
  }
  const inserted = await tx.auditLog.createMany({
    data: [data],
    skipDuplicates: true,
  });
  const persisted = await tx.auditLog.findUniqueOrThrow({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (inserted.count === 0) {
    assertAuditReplay(persisted, input);
  }
  return persisted;
}

export async function writeAuditLog(
  input: AuditInput,
  tx?: Prisma.TransactionClient,
) {
  if (tx) return writeAuditLogTx(tx, input);
  return prisma.$transaction((transaction) =>
    writeAuditLogTx(transaction, input),
  );
}

export const AuditActions = {
  ROLE_CHANGE: "role_change",
  USER_CREATE: "user_create",
  USER_UPDATE: "user_update",
  USER_BLOCK: "user_block",
  USER_UNBLOCK: "user_unblock",
  USER_DELETE: "user_delete",
  USER_TRANSFER_SERVER: "user_transfer_server",
  USER_ATTACH_SERVER: "user_attach_server",
  WALLET_ADJUSTMENT: "wallet_adjustment",
  REFUND: "refund",
  PAYMENT_REVERIFY: "payment_reverify",
  WALLET_CREDIT_RECONCILE: "wallet_credit_reconcile",
  PAYMENT_MARK_FAILED: "payment_mark_definitively_failed",
  CONTROLLED_TOPUP_REFUND: "controlled_topup_refund",
  CONTROLLED_TOPUP_REFUND_COMPLETED:
    "controlled_topup_refund_completed",
  BILLING_ADJUSTMENT: "billing_adjustment",
  BILLING_POLICY_UPDATE: "billing_policy_update",
  BILLING_CADENCE_CHANGE: "billing_cadence_change",
  ACTIVATION_REQUESTED: "activation_requested",
  ACTIVATION_APPROVED: "activation_approved",
  RESOURCE_CHANGE_APPROVED: "resource_change_approved",
  RESOURCE_CHANGE_REQUESTED: "resource_change_requested",
  SUSPENSION_APPROVED: "controlled_suspension_approved",
  PROVIDER_BILLING_REVIEW: "provider_billing_review",
  GATEWAY_CHANGE: "gateway_change",
  TOPUP_PRESET_CHANGE: "topup_preset_change",
  PLAN_CREATE: "plan_create",
  PLAN_UPDATE: "plan_update",
  PLAN_DISABLE: "plan_disable",
  FUNDING_CONFIRMATION: "funding_confirmation",
  PROVISION_APPROVED: "provision_approved",
  PROVISION_APPROVAL_BLOCKED: "provision_approval_blocked",
  PROVISION_HELD: "provision_held",
  PROVISION_DISPATCHED: "provision_dispatched",
  MANUAL_PROVISION: "manual_provision",
  PROVISIONING_RETRY: "provisioning_retry",
  HEALTH_CHECK_RETRY: "health_check_retry",
  HEALTH_CHECK_MANUAL_OBSERVE: "health_check_manual_observe",
  HEALTH_CHECK_MANUAL_RECOVERY: "health_check_manual_recovery",
  HEALTH_CHECK_MANUAL_RECOVERY_RESULT:
    "health_check_manual_recovery_result",
  RECONCILIATION: "reconciliation",
  PROVIDER_TOGGLE: "provider_toggle",
  PROVIDER_REGION_UPSERT: "provider_region_upsert",
  PROVIDER_REGION_UPDATE: "provider_region_update",
  PROVIDER_REGION_DISCOVER: "provider_region_discover",
  MANUAL_CATALOG_CREATE: "manual_catalog_create",
  MANUAL_CATALOG_UPDATE: "manual_catalog_update",
  PREPROVISIONED_INVENTORY_OBSERVE:
    "preprovisioned_inventory_observe",
  PREPROVISIONED_INVENTORY_CREDENTIAL_UPSERT:
    "preprovisioned_inventory_credential_upsert",
  MANUAL_READY_DELIVERY: "manual_ready_delivery",
  STOREFRONT_ASSORTMENT_UPDATE: "storefront_assortment_update",
  NOTIFICATION_RESOLVE: "notification_resolve",
  CREDENTIAL_READY: "credential_ready",
  CREDENTIAL_ADMIN_REVIEWED: "credential_admin_reviewed",
  CREDENTIAL_REVEALED: "credential_revealed",
  DELIVERY_APPROVED: "delivery_approved",
  DELIVERY_APPROVAL_BLOCKED: "delivery_approval_blocked",
  DELIVERY_HELD: "delivery_held",
  PARCHIN_TASK_UPDATE: "parchin_task_update",
  PARCHIN_REPORT_CREATE: "parchin_report_create",
  PARCHIN_LEVEL_REQUEST: "parchin_level_request",
} as const;
