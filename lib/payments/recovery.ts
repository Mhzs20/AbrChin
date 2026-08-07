import {
  LedgerType,
  PaymentAttemptStatus,
  Prisma,
  TopUpStatus,
} from "@prisma/client";

import {
  assertAdminActorTx,
  normalizeAdminCommand,
  persistAdminCommandReceiptTx,
  replayAdminCommandTx,
} from "@/lib/admin/command-receipt";
import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import type { PaymentProvider as GatewayPaymentProvider } from "@/lib/payments/types";
import {
  reconcileVerifiedWalletCredit,
  verifyAndSettleTopUpAttempt,
} from "@/lib/wallet/topup";
import { WalletError } from "@/lib/wallet/errors";

type AdminActionInput = {
  actorUserId: string;
  idempotencyKey: string;
  reason: string;
  ip?: string | null;
  userAgent?: string | null;
};

type AttemptAdminActionInput = AdminActionInput & {
  attemptId: string;
};

async function preflightCommand(
  input: AttemptAdminActionInput,
  operation: string,
) {
  const command = normalizeAdminCommand({
    operation,
    idempotencyKey: input.idempotencyKey,
    actorUserId: input.actorUserId,
    reason: input.reason,
    payload: { attemptId: input.attemptId },
  });
  const replay = await prisma.$transaction(async (tx) => {
    await assertAdminActorTx(tx, input.actorUserId);
    return replayAdminCommandTx(tx, command);
  });
  return { command, replay };
}

async function persistAttemptAction(input: {
  command: ReturnType<typeof normalizeAdminCommand>;
  actionInput: AttemptAdminActionInput;
  auditAction: string;
  resultCode: string;
  resultSnapshot: Prisma.InputJsonObject;
}) {
  return prisma.$transaction(async (tx) => {
    await assertAdminActorTx(tx, input.actionInput.actorUserId);
    const replay = await replayAdminCommandTx(tx, input.command);
    if (replay) return replay;

    const attempt = await tx.paymentAttempt.findUniqueOrThrow({
      where: { id: input.actionInput.attemptId },
      include: { recoveryCase: true },
    });
    const recoveryCase =
      attempt.recoveryCase ??
      (await tx.paymentRecoveryCase.create({
        data: {
          walletTopUpId: attempt.walletTopUpId,
          attemptId: attempt.id,
          status:
            attempt.status === PaymentAttemptStatus.SUCCEEDED
              ? "RESOLVED"
              : "OPEN",
          reasonCode: "admin_recovery_action",
          safeMessage: "عملیات بازیابی کنترل‌شده مدیر",
          expectedAmount: attempt.amount,
          expectedCurrency: attempt.currency,
          resolvedAt:
            attempt.status === PaymentAttemptStatus.SUCCEEDED
              ? new Date()
              : null,
        },
      }));

    await tx.paymentRecoveryAction.create({
      data: {
        recoveryCaseId: recoveryCase.id,
        paymentAttemptId: attempt.id,
        actorUserId: input.actionInput.actorUserId,
        action: input.command.operation,
        resultCode: input.resultCode,
        idempotencyKey: `payment-recovery-action:${input.command.receiptKey}`,
        metadata: {
          reason: input.command.reason,
          ...input.resultSnapshot,
        },
      },
    });
    await writeAuditLog(
      {
        actorUserId: input.actionInput.actorUserId,
        action: input.auditAction,
        entityType: "PaymentAttempt",
        entityId: attempt.id,
        afterData: input.resultSnapshot,
        ip: input.actionInput.ip,
        userAgent: input.actionInput.userAgent,
        idempotencyKey: `audit:${input.command.receiptKey}`,
      },
      tx,
    );
    await persistAdminCommandReceiptTx(
      tx,
      input.command,
      input.resultSnapshot,
    );
    return input.resultSnapshot;
  });
}

export async function adminReverifyGateway(
  input: AttemptAdminActionInput,
  dependencies: { provider?: GatewayPaymentProvider } = {},
) {
  const { command, replay } = await preflightCommand(
    input,
    "payment_reverify_gateway",
  );
  if (replay) return replay;

  const result = await verifyAndSettleTopUpAttempt(
    { attemptId: input.attemptId },
    { provider: dependencies.provider },
  );
  const snapshot: Prisma.InputJsonObject = {
    attemptId: input.attemptId,
    attemptStatus: result.attempt.status,
    topUpStatus: result.topUp.status,
    credited: "credited" in result ? result.credited : false,
    review: result.review,
    failed: result.failed,
  };
  return persistAttemptAction({
    command,
    actionInput: input,
    auditAction: AuditActions.PAYMENT_REVERIFY,
    resultCode: result.review
      ? "review"
      : result.failed
        ? "failed"
        : "verified",
    resultSnapshot: snapshot,
  });
}

export async function adminReconcileWalletCredit(
  input: AttemptAdminActionInput,
) {
  const { command, replay } = await preflightCommand(
    input,
    "payment_reconcile_wallet_credit",
  );
  if (replay) return replay;

  const result = await reconcileVerifiedWalletCredit({
    attemptId: input.attemptId,
  });
  const snapshot: Prisma.InputJsonObject = {
    attemptId: input.attemptId,
    attemptStatus: result.attempt.status,
    topUpStatus: result.topUp.status,
    credited: result.credited,
  };
  return persistAttemptAction({
    command,
    actionInput: input,
    auditAction: AuditActions.WALLET_CREDIT_RECONCILE,
    resultCode: result.credited ? "credited" : "already_credited",
    resultSnapshot: snapshot,
  });
}

export async function adminMarkPaymentDefinitivelyFailed(
  input: AttemptAdminActionInput,
) {
  const command = normalizeAdminCommand({
    operation: "payment_mark_definitively_failed",
    idempotencyKey: input.idempotencyKey,
    actorUserId: input.actorUserId,
    reason: input.reason,
    payload: { attemptId: input.attemptId },
  });

  return prisma.$transaction(async (tx) => {
    await assertAdminActorTx(tx, input.actorUserId);
    const replay = await replayAdminCommandTx(tx, command);
    if (replay) return replay;
    await tx.$queryRaw`SELECT id FROM "PaymentAttempt" WHERE id = ${input.attemptId} FOR UPDATE`;
    const attempt = await tx.paymentAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
      include: { walletTopUp: true, recoveryCase: true },
    });
    if (
      attempt.status === PaymentAttemptStatus.SUCCEEDED ||
      attempt.walletTopUp.status === TopUpStatus.SUCCEEDED
    ) {
      throw new WalletError(
        "successful_payment_is_monotonic",
        "پرداخت موفق را نمی‌توان ناموفق علامت زد.",
      );
    }

    await tx.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: PaymentAttemptStatus.FAILED,
        failureCode: "admin_definitively_failed",
        failureMessage: "پس از بررسی مدیر، پرداخت قطعی ناموفق است",
        nextReconcileAt: null,
      },
    });
    await tx.walletTopUp.update({
      where: { id: attempt.walletTopUpId },
      data: {
        status: TopUpStatus.FAILED,
        failureCode: "admin_definitively_failed",
        failureMessage: "پس از بررسی مدیر، پرداخت قطعی ناموفق است",
      },
    });
    const recoveryCase =
      attempt.recoveryCase ??
      (await tx.paymentRecoveryCase.create({
        data: {
          walletTopUpId: attempt.walletTopUpId,
          attemptId: attempt.id,
          reasonCode: "admin_definitively_failed",
          safeMessage: "پرداخت پس از بررسی مدیر قطعی ناموفق است",
          expectedAmount: attempt.amount,
          expectedCurrency: attempt.currency,
        },
      }));
    await tx.paymentRecoveryCase.update({
      where: { id: recoveryCase.id },
      data: {
        status: "DEFINITIVELY_FAILED",
        resolvedAt: new Date(),
        nextAttemptAt: null,
      },
    });
    const snapshot: Prisma.InputJsonObject = {
      attemptId: attempt.id,
      attemptStatus: PaymentAttemptStatus.FAILED,
      topUpStatus: TopUpStatus.FAILED,
    };
    await tx.paymentRecoveryAction.create({
      data: {
        recoveryCaseId: recoveryCase.id,
        paymentAttemptId: attempt.id,
        actorUserId: input.actorUserId,
        action: command.operation,
        resultCode: "definitively_failed",
        idempotencyKey: `payment-recovery-action:${command.receiptKey}`,
        metadata: { reason: command.reason },
      },
    });
    await writeAuditLog(
      {
        actorUserId: input.actorUserId,
        action: AuditActions.PAYMENT_MARK_FAILED,
        entityType: "PaymentAttempt",
        entityId: attempt.id,
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

export async function requestControlledTopUpRefund(
  input: AdminActionInput & { topUpId: string },
) {
  const command = normalizeAdminCommand({
    operation: "controlled_topup_refund",
    idempotencyKey: input.idempotencyKey,
    actorUserId: input.actorUserId,
    reason: input.reason,
    payload: { topUpId: input.topUpId },
  });

  return prisma.$transaction(
    async (tx) => {
      await assertAdminActorTx(tx, input.actorUserId);
      const replay = await replayAdminCommandTx(tx, command);
      if (replay) return replay;
      await tx.$queryRaw`SELECT id FROM "WalletTopUp" WHERE id = ${input.topUpId} FOR UPDATE`;
      const topUp = await tx.walletTopUp.findUniqueOrThrow({
        where: { id: input.topUpId },
        include: { wallet: true },
      });
      if (topUp.status !== TopUpStatus.SUCCEEDED) {
        throw new WalletError(
          "refund_requires_success",
          "فقط شارژ موفق قابل بازپرداخت است.",
        );
      }
      await tx.$queryRaw`SELECT id FROM "Wallet" WHERE id = ${topUp.walletId} FOR UPDATE`;
      const existingApproved = await tx.walletTopUpRefund.findFirst({
        where: {
          walletTopUpId: topUp.id,
          status: { in: ["APPROVED", "COMPLETED"] },
        },
      });
      if (existingApproved) {
        throw new WalletError(
          "refund_already_approved",
          "بازپرداخت این شارژ قبلاً تأیید شده است.",
        );
      }

      const refund = await tx.walletTopUpRefund.create({
        data: {
          walletTopUpId: topUp.id,
          requestedById: input.actorUserId,
          reviewedById: input.actorUserId,
          amount: topUp.amount,
          currency: "IRR",
          status:
            topUp.wallet.availableBalance < topUp.amount
              ? "REVIEW_REQUIRED"
              : "REQUESTED",
          reason: command.reason,
          reviewReason:
            topUp.wallet.availableBalance < topUp.amount
              ? "wallet_credit_already_consumed"
              : "wallet_debit_reserved_before_external_refund",
          idempotencyKey: command.receiptKey,
          reviewedAt: new Date(),
        },
      });

      let ledgerEntryId: string | null = null;
      let status: "REVIEW_REQUIRED" | "APPROVED" = "REVIEW_REQUIRED";
      if (topUp.wallet.availableBalance >= topUp.amount) {
        const wallet = await tx.wallet.update({
          where: { id: topUp.walletId },
          data: { availableBalance: { decrement: topUp.amount } },
        });
        const ledger = await tx.walletLedgerEntry.create({
          data: {
            walletId: topUp.walletId,
            direction: "DEBIT",
            type: LedgerType.TOP_UP_REFUND,
            amount: topUp.amount,
            status: "COMPLETED",
            referenceType: "wallet_topup_refund",
            referenceId: refund.id,
            idempotencyKey: `topup_refund_debit:${topUp.id}`,
            balanceAfter: wallet.availableBalance,
            description:
              "کسر کنترل‌شده پیش از بازپرداخت بانکی شارژ کیف پول",
            metadata: {
              topUpId: topUp.id,
              gatewayRefund: "NOT_EXECUTED",
            },
          },
        });
        ledgerEntryId = ledger.id;
        status = "APPROVED";
        await tx.walletTopUpRefund.update({
          where: { id: refund.id },
          data: {
            status,
            ledgerEntryId,
          },
        });
        const { postWalletTopUpRefunded } = await import(
          "@/lib/accounting/posting"
        );
        await postWalletTopUpRefunded(
          {
            id: refund.id,
            walletTopUpId: topUp.id,
            amount: topUp.amount,
            occurredAt: refund.requestedAt,
          },
          tx,
        );
      }

      const snapshot: Prisma.InputJsonObject = {
        refundId: refund.id,
        topUpId: topUp.id,
        status,
        amountRial: topUp.amount.toString(),
        ledgerEntryId,
        gatewayRefundExecuted: false,
      };
      await writeAuditLog(
        {
          actorUserId: input.actorUserId,
          action: AuditActions.CONTROLLED_TOPUP_REFUND,
          entityType: "WalletTopUpRefund",
          entityId: refund.id,
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

export async function markControlledRefundExternallyCompleted(
  input: AdminActionInput & {
    refundId: string;
    gatewayRefundReference: string;
  },
) {
  const reference = input.gatewayRefundReference.trim();
  if (reference.length < 3 || reference.length > 191) {
    throw new WalletError(
      "invalid_gateway_refund_reference",
      "مرجع بازپرداخت بانکی معتبر نیست.",
    );
  }
  const command = normalizeAdminCommand({
    operation: "controlled_topup_refund_complete",
    idempotencyKey: input.idempotencyKey,
    actorUserId: input.actorUserId,
    reason: input.reason,
    payload: {
      refundId: input.refundId,
      gatewayRefundReference: reference,
    },
  });

  return prisma.$transaction(async (tx) => {
    await assertAdminActorTx(tx, input.actorUserId);
    const replay = await replayAdminCommandTx(tx, command);
    if (replay) return replay;
    const refund = await tx.walletTopUpRefund.findUniqueOrThrow({
      where: { id: input.refundId },
    });
    if (refund.status !== "APPROVED" || !refund.ledgerEntryId) {
      throw new WalletError(
        "refund_not_approved",
        "این بازپرداخت برای ثبت مرجع بانکی آماده نیست.",
      );
    }
    const completed = await tx.walletTopUpRefund.update({
      where: { id: refund.id },
      data: {
        status: "COMPLETED",
        gatewayRefundReference: reference,
        gatewayRefundedAt: new Date(),
        completedAt: new Date(),
        reviewedById: input.actorUserId,
      },
    });
    const snapshot: Prisma.InputJsonObject = {
      refundId: completed.id,
      status: completed.status,
      gatewayRefundReferenceRecorded: true,
    };
    await writeAuditLog(
      {
        actorUserId: input.actorUserId,
        action: AuditActions.CONTROLLED_TOPUP_REFUND_COMPLETED,
        entityType: "WalletTopUpRefund",
        entityId: completed.id,
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

export async function listPaymentRecoveryQueue() {
  return prisma.paymentRecoveryCase.findMany({
    where: {
      status: { in: ["OPEN", "RECONCILING", "REFUND_REVIEW"] },
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    include: {
      attempt: true,
      walletTopUp: {
        include: {
          wallet: {
            select: {
              userId: true,
              availableBalance: true,
              user: { select: { mobile: true, displayName: true } },
            },
          },
          paymentAttempts: { orderBy: { attemptNumber: "desc" } },
          controlledRefunds: { orderBy: { requestedAt: "desc" } },
        },
      },
      actions: { orderBy: { createdAt: "desc" } },
    },
  });
}
