import assert from "node:assert/strict";
import test, { after } from "node:test";
import { LedgerType, PrismaClient, WalletStatus } from "@prisma/client";

import { assertPositiveIntegerToman, rialToToman, tomanToRial } from "../lib/money.ts";
import {
  calculateWalletShortfallRial,
  DEFAULT_TOPUP_SUGGESTIONS_TOMAN,
  normalizeSuggestedAmounts,
} from "../lib/wallet/topup-limits.ts";
import { WalletError } from "../lib/wallet/errors.ts";

const databaseUrl = process.env.DATABASE_URL;
const prisma = databaseUrl ? new PrismaClient() : null;

after(async () => {
  if (prisma) await prisma.$disconnect();
});

test("money converts toman/rial with integers only", () => {
  assert.equal(tomanToRial(1000n), 10_000n);
  assert.equal(rialToToman(10_000n), 1000n);
  assert.equal(assertPositiveIntegerToman(50_000), 50_000);
  assert.throws(() => assertPositiveIntegerToman(12.5));
  assert.throws(() => assertPositiveIntegerToman(-1));
});

test("purchase top-up is exactly the wallet shortfall in IRR", () => {
  assert.equal(calculateWalletShortfallRial(6_250_009n, 1_250_000n), 5_000_009n);
  assert.equal(calculateWalletShortfallRial(6_250_009n, 6_250_009n), 0n);
  assert.equal(calculateWalletShortfallRial(6_250_009n, 7_000_000n), 0n);
});

test("wallet credit debit and negative balance protection", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }

  const mobile = "09127770001";
  await prisma.session.deleteMany({ where: { user: { mobile } } });
  await prisma.serviceOrder.deleteMany({ where: { user: { mobile } } });
  await prisma.walletLedgerEntry.deleteMany({ where: { wallet: { user: { mobile } } } });
  await prisma.walletTopUp.deleteMany({ where: { wallet: { user: { mobile } } } });
  await prisma.wallet.deleteMany({ where: { user: { mobile } } });
  await prisma.user.deleteMany({ where: { mobile } });

  const user = await prisma.user.create({ data: { mobile } });
  const wallet = await prisma.wallet.create({
    data: { userId: user.id, availableBalance: 0n, status: WalletStatus.ACTIVE },
  });

  const credited = await prisma.$transaction(async (tx) => {
    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { availableBalance: { increment: tomanToRial(100_000) } },
    });
    return tx.walletLedgerEntry.create({
      data: {
        walletId: wallet.id,
        direction: "CREDIT",
        type: LedgerType.TOP_UP,
        amount: tomanToRial(100_000),
        status: "COMPLETED",
        idempotencyKey: `test_credit_${user.id}`,
        balanceAfter: updated.availableBalance,
      },
    });
  });
  assert.equal(credited.balanceAfter, 1_000_000n);

  const debited = await prisma.$transaction(async (tx) => {
    const updated = await tx.wallet.updateMany({
      where: { id: wallet.id, availableBalance: { gte: tomanToRial(40_000) } },
      data: { availableBalance: { decrement: tomanToRial(40_000) } },
    });
    assert.equal(updated.count, 1);
    const fresh = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    return tx.walletLedgerEntry.create({
      data: {
        walletId: wallet.id,
        direction: "DEBIT",
        type: LedgerType.SERVICE_PURCHASE,
        amount: tomanToRial(40_000),
        status: "COMPLETED",
        idempotencyKey: `test_debit_${user.id}`,
        balanceAfter: fresh.availableBalance,
      },
    });
  });
  assert.equal(debited.balanceAfter, 600_000n);

  const overspend = await prisma.wallet.updateMany({
    where: { id: wallet.id, availableBalance: { gte: tomanToRial(100_000) } },
    data: { availableBalance: { decrement: tomanToRial(100_000) } },
  });
  assert.equal(overspend.count, 0);

  const fresh = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
  assert.equal(fresh.availableBalance, 600_000n);
});

test("topup suggestion defaults and validation", async (t) => {
  assert.deepEqual(normalizeSuggestedAmounts([...DEFAULT_TOPUP_SUGGESTIONS_TOMAN]), [
    1_000_000,
    5_000_000,
    10_000_000,
    20_000_000,
  ]);
  assert.throws(() => normalizeSuggestedAmounts([1_000_000, 2_000_000]), WalletError);
  assert.throws(() => normalizeSuggestedAmounts([1_000_000, 1_000_000, 2_000_000, 3_000_000]), WalletError);

  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }

  const settings = await prisma.walletTopUpSettings.findUnique({ where: { id: "default" } });
  assert.ok(settings);
  assert.deepEqual(normalizeSuggestedAmounts(settings.suggestedAmountsToman), [
    1_000_000,
    5_000_000,
    10_000_000,
    20_000_000,
  ]);
});

test("one wallet per user unique constraint", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }
  const mobile = "09127770002";
  await prisma.wallet.deleteMany({ where: { user: { mobile } } });
  await prisma.user.deleteMany({ where: { mobile } });
  const user = await prisma.user.create({ data: { mobile } });
  await prisma.wallet.create({ data: { userId: user.id } });
  await assert.rejects(() => prisma.wallet.create({ data: { userId: user.id } }));
});
