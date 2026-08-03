import { Prisma } from "@prisma/client";

import {
  assertAdminActorTx,
  normalizeAdminCommand,
  persistAdminCommandReceiptTx,
  replayAdminCommandTx,
} from "@/lib/admin/command-receipt";
import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { WalletError } from "@/lib/wallet/errors";

export async function enqueueExpiredDunningForSuspensionReview(
  now = new Date(),
) {
  return prisma.$transaction(async (tx) => {
    const expiredCases = await tx.dunningCase.findMany({
      where: {
        type: "OUTSTANDING_INVOICE",
        status: { in: ["OPEN", "NOTIFIED", "GRACE"] },
        graceEndsAt: { lte: now },
      },
      include: { cloudInstance: true },
    });
    let created = 0;
    for (const item of expiredCases) {
      const key = `dunning:suspension-review:${item.cloudInstanceId}`;
      const existing = await tx.dunningCase.findUnique({
        where: { idempotencyKey: key },
      });
      await tx.dunningCase.upsert({
        where: { idempotencyKey: key },
        create: {
          cloudInstanceId: item.cloudInstanceId,
          billingInvoiceId: item.billingInvoiceId,
          type: "SUSPENSION_REVIEW",
          status: "ADMIN_REVIEW",
          thresholdRial: item.thresholdRial,
          observedBalanceRial: item.observedBalanceRial,
          runwaySeconds: item.runwaySeconds,
          graceEndsAt: item.graceEndsAt,
          idempotencyKey: key,
        },
        update: {
          billingInvoiceId: item.billingInvoiceId,
          status: "ADMIN_REVIEW",
          observedBalanceRial: item.observedBalanceRial,
          resolvedAt: null,
        },
      });
      if (!existing) {
        created += 1;
        await tx.adminNotification.create({
          data: {
            type: "SUSPENSION_REVIEW",
            infrastructureOrderId:
              item.cloudInstance.infrastructureOrderId,
            title: "بررسی تعلیق سرویس",
            message:
              "Grace period ended. No automatic suspend or terminate was executed.",
          },
        });
      }
      await tx.dunningCase.update({
        where: { id: item.id },
        data: { status: "ADMIN_REVIEW" },
      });
    }
    return { reviewed: expiredCases.length, created };
  });
}

export async function approveControlledSuspensionRequest(input: {
  dunningCaseId: string;
  actorUserId: string;
  idempotencyKey: string;
  reason: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const command = normalizeAdminCommand({
    operation: "approve_controlled_suspension",
    idempotencyKey: input.idempotencyKey,
    actorUserId: input.actorUserId,
    reason: input.reason,
    payload: { dunningCaseId: input.dunningCaseId },
  });
  return prisma.$transaction(async (tx) => {
    await assertAdminActorTx(tx, input.actorUserId);
    const replay = await replayAdminCommandTx(tx, command);
    if (replay) return replay;
    const dunning = await tx.dunningCase.findUniqueOrThrow({
      where: { id: input.dunningCaseId },
      include: {
        cloudInstance: {
          include: {
            resourceVersions: {
              where: { effectiveTo: null },
              take: 1,
            },
          },
        },
      },
    });
    if (
      dunning.type !== "SUSPENSION_REVIEW" ||
      dunning.status !== "ADMIN_REVIEW"
    ) {
      throw new WalletError(
        "suspension_not_eligible",
        "پرونده برای تأیید تعلیق آماده نیست.",
      );
    }
    const current = dunning.cloudInstance.resourceVersions[0];
    if (!current || current.state === "TERMINATED") {
      throw new WalletError(
        "resource_state_not_suspendable",
        "Resource فعال قابل تعلیق پیدا نشد.",
      );
    }
    const request = await tx.resourceChangeRequest.create({
      data: {
        cloudInstanceId: dunning.cloudInstanceId,
        planId: current.planId,
        requestedById: input.actorUserId,
        approvedById: input.actorUserId,
        sourceResourceVersionId: current.id,
        requestedResources: {
          action: "SUSPEND",
          providerMutationExecuted: false,
        },
        estimateSnapshot: {
          reason: command.reason,
          customerBillingEffect:
            "provider_policy_applies_after_provider_confirmation",
        },
        status: "APPROVED",
        idempotencyKey: `suspension-request:${command.receiptKey}`,
        approvedAt: new Date(),
      },
    });
    await tx.dunningCase.update({
      where: { id: dunning.id },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
    const snapshot: Prisma.InputJsonObject = {
      dunningCaseId: dunning.id,
      resourceChangeRequestId: request.id,
      providerMutationExecuted: false,
      automaticTermination: false,
    };
    await writeAuditLog(
      {
        actorUserId: input.actorUserId,
        action: AuditActions.SUSPENSION_APPROVED,
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
  });
}
