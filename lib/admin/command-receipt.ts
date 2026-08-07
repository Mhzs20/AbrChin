import { type Prisma } from "@prisma/client";

import { isEligibleAdmin } from "@/lib/admin/eligibility";
import {
  IdempotencyConflictError,
  idempotencyFingerprint,
} from "@/lib/idempotency";
import { WalletError } from "@/lib/wallet/errors";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;

export function normalizeAdminCommand(input: {
  operation: string;
  idempotencyKey: string;
  actorUserId: string;
  infrastructureOrderId?: string | null;
  serviceOrderId?: string | null;
  reason: string;
  payload?: Record<string, unknown>;
}) {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new WalletError(
      "invalid_reason",
      "دلیل عملیات باید بین ۳ تا ۵۰۰ کاراکتر باشد.",
    );
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)) {
    throw new WalletError(
      "invalid_idempotency_key",
      "شناسه یکتای عملیات معتبر نیست.",
    );
  }
  const requestFingerprint = idempotencyFingerprint({
    operation: input.operation,
    actorUserId: input.actorUserId,
    infrastructureOrderId: input.infrastructureOrderId ?? null,
    serviceOrderId: input.serviceOrderId ?? null,
    reason,
    payload: input.payload ?? {},
  });
  return {
    ...input,
    reason,
    requestFingerprint,
    receiptKey: `admin-command:${input.idempotencyKey}`,
  };
}

export async function assertAdminActorTx(
  tx: Prisma.TransactionClient,
  actorUserId: string,
) {
  const actor = await tx.user.findUnique({
    where: { id: actorUserId },
    select: { role: true, mobile: true },
  });
  if (!actor || !isEligibleAdmin(actor)) {
    throw new WalletError("forbidden", "دسترسی مجاز نیست.");
  }
}

export async function replayAdminCommandTx(
  tx: Prisma.TransactionClient,
  input: ReturnType<typeof normalizeAdminCommand>,
) {
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`command:${input.receiptKey}`}, 0)
    )::text AS locked
  `;
  const receipt = await tx.adminCommandReceipt.findUnique({
    where: { idempotencyKey: input.receiptKey },
  });
  if (!receipt) return null;
  if (
    receipt.operation !== input.operation ||
    receipt.requestFingerprint !== input.requestFingerprint ||
    receipt.actorUserId !== input.actorUserId ||
    receipt.infrastructureOrderId !==
      (input.infrastructureOrderId ?? null) ||
    receipt.serviceOrderId !== (input.serviceOrderId ?? null)
  ) {
    throw new IdempotencyConflictError();
  }
  return receipt.resultSnapshot;
}

export async function persistAdminCommandReceiptTx(
  tx: Prisma.TransactionClient,
  input: ReturnType<typeof normalizeAdminCommand>,
  resultSnapshot: Prisma.InputJsonValue,
) {
  return tx.adminCommandReceipt.create({
    data: {
      operation: input.operation,
      idempotencyKey: input.receiptKey,
      requestFingerprint: input.requestFingerprint,
      actorUserId: input.actorUserId,
      infrastructureOrderId: input.infrastructureOrderId ?? null,
      serviceOrderId: input.serviceOrderId ?? null,
      resultSnapshot,
    },
  });
}
