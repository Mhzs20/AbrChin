import { LedgerType, Prisma } from "@prisma/client";

import {
  assertAdminActorTx,
  normalizeAdminCommand,
  persistAdminCommandReceiptTx,
  replayAdminCommandTx,
} from "@/lib/admin/command-receipt";
import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { WalletError } from "@/lib/wallet/errors";

export async function applyProviderBillingAdjustment(input: {
  billingReconciliationId: string;
  amountRial: bigint;
  reason: string;
  actorUserId: string;
  idempotencyKey: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  if (input.amountRial === 0n) {
    throw new WalletError(
      "invalid_adjustment_amount",
      "مبلغ تعدیل نمی‌تواند صفر باشد.",
    );
  }
  const command = normalizeAdminCommand({
    operation: "provider_billing_adjustment",
    idempotencyKey: input.idempotencyKey,
    actorUserId: input.actorUserId,
    reason: input.reason,
    payload: {
      billingReconciliationId: input.billingReconciliationId,
      amountRial: input.amountRial.toString(),
    },
  });

  return prisma.$transaction(
    async (tx) => {
      await assertAdminActorTx(tx, input.actorUserId);
      const replay = await replayAdminCommandTx(tx, command);
      if (replay) return replay;
      const reconciliation =
        await tx.billingReconciliation.findUniqueOrThrow({
          where: { id: input.billingReconciliationId },
          include: {
            billingInvoice: true,
            adjustments: true,
          },
        });
      if (
        !reconciliation.billingInvoice ||
        !reconciliation.cloudInstanceId
      ) {
        throw new WalletError(
          "adjustment_invoice_required",
          "تعدیل باید به صورتحساب و Resource مشخص متصل باشد.",
        );
      }
      if (reconciliation.adjustments.length > 0) {
        throw new WalletError(
          "adjustment_already_applied",
          "برای این مورد تطبیق قبلاً تعدیل ثبت شده است.",
        );
      }
      const invoice = reconciliation.billingInvoice;
      await tx.$queryRaw`SELECT id FROM "Wallet" WHERE id = ${invoice.walletId} FOR UPDATE`;
      const wallet = await tx.wallet.findUniqueOrThrow({
        where: { id: invoice.walletId },
      });

      const isDebit = input.amountRial > 0n;
      const absoluteAmount = isDebit
        ? input.amountRial
        : -input.amountRial;
      const settledAmountRial = isDebit
        ? wallet.availableBalance < absoluteAmount
          ? wallet.availableBalance
          : absoluteAmount
        : absoluteAmount;
      const outstandingAmountRial = isDebit
        ? absoluteAmount - settledAmountRial
        : 0n;

      let balanceAfter = wallet.availableBalance;
      if (settledAmountRial > 0n) {
        const updatedWallet = await tx.wallet.update({
          where: { id: wallet.id },
          data: isDebit
            ? {
                availableBalance: {
                  decrement: settledAmountRial,
                },
              }
            : {
                availableBalance: {
                  increment: settledAmountRial,
                },
              },
        });
        balanceAfter = updatedWallet.availableBalance;
      }
      const adjustment = await tx.billingAdjustment.create({
        data: {
          billingReconciliationId: reconciliation.id,
          billingInvoiceId: invoice.id,
          userId: invoice.userId,
          walletId: invoice.walletId,
          cloudInstanceId: reconciliation.cloudInstanceId,
          amountRial: input.amountRial,
          settledAmountRial,
          outstandingAmountRial,
          reason: command.reason,
          idempotencyKey: command.receiptKey,
          createdById: input.actorUserId,
        },
      });
      let ledgerEntryId: string | null = null;
      if (settledAmountRial > 0n) {
        const ledger = await tx.walletLedgerEntry.create({
          data: {
            walletId: wallet.id,
            direction: isDebit ? "DEBIT" : "CREDIT",
            type: LedgerType.BILLING_ADJUSTMENT,
            amount: settledAmountRial,
            status: "COMPLETED",
            referenceType: "billing_adjustment",
            referenceId: adjustment.id,
            idempotencyKey: `billing-adjustment-ledger:${reconciliation.id}`,
            balanceAfter,
            description: "تعدیل کنترل‌شده تطبیق هزینه Provider",
            metadata: {
              billingInvoiceId: invoice.id,
              billingReconciliationId: reconciliation.id,
              reason: command.reason,
            },
          },
        });
        ledgerEntryId = ledger.id;
        await tx.billingAdjustment.update({
          where: { id: adjustment.id },
          data: { ledgerEntryId },
        });
      }
      await tx.billingReconciliation.update({
        where: { id: reconciliation.id },
        data: {
          status: "ADJUSTED",
          differenceRial: input.amountRial,
          reason: command.reason,
          resolvedAt: new Date(),
        },
      });
      const snapshot: Prisma.InputJsonObject = {
        adjustmentId: adjustment.id,
        billingReconciliationId: reconciliation.id,
        amountRial: input.amountRial.toString(),
        settledAmountRial: settledAmountRial.toString(),
        outstandingAmountRial: outstandingAmountRial.toString(),
        ledgerEntryId,
      };
      await writeAuditLog(
        {
          actorUserId: input.actorUserId,
          action: AuditActions.BILLING_ADJUSTMENT,
          entityType: "BillingAdjustment",
          entityId: adjustment.id,
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
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}
