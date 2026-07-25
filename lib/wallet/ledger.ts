import {
  LedgerDirection,
  LedgerStatus,
  LedgerType,
  Prisma,
  WalletStatus,
  type WalletLedgerEntry,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { ensureWalletForUser } from "@/lib/wallet/ensure-wallet";
import { WalletError } from "@/lib/wallet/errors";

export { WalletError } from "@/lib/wallet/errors";

export type CreditInput = {
  userId: string;
  amountRial: bigint;
  type: LedgerType;
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: string;
  description?: string;
  metadata?: Prisma.InputJsonValue;
};

export type DebitInput = CreditInput;

async function findByIdempotency(idempotencyKey: string) {
  return prisma.walletLedgerEntry.findUnique({ where: { idempotencyKey } });
}

export async function creditWallet(input: CreditInput): Promise<WalletLedgerEntry> {
  if (input.amountRial <= 0n) {
    throw new WalletError("invalid_amount", "Credit amount must be positive");
  }

  const existing = await findByIdempotency(input.idempotencyKey);
  if (existing) {
    if (existing.status === LedgerStatus.COMPLETED && existing.direction === LedgerDirection.CREDIT) {
      return existing;
    }
    throw new WalletError("idempotency_conflict", "Idempotency key already used");
  }

  return prisma.$transaction(async (tx) => {
    const wallet = await ensureWalletForUser(input.userId, tx);
    if (wallet.status !== WalletStatus.ACTIVE) {
      throw new WalletError("wallet_frozen", "Wallet is not active");
    }

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { availableBalance: { increment: input.amountRial } },
    });

    return tx.walletLedgerEntry.create({
      data: {
        walletId: wallet.id,
        direction: LedgerDirection.CREDIT,
        type: input.type,
        amount: input.amountRial,
        status: LedgerStatus.COMPLETED,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        idempotencyKey: input.idempotencyKey,
        balanceAfter: updated.availableBalance,
        description: input.description,
        metadata: input.metadata,
      },
    });
  });
}

export async function debitWallet(input: DebitInput): Promise<WalletLedgerEntry> {
  if (input.amountRial <= 0n) {
    throw new WalletError("invalid_amount", "Debit amount must be positive");
  }

  const existing = await findByIdempotency(input.idempotencyKey);
  if (existing) {
    if (existing.status === LedgerStatus.COMPLETED && existing.direction === LedgerDirection.DEBIT) {
      return existing;
    }
    throw new WalletError("idempotency_conflict", "Idempotency key already used");
  }

  return prisma.$transaction(async (tx) => {
    const wallet = await ensureWalletForUser(input.userId, tx);
    if (wallet.status !== WalletStatus.ACTIVE) {
      throw new WalletError("wallet_frozen", "Wallet is not active");
    }

    // Atomic conditional debit prevents concurrent double-spend.
    const updated = await tx.wallet.updateMany({
      where: {
        id: wallet.id,
        availableBalance: { gte: input.amountRial },
        status: WalletStatus.ACTIVE,
      },
      data: { availableBalance: { decrement: input.amountRial } },
    });

    if (updated.count !== 1) {
      throw new WalletError("insufficient_funds", "موجودی کافی نیست.");
    }

    const fresh = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });

    return tx.walletLedgerEntry.create({
      data: {
        walletId: wallet.id,
        direction: LedgerDirection.DEBIT,
        type: input.type,
        amount: input.amountRial,
        status: LedgerStatus.COMPLETED,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        idempotencyKey: input.idempotencyKey,
        balanceAfter: fresh.availableBalance,
        description: input.description,
        metadata: input.metadata,
      },
    });
  });
}

export async function reverseLedgerEntry(params: {
  userId: string;
  originalEntryId: string;
  idempotencyKey: string;
  description?: string;
  metadata?: Prisma.InputJsonValue;
}): Promise<WalletLedgerEntry> {
  const existing = await findByIdempotency(params.idempotencyKey);
  if (existing) {
    if (existing.status === LedgerStatus.COMPLETED) return existing;
    throw new WalletError("idempotency_conflict", "Idempotency key already used");
  }

  return prisma.$transaction(async (tx) => {
    const original = await tx.walletLedgerEntry.findUnique({ where: { id: params.originalEntryId } });
    if (!original || original.status !== LedgerStatus.COMPLETED) {
      throw new WalletError("invalid_entry", "Original ledger entry is not reversible");
    }

    const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: original.walletId } });
    if (wallet.userId !== params.userId) {
      throw new WalletError("forbidden", "Ledger entry does not belong to user");
    }

    if (original.direction === LedgerDirection.DEBIT) {
      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { availableBalance: { increment: original.amount } },
      });
      const credit = await tx.walletLedgerEntry.create({
        data: {
          walletId: wallet.id,
          direction: LedgerDirection.CREDIT,
          type: LedgerType.REFUND,
          amount: original.amount,
          status: LedgerStatus.COMPLETED,
          referenceType: "ledger",
          referenceId: original.id,
          idempotencyKey: params.idempotencyKey,
          balanceAfter: updated.availableBalance,
          description: params.description ?? "بازگشت وجه",
          metadata: params.metadata,
          reversedEntryId: original.id,
        },
      });
      await tx.walletLedgerEntry.update({
        where: { id: original.id },
        data: { status: LedgerStatus.REVERSED },
      });
      return credit;
    }

    const updated = await tx.wallet.updateMany({
      where: {
        id: wallet.id,
        availableBalance: { gte: original.amount },
      },
      data: { availableBalance: { decrement: original.amount } },
    });
    if (updated.count !== 1) {
      throw new WalletError("insufficient_funds", "موجودی برای برگشت کافی نیست.");
    }
    const fresh = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    const debit = await tx.walletLedgerEntry.create({
      data: {
        walletId: wallet.id,
        direction: LedgerDirection.DEBIT,
        type: LedgerType.ADMIN_ADJUSTMENT,
        amount: original.amount,
        status: LedgerStatus.COMPLETED,
        referenceType: "ledger",
        referenceId: original.id,
        idempotencyKey: params.idempotencyKey,
        balanceAfter: fresh.availableBalance,
        description: params.description ?? "برگشت اعتبار",
        metadata: params.metadata,
        reversedEntryId: original.id,
      },
    });
    await tx.walletLedgerEntry.update({
      where: { id: original.id },
      data: { status: LedgerStatus.REVERSED },
    });
    return debit;
  });
}
