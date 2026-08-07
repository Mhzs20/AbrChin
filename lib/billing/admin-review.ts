import { Prisma } from "@prisma/client";

import {
  assertAdminActorTx,
  normalizeAdminCommand,
  persistAdminCommandReceiptTx,
  replayAdminCommandTx,
} from "@/lib/admin/command-receipt";
import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { upgradeQuoteHasFinancialCommitment } from "@/lib/orders/upgrade-quote";
import { WalletError } from "@/lib/wallet/errors";

export async function approveResourceChangeRequest(input: {
  resourceChangeRequestId: string;
  actorUserId: string;
  reason: string;
  idempotencyKey: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const command = normalizeAdminCommand({
    operation: "approve_resource_change",
    idempotencyKey: input.idempotencyKey,
    actorUserId: input.actorUserId,
    reason: input.reason,
    payload: { resourceChangeRequestId: input.resourceChangeRequestId },
  });
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM "ResourceChangeRequest"
        WHERE id = ${input.resourceChangeRequestId}
        FOR UPDATE
      `;
      await assertAdminActorTx(tx, input.actorUserId);
      const replay = await replayAdminCommandTx(tx, command);
      if (replay) return replay;
      const request = await tx.resourceChangeRequest.findUniqueOrThrow({
        where: { id: input.resourceChangeRequestId },
        include: {
          cloudInstance: {
            include: {
              user: { include: { wallet: true } },
            },
          },
        },
      });
      if (!["REQUESTED", "WAITING_ADMIN_APPROVAL"].includes(request.status)) {
        throw new WalletError(
          "resource_change_not_eligible",
          "درخواست تغییر منابع در صف تأیید Admin نیست.",
        );
      }
      if (
        request.incrementalBufferRial > 0n &&
        !upgradeQuoteHasFinancialCommitment(request.estimateSnapshot) &&
        (!request.cloudInstance.user.wallet ||
          request.cloudInstance.user.wallet.availableBalance <
            request.incrementalBufferRial)
      ) {
        await tx.resourceChangeRequest.update({
          where: { id: request.id },
          data: { status: "CREDIT_REQUIRED" },
        });
        throw new WalletError(
          "insufficient_credit",
          "اعتبار Wallet برای Buffer افزایشی کافی نیست.",
        );
      }
      const approvedAt = new Date();
      await tx.resourceChangeRequest.update({
        where: { id: request.id },
        data: {
          status: "APPROVED",
          approvedById: input.actorUserId,
          approvedAt,
        },
      });
      const snapshot: Prisma.InputJsonObject = {
        resourceChangeRequestId: request.id,
        status: "APPROVED",
        providerMutationExecuted: false,
        incrementalBufferRial: request.incrementalBufferRial.toString(),
      };
      await writeAuditLog(
        {
          actorUserId: input.actorUserId,
          action: AuditActions.RESOURCE_CHANGE_APPROVED,
          entityType: "ResourceChangeRequest",
          entityId: request.id,
          afterData: snapshot,
          ip: input.ip,
          userAgent: input.userAgent,
          idempotencyKey: `audit:${command.receiptKey}`,
        },
        tx,
      );
      await persistAdminCommandReceiptTx(tx, command, snapshot);
      return snapshot;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function markProviderBillingReconciliationForReview(input: {
  billingReconciliationId: string;
  actorUserId: string;
  reason: string;
  idempotencyKey: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const command = normalizeAdminCommand({
    operation: "review_provider_billing_reconciliation",
    idempotencyKey: input.idempotencyKey,
    actorUserId: input.actorUserId,
    reason: input.reason,
    payload: {
      billingReconciliationId: input.billingReconciliationId,
    },
  });
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM "BillingReconciliation"
        WHERE id = ${input.billingReconciliationId}
        FOR UPDATE
      `;
      await assertAdminActorTx(tx, input.actorUserId);
      const replay = await replayAdminCommandTx(tx, command);
      if (replay) return replay;
      const reconciliation =
        await tx.billingReconciliation.findUniqueOrThrow({
          where: { id: input.billingReconciliationId },
        });
      if (!["PENDING", "MISMATCH"].includes(reconciliation.status)) {
        throw new WalletError(
          "billing_reconciliation_not_eligible",
          "این تطبیق برای ورود به Review آماده نیست.",
        );
      }
      await tx.billingReconciliation.update({
        where: { id: reconciliation.id },
        data: { status: "REVIEW", reason: command.reason },
      });
      const snapshot: Prisma.InputJsonObject = {
        billingReconciliationId: reconciliation.id,
        from: reconciliation.status,
        to: "REVIEW",
        walletChanged: false,
      };
      await writeAuditLog(
        {
          actorUserId: input.actorUserId,
          action: AuditActions.PROVIDER_BILLING_REVIEW,
          entityType: "BillingReconciliation",
          entityId: reconciliation.id,
          afterData: snapshot,
          ip: input.ip,
          userAgent: input.userAgent,
          idempotencyKey: `audit:${command.receiptKey}`,
        },
        tx,
      );
      await persistAdminCommandReceiptTx(tx, command, snapshot);
      return snapshot;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
