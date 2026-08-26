import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";

import {
  MessageGoReservationStatus,
  UserAccountStatus,
  WalletStatus,
} from "@prisma/client";

import { prisma } from "../lib/db.ts";
import { isSettlementError } from "../lib/messagego/settlement/amount.ts";
import {
  reconcileWalletAuthority,
  releaseWalletAuthority,
  reserveWalletAuthority,
  settleWalletAuthority,
} from "../lib/messagego/settlement/authority.ts";

if (!process.env.DATABASE_URL || process.env.ABRCHIN_ISOLATED_TEST !== "1") {
  throw new Error("MessageGo V2 settlement tests require isolated PostgreSQL");
}

after(async () => {
  await prisma.$disconnect();
});

function ids(label: string) {
  const suffix = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}-${label}`;
  return {
    suffix,
    operationId: `op_${suffix}`,
    productId: "prod_a",
    workspaceId: "ws_a",
    runId: `run_${suffix}`,
    usageReservationId: `ures_${suffix}`,
    callerServiceId: "messagego-test",
    pricingFingerprint: "ab".repeat(32),
    pricingVersion: "price.v2.test",
  };
}

async function fundedAccount(label: string, balanceRial = 1000n) {
  const mobile = `09${randomBytes(6).readUIntBE(0, 6).toString().padStart(11, "0").slice(0, 9)}`;
  const user = await prisma.user.create({
    data: { mobile, accountStatus: UserAccountStatus.ACTIVE },
  });
  const wallet = await prisma.wallet.create({
    data: {
      userId: user.id,
      availableBalance: balanceRial,
      status: WalletStatus.ACTIVE,
    },
  });
  return { ...ids(label), user, wallet, accountId: user.id };
}

async function balance(walletId: string) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
  return wallet.availableBalance;
}

async function ledgerCount(walletId: string) {
  return prisma.walletLedgerEntry.count({ where: { walletId } });
}

test("reserve settle leftover is idempotent and keeps AbrChin wallet authoritative", async () => {
  const fx = await fundedAccount("happy", 1000n);
  const reserveInput = {
    operationId: fx.operationId,
    accountId: fx.accountId,
    productId: fx.productId,
    workspaceId: fx.workspaceId,
    runId: fx.runId,
    usageReservationId: fx.usageReservationId,
    callerServiceId: fx.callerServiceId,
    holdAmount: "250",
    pricingFingerprint: fx.pricingFingerprint,
    pricingVersion: fx.pricingVersion,
  };
  const first = await reserveWalletAuthority(reserveInput);
  const replay = await reserveWalletAuthority(reserveInput);
  assert.equal(first.authority_reservation_id, replay.authority_reservation_id);
  assert.equal(first.status, "reserved");
  assert.equal(await balance(fx.wallet.id), 750n);
  assert.equal(await ledgerCount(fx.wallet.id), 1);

  await assert.rejects(
    () => reserveWalletAuthority({ ...reserveInput, holdAmount: "251" }),
    (error: unknown) => isSettlementError(error) && error.code === "idempotency_conflict",
  );
  assert.equal(await balance(fx.wallet.id), 750n);

  const settleInput = {
    operationId: `settle_${fx.suffix}`,
    accountId: fx.accountId,
    productId: fx.productId,
    workspaceId: fx.workspaceId,
    runId: fx.runId,
    usageReservationId: fx.usageReservationId,
    authorityReservationId: first.authority_reservation_id,
    callerServiceId: fx.callerServiceId,
    customerBillableAmount: "200",
    pricingFingerprint: fx.pricingFingerprint,
    pricingVersion: fx.pricingVersion,
    providerCost: "999999",
    providerUsage: { input_text_tokens: 10 },
  };
  const settled = await settleWalletAuthority(settleInput);
  const settledReplay = await settleWalletAuthority(settleInput);
  assert.equal(settled.status, "settled");
  assert.equal(settledReplay.settled_amount, "200");
  assert.equal(await balance(fx.wallet.id), 800n);
  const reservation = await prisma.messageGoAuthorityReservation.findUniqueOrThrow({
    where: { id: first.authority_reservation_id },
  });
  assert.equal(reservation.settledAmountRial, 200n);
  assert.equal(reservation.remainingHoldRial, 0n);
  const events = await prisma.messageGoReservationEvent.findMany({
    where: { reservationId: reservation.id },
    orderBy: { createdAt: "asc" },
  });
  assert.equal(events.length, 2);
  assert.equal(events[0]?.kind, "reserved");
  assert.equal(events[1]?.kind, "settled");
});

test("insufficient and invalid financial authority fail closed", async () => {
  const fx = await fundedAccount("poor", 10n);
  await assert.rejects(
    () =>
      reserveWalletAuthority({
        operationId: fx.operationId,
        accountId: fx.accountId,
        productId: fx.productId,
        workspaceId: fx.workspaceId,
        runId: fx.runId,
        usageReservationId: fx.usageReservationId,
        callerServiceId: fx.callerServiceId,
        holdAmount: "50",
        pricingFingerprint: fx.pricingFingerprint,
        pricingVersion: fx.pricingVersion,
      }),
    (error: unknown) => isSettlementError(error) && error.code === "insufficient_funds",
  );
  assert.equal(await balance(fx.wallet.id), 10n);
  assert.equal(await ledgerCount(fx.wallet.id), 0);
  await assert.rejects(
    () =>
      reserveWalletAuthority({
        operationId: `${fx.operationId}_float`,
        accountId: fx.accountId,
        productId: fx.productId,
        workspaceId: fx.workspaceId,
        runId: `${fx.runId}_float`,
        usageReservationId: `${fx.usageReservationId}_float`,
        callerServiceId: fx.callerServiceId,
        holdAmount: 10,
        pricingFingerprint: fx.pricingFingerprint,
        pricingVersion: fx.pricingVersion,
      }),
    (error: unknown) => isSettlementError(error) && error.code === "json_number_money",
  );
  await assert.rejects(
    () =>
      reserveWalletAuthority({
        operationId: `${fx.operationId}_unknown`,
        accountId: "missing-account",
        productId: fx.productId,
        workspaceId: fx.workspaceId,
        runId: `${fx.runId}_unknown`,
        usageReservationId: `${fx.usageReservationId}_unknown`,
        callerServiceId: fx.callerServiceId,
        holdAmount: "1",
        pricingFingerprint: fx.pricingFingerprint,
        pricingVersion: fx.pricingVersion,
      }),
    (error: unknown) => isSettlementError(error) && error.code === "not_found",
  );
});

test("unknown reservation, account mismatch and scope mismatch fail closed", async () => {
  const fx = await fundedAccount("scope", 500n);
  const reserved = await reserveWalletAuthority({
    operationId: fx.operationId,
    accountId: fx.accountId,
    productId: fx.productId,
    workspaceId: fx.workspaceId,
    runId: fx.runId,
    usageReservationId: fx.usageReservationId,
    callerServiceId: fx.callerServiceId,
    holdAmount: "40",
    pricingFingerprint: fx.pricingFingerprint,
    pricingVersion: fx.pricingVersion,
  });
  const other = await fundedAccount("other", 500n);
  await assert.rejects(
    () =>
      settleWalletAuthority({
        operationId: `settle_unknown_${fx.suffix}`,
        accountId: fx.accountId,
        productId: fx.productId,
        workspaceId: fx.workspaceId,
        runId: fx.runId,
        usageReservationId: fx.usageReservationId,
        authorityReservationId: "missing-reservation",
        callerServiceId: fx.callerServiceId,
        customerBillableAmount: "40",
        pricingFingerprint: fx.pricingFingerprint,
        pricingVersion: fx.pricingVersion,
      }),
    (error: unknown) => isSettlementError(error) && error.code === "not_found",
  );
  await assert.rejects(
    () =>
      settleWalletAuthority({
        operationId: `settle_acct_${fx.suffix}`,
        accountId: other.accountId,
        productId: fx.productId,
        workspaceId: fx.workspaceId,
        runId: fx.runId,
        usageReservationId: fx.usageReservationId,
        authorityReservationId: reserved.authority_reservation_id,
        callerServiceId: fx.callerServiceId,
        customerBillableAmount: "40",
        pricingFingerprint: fx.pricingFingerprint,
        pricingVersion: fx.pricingVersion,
      }),
    (error: unknown) => isSettlementError(error) && error.code === "scope_mismatch",
  );
  await assert.rejects(
    () =>
      settleWalletAuthority({
        operationId: `settle_ws_${fx.suffix}`,
        accountId: fx.accountId,
        productId: fx.productId,
        workspaceId: "ws_other",
        runId: fx.runId,
        usageReservationId: fx.usageReservationId,
        authorityReservationId: reserved.authority_reservation_id,
        callerServiceId: fx.callerServiceId,
        customerBillableAmount: "40",
        pricingFingerprint: fx.pricingFingerprint,
        pricingVersion: fx.pricingVersion,
      }),
    (error: unknown) => isSettlementError(error) && error.code === "scope_mismatch",
  );
  assert.equal(await balance(fx.wallet.id), 460n);
  assert.equal(await balance(other.wallet.id), 500n);
});

test("released then settle and settled then release conflict without extra money mutation", async () => {
  const fx = await fundedAccount("release", 100n);
  const reserved = await reserveWalletAuthority({
    operationId: fx.operationId,
    accountId: fx.accountId,
    productId: fx.productId,
    workspaceId: fx.workspaceId,
    runId: fx.runId,
    usageReservationId: fx.usageReservationId,
    callerServiceId: fx.callerServiceId,
    holdAmount: "40",
    pricingFingerprint: fx.pricingFingerprint,
    pricingVersion: fx.pricingVersion,
  });
  const released = await releaseWalletAuthority({
    operationId: `rel_${fx.suffix}`,
    accountId: fx.accountId,
    productId: fx.productId,
    workspaceId: fx.workspaceId,
    runId: fx.runId,
    usageReservationId: fx.usageReservationId,
    authorityReservationId: reserved.authority_reservation_id,
    callerServiceId: fx.callerServiceId,
    reason: "provider_work_did_not_start",
  });
  assert.equal(released.status, "released");
  assert.equal(await balance(fx.wallet.id), 100n);
  await releaseWalletAuthority({
    operationId: `rel_${fx.suffix}`,
    accountId: fx.accountId,
    productId: fx.productId,
    workspaceId: fx.workspaceId,
    runId: fx.runId,
    usageReservationId: fx.usageReservationId,
    authorityReservationId: reserved.authority_reservation_id,
    callerServiceId: fx.callerServiceId,
    reason: "provider_work_did_not_start",
  });
  assert.equal(await balance(fx.wallet.id), 100n);
  await assert.rejects(
    () =>
      settleWalletAuthority({
        operationId: `settle_after_rel_${fx.suffix}`,
        accountId: fx.accountId,
        productId: fx.productId,
        workspaceId: fx.workspaceId,
        runId: fx.runId,
        usageReservationId: fx.usageReservationId,
        authorityReservationId: reserved.authority_reservation_id,
        callerServiceId: fx.callerServiceId,
        customerBillableAmount: "40",
        pricingFingerprint: fx.pricingFingerprint,
        pricingVersion: fx.pricingVersion,
      }),
    (error: unknown) => isSettlementError(error) && error.code === "state_conflict",
  );

  const charged = await fundedAccount("charged", 100n);
  const hold = await reserveWalletAuthority({
    operationId: charged.operationId,
    accountId: charged.accountId,
    productId: charged.productId,
    workspaceId: charged.workspaceId,
    runId: charged.runId,
    usageReservationId: charged.usageReservationId,
    callerServiceId: charged.callerServiceId,
    holdAmount: "40",
    pricingFingerprint: charged.pricingFingerprint,
    pricingVersion: charged.pricingVersion,
  });
  await settleWalletAuthority({
    operationId: `settle_${charged.suffix}`,
    accountId: charged.accountId,
    productId: charged.productId,
    workspaceId: charged.workspaceId,
    runId: charged.runId,
    usageReservationId: charged.usageReservationId,
    authorityReservationId: hold.authority_reservation_id,
    callerServiceId: charged.callerServiceId,
    customerBillableAmount: "40",
    pricingFingerprint: charged.pricingFingerprint,
    pricingVersion: charged.pricingVersion,
  });
  const afterSettle = await balance(charged.wallet.id);
  await assert.rejects(
    () =>
      releaseWalletAuthority({
        operationId: `rel_after_settle_${charged.suffix}`,
        accountId: charged.accountId,
        productId: charged.productId,
        workspaceId: charged.workspaceId,
        runId: charged.runId,
        usageReservationId: charged.usageReservationId,
        authorityReservationId: hold.authority_reservation_id,
        callerServiceId: charged.callerServiceId,
        reason: "too_late",
      }),
    (error: unknown) => isSettlementError(error) && error.code === "state_conflict",
  );
  assert.equal(await balance(charged.wallet.id), afterSettle);
});

test("uncertain settle then reconcile records late truth without overwriting history", async () => {
  const fx = await fundedAccount("uncertain", 500n);
  const reserved = await reserveWalletAuthority({
    operationId: fx.operationId,
    accountId: fx.accountId,
    productId: fx.productId,
    workspaceId: fx.workspaceId,
    runId: fx.runId,
    usageReservationId: fx.usageReservationId,
    callerServiceId: fx.callerServiceId,
    holdAmount: "80",
    pricingFingerprint: fx.pricingFingerprint,
    pricingVersion: fx.pricingVersion,
  });
  const uncertain = await settleWalletAuthority({
    operationId: `settle_unc_${fx.suffix}`,
    accountId: fx.accountId,
    productId: fx.productId,
    workspaceId: fx.workspaceId,
    runId: fx.runId,
    usageReservationId: fx.usageReservationId,
    authorityReservationId: reserved.authority_reservation_id,
    callerServiceId: fx.callerServiceId,
    customerBillableAmount: "50",
    pricingFingerprint: fx.pricingFingerprint,
    pricingVersion: fx.pricingVersion,
    outcomeClass: "uncertain",
  });
  assert.equal(uncertain.status, "uncertain");
  assert.equal(await balance(fx.wallet.id), 420n);
  const firstEvents = await prisma.messageGoReservationEvent.count({
    where: { reservationId: reserved.authority_reservation_id },
  });
  const reconcileInput = {
    operationId: `recon_${fx.suffix}`,
    accountId: fx.accountId,
    productId: fx.productId,
    workspaceId: fx.workspaceId,
    runId: fx.runId,
    usageReservationId: fx.usageReservationId,
    authorityReservationId: reserved.authority_reservation_id,
    callerServiceId: fx.callerServiceId,
    customerBillableAmount: "50",
    pricingFingerprint: fx.pricingFingerprint,
    pricingVersion: fx.pricingVersion,
  };
  const reconciled = await reconcileWalletAuthority(reconcileInput);
  const reconciledAgain = await reconcileWalletAuthority(reconcileInput);
  assert.equal(reconciled.status, "reconciled");
  assert.equal(reconciledAgain.settled_amount, "50");
  assert.equal(await balance(fx.wallet.id), 450n);
  await assert.rejects(
    () =>
      reconcileWalletAuthority({
        ...reconcileInput,
        operationId: `recon_conflict_${fx.suffix}`,
        customerBillableAmount: "70",
      }),
    (error: unknown) => isSettlementError(error) && error.code === "state_conflict",
  );
  const events = await prisma.messageGoReservationEvent.findMany({
    where: { reservationId: reserved.authority_reservation_id },
    orderBy: { createdAt: "asc" },
  });
  assert.equal(events[0]?.kind, "reserved");
  assert.equal(events[1]?.kind, "uncertain");
  assert.equal(events[2]?.kind, "reconciled");
  assert.ok(events.length >= firstEvents);
  const row = await prisma.messageGoAuthorityReservation.findUniqueOrThrow({
    where: { id: reserved.authority_reservation_id },
  });
  assert.equal(row.status, MessageGoReservationStatus.RECONCILED);
  assert.equal(row.settledAmountRial, 50n);
});

test("concurrent identical reserve operations mutate the wallet once", async () => {
  const fx = await fundedAccount("race", 1000n);
  const input = {
    operationId: fx.operationId,
    accountId: fx.accountId,
    productId: fx.productId,
    workspaceId: fx.workspaceId,
    runId: fx.runId,
    usageReservationId: fx.usageReservationId,
    callerServiceId: fx.callerServiceId,
    holdAmount: "100",
    pricingFingerprint: fx.pricingFingerprint,
    pricingVersion: fx.pricingVersion,
  };
  const results = await Promise.all(
    Array.from({ length: 8 }, () => reserveWalletAuthority(input)),
  );
  const ids = new Set(results.map((row) => row.authority_reservation_id));
  assert.equal(ids.size, 1);
  assert.equal(await balance(fx.wallet.id), 900n);
  assert.equal(await ledgerCount(fx.wallet.id), 1);
  assert.equal(
    await prisma.messageGoAuthorityReservation.count({
      where: { accountId: fx.accountId },
    }),
    1,
  );
});
