import type { Prisma, PrismaClient, Wallet } from "@prisma/client";

import { prisma } from "@/lib/db";

type Db = PrismaClient | Prisma.TransactionClient;

export async function ensureWalletForUser(userId: string, db: Db = prisma): Promise<Wallet> {
  const existing = await db.wallet.findUnique({ where: { userId } });
  if (existing) return existing;

  try {
    return await db.wallet.create({
      data: {
        userId,
        currency: "IRR",
        availableBalance: 0n,
      },
    });
  } catch (error) {
    // Concurrent first-login races: recover the row created by the other transaction.
    const raced = await db.wallet.findUnique({ where: { userId } });
    if (raced) return raced;
    throw error;
  }
}
