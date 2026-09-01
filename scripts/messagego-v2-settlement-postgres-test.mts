import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after, before } from "node:test";

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
import {
  customerPriceFingerprint,
  ensureUnitCustomerPrice,
} from "../lib/messagego/settlement/customer-pricing.ts";

if (!process.env.DATABASE_URL || process.env.ABRCHIN_ISOLATED_TEST !== "1") {
  throw new Error("MessageGo settlement tests require isolated PostgreSQL");
}

after(async () => {
  await prisma.$disconnect();
});

before(async () => {
  await ensureUnitCustomerPrice(prisma);
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

function tokenReserve(
  fx: Awaited<ReturnType<typeof fundedAccount>>,
  inputTokens: number,
  outputTokens: number,
  extra: Record<string, unknown> = {},
) {
  return {
    operationId: fx.operationId,
    accountId: fx.accountId,
    productId: fx.productId,
    workspaceId: fx.workspaceId,
    runId: fx.runId,
    usageReservationId: fx.usageReservationId,
    callerServiceId: fx.callerServiceId,
    modelAlias: "messagego.fast",
    estimatedMaxInputTokens: inputTokens,
    requestedMaxOutputTokens: outputTokens,
    providerPricingFingerprint: "cd".repeat(32),
    providerPricingVersion: "provider-price.v1",
    ...extra,
  };
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
  const reserveInput = tokenReserve(fx, 100, 150);
  const first = await reserveWalletAuthority(reserveInput);
  const replay = await reserveWalletAuthority(reserveInput);
  assert.equal(first.authority_reservation_id, replay.authority_reservation_id);
  assert.equal(first.status, "reserved");
  assert.equal(first.hold_amount, "250");
  assert.equal(await balance(fx.wallet.id), 750n);
  assert.equal(await ledgerCount(fx.wallet.id), 1);

  await assert.rejects(
    () => reserveWalletAuthority(tokenReserve(fx, 101, 150)),
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
    providerCost: "999999",
    providerUsage: { input_text_tokens: 80, output_text_tokens: 120 },
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
    () => reserveWalletAuthority(tokenReserve(fx, 25, 25)),
    (error: unknown) => isSettlementError(error) && error.code === "insufficient_funds",
  );
  assert.equal(await balance(fx.wallet.id), 10n);
  assert.equal(await ledgerCount(fx.wallet.id), 0);
  await assert.rejects(
    () =>
      reserveWalletAuthority(
        tokenReserve(fx, 5, 5, {
          operationId: `${fx.operationId}_float`,
          runId: `${fx.runId}_float`,
          usageReservationId: `${fx.usageReservationId}_float`,
          holdAmount: 10,
        }),
      ),
    (error: unknown) => isSettlementError(error) && error.code === "json_number_money",
  );
  await assert.rejects(
    () =>
      reserveWalletAuthority({
        ...tokenReserve(fx, 1, 1),
        operationId: `${fx.operationId}_unknown`,
        accountId: "missing-account",
        runId: `${fx.runId}_unknown`,
        usageReservationId: `${fx.usageReservationId}_unknown`,
      }),
    (error: unknown) => isSettlementError(error) && error.code === "not_found",
  );
});

test("unknown reservation, account mismatch and scope mismatch fail closed", async () => {
  const fx = await fundedAccount("scope", 500n);
  const reserved = await reserveWalletAuthority(tokenReserve(fx, 20, 20));
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
        providerUsage: { input_text_tokens: 20, output_text_tokens: 20 },
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
        providerUsage: { input_text_tokens: 20, output_text_tokens: 20 },
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
        providerUsage: { input_text_tokens: 20, output_text_tokens: 20 },
      }),
    (error: unknown) => isSettlementError(error) && error.code === "scope_mismatch",
  );
  assert.equal(await balance(fx.wallet.id), 460n);
  assert.equal(await balance(other.wallet.id), 500n);
});

test("released then settle and settled then release conflict without extra money mutation", async () => {
  const fx = await fundedAccount("release", 100n);
  const reserved = await reserveWalletAuthority(tokenReserve(fx, 20, 20));
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
        providerUsage: { input_text_tokens: 20, output_text_tokens: 20 },
      }),
    (error: unknown) => isSettlementError(error) && error.code === "state_conflict",
  );

  const charged = await fundedAccount("charged", 100n);
  const hold = await reserveWalletAuthority(tokenReserve(charged, 20, 20));
  await settleWalletAuthority({
    operationId: `settle_${charged.suffix}`,
    accountId: charged.accountId,
    productId: charged.productId,
    workspaceId: charged.workspaceId,
    runId: charged.runId,
    usageReservationId: charged.usageReservationId,
    authorityReservationId: hold.authority_reservation_id,
    callerServiceId: charged.callerServiceId,
    providerUsage: { input_text_tokens: 20, output_text_tokens: 20 },
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
  const reserved = await reserveWalletAuthority(tokenReserve(fx, 40, 40));
  const uncertain = await settleWalletAuthority({
    operationId: `settle_unc_${fx.suffix}`,
    accountId: fx.accountId,
    productId: fx.productId,
    workspaceId: fx.workspaceId,
    runId: fx.runId,
    usageReservationId: fx.usageReservationId,
    authorityReservationId: reserved.authority_reservation_id,
    callerServiceId: fx.callerServiceId,
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
    providerUsage: { input_text_tokens: 20, output_text_tokens: 30 },
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
        providerUsage: { input_text_tokens: 40, output_text_tokens: 30 },
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
  const input = tokenReserve(fx, 50, 50);
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

test("customer billable amount differs by usage and by AbrChin-owned price", async () => {
  await prisma.messageGoCustomerPrice.create({
    data: {
      stableModelAlias: "messagego.cheap",
      revision: 1n,
      pricingVersion: "customer-cheap.v1",
      pricingFingerprint: customerPriceFingerprint({
        stableModelAlias: "messagego.cheap",
        pricingVersion: "customer-cheap.v1",
        inputRialPerMillion: 2_000_000n,
        outputRialPerMillion: 4_000_000n,
      }),
      currency: "IRR",
      inputRialPerMillion: 2_000_000n,
      outputRialPerMillion: 4_000_000n,
      maxInputTokens: 1000n,
      maxOutputTokens: 256n,
      effectiveAt: new Date("2026-09-01T00:00:00.000Z"),
    },
  });
  await prisma.messageGoCustomerPrice.create({
    data: {
      stableModelAlias: "messagego.dear",
      revision: 1n,
      pricingVersion: "customer-dear.v1",
      pricingFingerprint: customerPriceFingerprint({
        stableModelAlias: "messagego.dear",
        pricingVersion: "customer-dear.v1",
        inputRialPerMillion: 5_000_000n,
        outputRialPerMillion: 1_000_000n,
      }),
      currency: "IRR",
      inputRialPerMillion: 5_000_000n,
      outputRialPerMillion: 1_000_000n,
      maxInputTokens: 1000n,
      maxOutputTokens: 256n,
      effectiveAt: new Date("2026-09-01T00:00:00.000Z"),
    },
  });

  const cheap = await fundedAccount("cheap", 10_000n);
  const reservedCheap = await reserveWalletAuthority({
    ...tokenReserve(cheap, 10, 4),
    modelAlias: "messagego.cheap",
  });
  assert.equal(reservedCheap.hold_amount, "36");
  const settledCheap = await settleWalletAuthority({
    operationId: `settle_${cheap.suffix}`,
    accountId: cheap.accountId,
    productId: cheap.productId,
    workspaceId: cheap.workspaceId,
    runId: cheap.runId,
    usageReservationId: cheap.usageReservationId,
    authorityReservationId: reservedCheap.authority_reservation_id,
    callerServiceId: cheap.callerServiceId,
    providerUsage: { input_text_tokens: 10, output_text_tokens: 4 },
  });
  assert.equal(settledCheap.settled_amount, "36");
  assert.equal(await balance(cheap.wallet.id), 9964n);

  const dear = await fundedAccount("dear", 10_000n);
  const reservedDear = await reserveWalletAuthority({
    ...tokenReserve(dear, 10, 4),
    modelAlias: "messagego.dear",
  });
  assert.equal(reservedDear.hold_amount, "54");
  const settledDear = await settleWalletAuthority({
    operationId: `settle_${dear.suffix}`,
    accountId: dear.accountId,
    productId: dear.productId,
    workspaceId: dear.workspaceId,
    runId: dear.runId,
    usageReservationId: dear.usageReservationId,
    authorityReservationId: reservedDear.authority_reservation_id,
    callerServiceId: dear.callerServiceId,
    providerUsage: { input_text_tokens: 10, output_text_tokens: 4 },
  });
  assert.equal(settledDear.settled_amount, "54");
  assert.notEqual(settledCheap.settled_amount, settledDear.settled_amount);

  const heavy = await fundedAccount("heavy", 10_000n);
  const reservedHeavy = await reserveWalletAuthority({
    ...tokenReserve(heavy, 100, 20),
    modelAlias: "messagego.cheap",
  });
  assert.equal(reservedHeavy.hold_amount, "280");
  const settledHeavy = await settleWalletAuthority({
    operationId: `settle_${heavy.suffix}`,
    accountId: heavy.accountId,
    productId: heavy.productId,
    workspaceId: heavy.workspaceId,
    runId: heavy.runId,
    usageReservationId: heavy.usageReservationId,
    authorityReservationId: reservedHeavy.authority_reservation_id,
    callerServiceId: heavy.callerServiceId,
    providerUsage: { input_text_tokens: 100, output_text_tokens: 20 },
  });
  assert.equal(settledHeavy.settled_amount, "280");
  assert.notEqual(settledCheap.settled_amount, settledHeavy.settled_amount);
});
