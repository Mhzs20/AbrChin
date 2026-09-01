import {
  LedgerDirection,
  LedgerStatus,
  LedgerType,
  MessageGoReservationStatus,
  MessageGoSettlementOpKind,
  Prisma,
  UserAccountStatus,
  WalletStatus,
  type MessageGoAuthorityReservation,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  parseOptionalWalletAmount,
  parseWalletAmount,
  rejectUntrustedAmount,
  SETTLEMENT_CONTRACT_ID,
  SETTLEMENT_CONTRACT_VERSION,
  SettlementError,
  walletAmountString,
} from "@/lib/messagego/settlement/amount";
import {
  deriveBillableRial,
  deriveHoldRial,
  latestCustomerPrice,
  parseProviderUsage,
  parseTokenCount,
  type CustomerPriceRecord,
} from "@/lib/messagego/settlement/customer-pricing";
import { settlementFingerprint } from "@/lib/messagego/settlement/fingerprint";
import type {
  AuthorityOutcome,
  ReconcileInput,
  ReleaseInput,
  ReserveInput,
  SettleInput,
} from "@/lib/messagego/settlement/types";
import { reservationStatusToOutcome } from "@/lib/messagego/settlement/types";
import { ensureWalletForUser } from "@/lib/wallet/ensure-wallet";

type Tx = Prisma.TransactionClient;

type RecordedOp = {
  kind: MessageGoSettlementOpKind;
  bodyFingerprint: string;
  reservationId: string | null;
  accountId: string;
  outcomeJson: Prisma.JsonValue;
  errorCode: string | null;
};

function requiredId(value: string | undefined, field: string) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed.length > 200 || /[\r\n\0]/.test(trimmed)) {
    throw new SettlementError("invalid_request", `${field} is required`);
  }
  return trimmed;
}

function requiredText(value: string | undefined, field: string, max = 500) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed.length > max || /[\r\n\0]/.test(trimmed)) {
    throw new SettlementError("invalid_request", `${field} is required`);
  }
  return trimmed;
}

async function lockOperation(tx: Tx, operationId: string) {
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`messagego-settlement:${operationId}`}, 0)
    )::text AS locked
  `;
}

function asOutcome(value: Prisma.JsonValue): AuthorityOutcome {
  return value as unknown as AuthorityOutcome;
}

function outcomeFromReservation(
  reservation: MessageGoAuthorityReservation,
  ledgerEntryIds: string[],
): AuthorityOutcome {
  return {
    contract_id: SETTLEMENT_CONTRACT_ID,
    contract_version: SETTLEMENT_CONTRACT_VERSION,
    authority_reservation_id: reservation.id,
    status: reservationStatusToOutcome(reservation.status),
    hold_amount: walletAmountString(reservation.holdAmountRial),
    remaining_hold_amount: walletAmountString(reservation.remainingHoldRial),
    settled_amount: walletAmountString(reservation.settledAmountRial),
    account_id: reservation.accountId,
    product_id: reservation.productId,
    workspace_id: reservation.workspaceId,
    run_id: reservation.runId,
    usage_reservation_id: reservation.usageReservationId,
    pricing_fingerprint: reservation.pricingFingerprint,
    pricing_version: reservation.pricingVersion,
    ledger_entry_ids: ledgerEntryIds,
    wallet_authority: "abrchin",
    inference_proxy: false,
  };
}

function replay(existing: RecordedOp, kind: MessageGoSettlementOpKind, fingerprint: string) {
  if (existing.kind !== kind || existing.bodyFingerprint !== fingerprint) {
    throw new SettlementError(
      "idempotency_conflict",
      "Same operation_id with a conflicting semantic body",
    );
  }
  if (existing.errorCode) {
    throw new SettlementError(
      existing.errorCode as SettlementError["code"],
      "Idempotent replay of the recorded financial denial",
    );
  }
  return asOutcome(existing.outcomeJson);
}

async function recordOperation(
  tx: Tx,
  input: {
    operationId: string;
    kind: MessageGoSettlementOpKind;
    fingerprint: string;
    reservationId: string | null;
    accountId: string;
    outcome: AuthorityOutcome | Record<string, unknown>;
    errorCode?: string;
  },
) {
  await tx.messageGoSettlementOperation.create({
    data: {
      operationId: input.operationId,
      kind: input.kind,
      bodyFingerprint: input.fingerprint,
      reservationId: input.reservationId,
      accountId: input.accountId,
      outcomeJson: input.outcome as Prisma.InputJsonValue,
      errorCode: input.errorCode ?? null,
    },
  });
}

async function recordEvent(
  tx: Tx,
  reservationId: string,
  kind: string,
  operationId: string,
  payload: Record<string, unknown>,
) {
  await tx.messageGoReservationEvent.create({
    data: {
      reservationId,
      kind,
      operationId,
      payloadJson: payload as Prisma.InputJsonValue,
    },
  });
}

function assertScope(
  reservation: MessageGoAuthorityReservation,
  scope: {
    accountId: string;
    productId: string;
    workspaceId: string;
    runId: string;
    usageReservationId: string;
    authorityReservationId: string;
  },
) {
  if (reservation.id !== scope.authorityReservationId) {
    throw new SettlementError("not_found", "Unknown authority reservation");
  }
  if (
    reservation.accountId !== scope.accountId ||
    reservation.productId !== scope.productId ||
    reservation.workspaceId !== scope.workspaceId ||
    reservation.runId !== scope.runId ||
    reservation.usageReservationId !== scope.usageReservationId
  ) {
    throw new SettlementError("scope_mismatch", "Account or scope does not match the reservation");
  }
}

async function debitHold(
  tx: Tx,
  input: {
    walletId: string;
    amountRial: bigint;
    type: LedgerType;
    idempotencyKey: string;
    referenceId: string;
    description: string;
    metadata?: Prisma.InputJsonValue;
  },
) {
  if (input.amountRial === 0n) return null;
  const updated = await tx.wallet.updateMany({
    where: {
      id: input.walletId,
      availableBalance: { gte: input.amountRial },
      status: WalletStatus.ACTIVE,
    },
    data: { availableBalance: { decrement: input.amountRial } },
  });
  if (updated.count !== 1) {
    throw new SettlementError("insufficient_funds", "موجودی کافی نیست.");
  }
  const fresh = await tx.wallet.findUniqueOrThrow({ where: { id: input.walletId } });
  return tx.walletLedgerEntry.create({
    data: {
      walletId: input.walletId,
      direction: LedgerDirection.DEBIT,
      type: input.type,
      amount: input.amountRial,
      status: LedgerStatus.COMPLETED,
      referenceType: "messagego_reservation",
      referenceId: input.referenceId,
      idempotencyKey: input.idempotencyKey,
      balanceAfter: fresh.availableBalance,
      description: input.description,
      metadata: input.metadata,
    },
  });
}

async function creditRelease(
  tx: Tx,
  input: {
    walletId: string;
    amountRial: bigint;
    idempotencyKey: string;
    referenceId: string;
    description: string;
    metadata?: Prisma.InputJsonValue;
  },
) {
  if (input.amountRial === 0n) return null;
  const updated = await tx.wallet.update({
    where: { id: input.walletId },
    data: { availableBalance: { increment: input.amountRial } },
  });
  return tx.walletLedgerEntry.create({
    data: {
      walletId: input.walletId,
      direction: LedgerDirection.CREDIT,
      type: LedgerType.MESSAGEGO_HOLD_RELEASE,
      amount: input.amountRial,
      status: LedgerStatus.COMPLETED,
      referenceType: "messagego_reservation",
      referenceId: input.referenceId,
      idempotencyKey: input.idempotencyKey,
      balanceAfter: updated.availableBalance,
      description: input.description,
      metadata: input.metadata,
    },
  });
}

async function applyBillable(
  tx: Tx,
  reservation: MessageGoAuthorityReservation,
  billable: bigint,
  operationId: string,
) {
  const ledgerIds: string[] = [];
  let remaining = reservation.remainingHoldRial;
  if (billable > remaining) {
    const extra = billable - remaining;
    const extraEntry = await debitHold(tx, {
      walletId: reservation.walletId,
      amountRial: extra,
      type: LedgerType.MESSAGEGO_SETTLEMENT,
      idempotencyKey: `messagego:settle:${operationId}:debit`,
      referenceId: reservation.id,
      description: "تسویه مصرف هوش مصنوعی",
      metadata: {
        kind: "messagego_settlement_extra",
        operation_id: operationId,
        provider_usage_ignored_for_wallet: false,
        provider_cost_ignored_for_wallet: true,
      },
    });
    if (extraEntry) ledgerIds.push(extraEntry.id);
    remaining = 0n;
  } else {
    const leftover = remaining - billable;
    const releaseEntry = await creditRelease(tx, {
      walletId: reservation.walletId,
      amountRial: leftover,
      idempotencyKey: `messagego:settle:${operationId}:release`,
      referenceId: reservation.id,
      description: "آزادسازی مانده رزرو هوش مصنوعی",
      metadata: {
        kind: "messagego_hold_release",
        operation_id: operationId,
      },
    });
    if (releaseEntry) ledgerIds.push(releaseEntry.id);
    remaining = 0n;
  }
  const updated = await tx.messageGoAuthorityReservation.update({
    where: { id: reservation.id },
    data: {
      remainingHoldRial: remaining,
      settledAmountRial: reservation.settledAmountRial + billable,
      status: MessageGoReservationStatus.SETTLED,
    },
  });
  return { reservation: updated, ledgerIds };
}

function technicalQuantities(input: { providerUsage?: unknown; providerCost?: unknown }) {
  return {
    provider_usage: input.providerUsage ?? null,
    provider_cost:
      typeof input.providerCost === "string" ? input.providerCost : null,
    wallet_derived_from_provider_usage: true,
    provider_cost_ignored_for_wallet: true,
  };
}

function reservationPriceSnapshot(
  reservation: MessageGoAuthorityReservation,
): Pick<CustomerPriceRecord, "inputRialPerMillion" | "outputRialPerMillion"> & {
  maxInput: bigint;
  maxOutput: bigint;
} {
  if (
    reservation.estimatedMaxInputTokens == null ||
    reservation.requestedMaxOutputTokens == null ||
    reservation.customerInputRialPerMillion == null ||
    reservation.customerOutputRialPerMillion == null
  ) {
    throw new SettlementError("unknown_pricing", "reservation is missing the customer price snapshot");
  }
  return {
    inputRialPerMillion: reservation.customerInputRialPerMillion,
    outputRialPerMillion: reservation.customerOutputRialPerMillion,
    maxInput: reservation.estimatedMaxInputTokens,
    maxOutput: reservation.requestedMaxOutputTokens,
  };
}

function assertStoredCustomerPricing(
  reservation: MessageGoAuthorityReservation,
  fingerprint?: string,
  version?: string,
) {
  const suppliedFingerprint = fingerprint?.trim() ?? "";
  const suppliedVersion = version?.trim() ?? "";
  if (suppliedFingerprint && suppliedFingerprint !== reservation.pricingFingerprint) {
    throw new SettlementError("stale_pricing", "customer pricing fingerprint is stale");
  }
  if (suppliedVersion && suppliedVersion !== reservation.pricingVersion) {
    throw new SettlementError("stale_pricing", "customer pricing version is stale");
  }
}

export async function reserveWalletAuthority(input: ReserveInput): Promise<AuthorityOutcome> {
  const operationId = requiredId(input.operationId, "operation_id");
  const accountId = requiredId(input.accountId, "account_id");
  const productId = requiredId(input.productId, "product_id");
  const workspaceId = requiredId(input.workspaceId, "workspace_id");
  const runId = requiredId(input.runId, "run_id");
  const usageReservationId = requiredId(input.usageReservationId, "usage_reservation_id");
  const callerServiceId = requiredId(input.callerServiceId, "caller_service_id");
  const modelAlias = requiredText(input.modelAlias, "model_alias", 64);
  const estimatedMaxInputTokens = parseTokenCount(
    input.estimatedMaxInputTokens,
    "estimated_max_input_tokens",
  );
  const requestedMaxOutputTokens = parseTokenCount(
    input.requestedMaxOutputTokens,
    "requested_max_output_tokens",
  );
  const providerPricingFingerprint = requiredText(
    input.providerPricingFingerprint,
    "provider_pricing_fingerprint",
    128,
  );
  const providerPricingVersion = requiredText(
    input.providerPricingVersion,
    "provider_pricing_version",
    128,
  );
  const suppliedHold = parseOptionalWalletAmount(input.holdAmount, "hold_amount");
  if (input.providerCostCeiling !== undefined && input.providerCostCeiling !== null && input.providerCostCeiling !== "") {
    parseWalletAmount(input.providerCostCeiling, "provider_cost_ceiling");
  }
  const fingerprint = settlementFingerprint({
    account_id: accountId,
    product_id: productId,
    workspace_id: workspaceId,
    run_id: runId,
    usage_reservation_id: usageReservationId,
    caller_service_id: callerServiceId,
    model_alias: modelAlias,
    estimated_max_input_tokens: estimatedMaxInputTokens.toString(10),
    requested_max_output_tokens: requestedMaxOutputTokens.toString(10),
    provider_pricing_fingerprint: providerPricingFingerprint,
    provider_pricing_version: providerPricingVersion,
  });

  const committed = await prisma.$transaction(async (tx) => {
    await lockOperation(tx, operationId);
    const existing = await tx.messageGoSettlementOperation.findUnique({
      where: { operationId },
    });
    if (existing) {
      return {
        kind: "replay" as const,
        outcome: replay(existing, MessageGoSettlementOpKind.RESERVE, fingerprint),
      };
    }

    const user = await tx.user.findUnique({ where: { id: accountId } });
    if (!user) {
      throw new SettlementError("not_found", "Unknown account");
    }
    if (user.accountStatus !== UserAccountStatus.ACTIVE) {
      await recordOperation(tx, {
        operationId,
        kind: MessageGoSettlementOpKind.RESERVE,
        fingerprint,
        reservationId: null,
        accountId,
        outcome: { error: "account_inactive" },
        errorCode: "account_inactive",
      });
      return {
        kind: "error" as const,
        code: "account_inactive" as const,
        message: "Account is not financially active",
      };
    }

    const duplicateUsage = await tx.messageGoAuthorityReservation.findUnique({
      where: { usageReservationId },
    });
    if (duplicateUsage) {
      await recordOperation(tx, {
        operationId,
        kind: MessageGoSettlementOpKind.RESERVE,
        fingerprint,
        reservationId: duplicateUsage.id,
        accountId,
        outcome: { error: "idempotency_conflict" },
        errorCode: "idempotency_conflict",
      });
      return {
        kind: "error" as const,
        code: "idempotency_conflict" as const,
        message: "usage_reservation_id is already bound to an authority reservation",
      };
    }

    const wallet = await ensureWalletForUser(accountId, tx);
    await tx.$queryRaw`SELECT id FROM "Wallet" WHERE id = ${wallet.id} FOR UPDATE`;
    const lockedWallet = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    if (lockedWallet.status !== WalletStatus.ACTIVE) {
      await recordOperation(tx, {
        operationId,
        kind: MessageGoSettlementOpKind.RESERVE,
        fingerprint,
        reservationId: null,
        accountId,
        outcome: { error: "wallet_frozen" },
        errorCode: "wallet_frozen",
      });
      return {
        kind: "error" as const,
        code: "wallet_frozen" as const,
        message: "Wallet is not active",
      };
    }

    const price = await latestCustomerPrice(tx, modelAlias);
    const suppliedFingerprint = input.pricingFingerprint?.trim() ?? "";
    const suppliedVersion = input.pricingVersion?.trim() ?? "";
    if (suppliedFingerprint && suppliedFingerprint !== price.pricingFingerprint) {
      throw new SettlementError("stale_pricing", "customer pricing fingerprint is stale");
    }
    if (suppliedVersion && suppliedVersion !== price.pricingVersion) {
      throw new SettlementError("stale_pricing", "customer pricing version is stale");
    }
    const holdAmount = deriveHoldRial(price, estimatedMaxInputTokens, requestedMaxOutputTokens);
    rejectUntrustedAmount(suppliedHold, holdAmount, "hold_amount");

    if (lockedWallet.availableBalance < holdAmount) {
      await recordOperation(tx, {
        operationId,
        kind: MessageGoSettlementOpKind.RESERVE,
        fingerprint,
        reservationId: null,
        accountId,
        outcome: { error: "insufficient_funds" },
        errorCode: "insufficient_funds",
      });
      return {
        kind: "error" as const,
        code: "insufficient_funds" as const,
        message: "موجودی کافی نیست.",
      };
    }

    const reservation = await tx.messageGoAuthorityReservation.create({
      data: {
        accountId,
        walletId: wallet.id,
        productId,
        workspaceId,
        runId,
        usageReservationId,
        callerServiceId,
        holdAmountRial: holdAmount,
        remainingHoldRial: holdAmount,
        settledAmountRial: 0n,
        status: MessageGoReservationStatus.RESERVED,
        pricingFingerprint: price.pricingFingerprint,
        pricingVersion: price.pricingVersion,
        modelAlias,
        estimatedMaxInputTokens,
        requestedMaxOutputTokens,
        customerInputRialPerMillion: price.inputRialPerMillion,
        customerOutputRialPerMillion: price.outputRialPerMillion,
        providerPricingFingerprint,
        providerPricingVersion,
        reserveOperationId: operationId,
      },
    });

    const holdEntry = await debitHold(tx, {
      walletId: wallet.id,
      amountRial: holdAmount,
      type: LedgerType.MESSAGEGO_RESERVE_HOLD,
      idempotencyKey: `messagego:reserve:${operationId}`,
      referenceId: reservation.id,
      description: "رزرو اعتبار هوش مصنوعی",
      metadata: {
        kind: "messagego_reserve_hold",
        operation_id: operationId,
        product_id: productId,
        workspace_id: workspaceId,
        run_id: runId,
        usage_reservation_id: usageReservationId,
      },
    });
    const outcome = outcomeFromReservation(
      reservation,
      holdEntry ? [holdEntry.id] : [],
    );
    await recordEvent(tx, reservation.id, "reserved", operationId, {
      ...outcome,
    });
    await recordOperation(tx, {
      operationId,
      kind: MessageGoSettlementOpKind.RESERVE,
      fingerprint,
      reservationId: reservation.id,
      accountId,
      outcome,
    });
    return { kind: "ok" as const, outcome };
  });

  if (committed.kind === "replay" || committed.kind === "ok") return committed.outcome;
  throw new SettlementError(committed.code, committed.message);
}

async function loadReservationForMutation(
  tx: Tx,
  authorityReservationId: string,
) {
  await tx.$queryRaw`
    SELECT id FROM "MessageGoAuthorityReservation" WHERE id = ${authorityReservationId} FOR UPDATE
  `;
  const reservation = await tx.messageGoAuthorityReservation.findUnique({
    where: { id: authorityReservationId },
  });
  if (!reservation) {
    throw new SettlementError("not_found", "Unknown authority reservation");
  }
  return reservation;
}

export async function settleWalletAuthority(input: SettleInput): Promise<AuthorityOutcome> {
  const operationId = requiredId(input.operationId, "operation_id");
  const accountId = requiredId(input.accountId, "account_id");
  const productId = requiredId(input.productId, "product_id");
  const workspaceId = requiredId(input.workspaceId, "workspace_id");
  const runId = requiredId(input.runId, "run_id");
  const usageReservationId = requiredId(input.usageReservationId, "usage_reservation_id");
  const authorityReservationId = requiredId(
    input.authorityReservationId,
    "authority_reservation_id",
  );
  const callerServiceId = requiredId(input.callerServiceId, "caller_service_id");
  const outcomeClass = input.outcomeClass === "uncertain" ? "uncertain" : "known";
  const suppliedBillable = parseOptionalWalletAmount(
    input.customerBillableAmount,
    "customer_billable_amount",
  );
  const usage =
    outcomeClass === "uncertain" ? null : parseProviderUsage(input.providerUsage);
  const fingerprint = settlementFingerprint({
    account_id: accountId,
    product_id: productId,
    workspace_id: workspaceId,
    run_id: runId,
    usage_reservation_id: usageReservationId,
    authority_reservation_id: authorityReservationId,
    caller_service_id: callerServiceId,
    outcome_class: outcomeClass,
    input_text_tokens: usage ? usage.inputTextTokens.toString(10) : "",
    output_text_tokens: usage ? usage.outputTextTokens.toString(10) : "",
  });

  const committed = await prisma.$transaction(async (tx) => {
    await lockOperation(tx, operationId);
    const existing = await tx.messageGoSettlementOperation.findUnique({
      where: { operationId },
    });
    if (existing) {
      return {
        kind: "replay" as const,
        outcome: replay(existing, MessageGoSettlementOpKind.SETTLE, fingerprint),
      };
    }

    let reservation: MessageGoAuthorityReservation;
    try {
      reservation = await loadReservationForMutation(tx, authorityReservationId);
      assertScope(reservation, {
        accountId,
        productId,
        workspaceId,
        runId,
        usageReservationId,
        authorityReservationId,
      });
    } catch (error) {
      if (error instanceof SettlementError && (error.code === "not_found" || error.code === "scope_mismatch")) {
        await recordOperation(tx, {
          operationId,
          kind: MessageGoSettlementOpKind.SETTLE,
          fingerprint,
          reservationId: error.code === "not_found" ? null : authorityReservationId,
          accountId,
          outcome: { error: error.code },
          errorCode: error.code,
        });
        return { kind: "error" as const, code: error.code, message: error.message };
      }
      throw error;
    }

    assertStoredCustomerPricing(reservation, input.pricingFingerprint, input.pricingVersion);

    if (reservation.status === MessageGoReservationStatus.RELEASED) {
      await recordOperation(tx, {
        operationId,
        kind: MessageGoSettlementOpKind.SETTLE,
        fingerprint,
        reservationId: reservation.id,
        accountId,
        outcome: { error: "state_conflict" },
        errorCode: "state_conflict",
      });
      return {
        kind: "error" as const,
        code: "state_conflict" as const,
        message: "Reservation was released and cannot be settled",
      };
    }

    if (outcomeClass === "uncertain") {
      if (
        reservation.status === MessageGoReservationStatus.SETTLED ||
        reservation.status === MessageGoReservationStatus.RECONCILED
      ) {
        await recordOperation(tx, {
          operationId,
          kind: MessageGoSettlementOpKind.SETTLE,
          fingerprint,
          reservationId: reservation.id,
          accountId,
          outcome: { error: "state_conflict" },
          errorCode: "state_conflict",
        });
        return {
          kind: "error" as const,
          code: "state_conflict" as const,
          message: "Reservation is already settled with a different amount",
        };
      }
      const updated = await tx.messageGoAuthorityReservation.update({
        where: { id: reservation.id },
        data: { status: MessageGoReservationStatus.UNCERTAIN },
      });
      const outcome = outcomeFromReservation(updated, []);
      await recordEvent(tx, updated.id, "uncertain", operationId, {
        ...outcome,
        ...technicalQuantities(input),
      });
      await recordOperation(tx, {
        operationId,
        kind: MessageGoSettlementOpKind.SETTLE,
        fingerprint,
        reservationId: updated.id,
        accountId,
        outcome,
      });
      return { kind: "ok" as const, outcome };
    }

    const snapshot = reservationPriceSnapshot(reservation);
    const billable = deriveBillableRial(
      snapshot,
      usage as NonNullable<typeof usage>,
      snapshot.maxInput,
      snapshot.maxOutput,
    );
    rejectUntrustedAmount(suppliedBillable, billable, "customer_billable_amount");

    if (
      reservation.status === MessageGoReservationStatus.SETTLED ||
      reservation.status === MessageGoReservationStatus.RECONCILED
    ) {
      if (reservation.settledAmountRial !== billable) {
        await recordOperation(tx, {
          operationId,
          kind: MessageGoSettlementOpKind.SETTLE,
          fingerprint,
          reservationId: reservation.id,
          accountId,
          outcome: { error: "state_conflict" },
          errorCode: "state_conflict",
        });
        return {
          kind: "error" as const,
          code: "state_conflict" as const,
          message: "Reservation is already settled with a different amount",
        };
      }
      const outcome = outcomeFromReservation(reservation, []);
      await recordOperation(tx, {
        operationId,
        kind: MessageGoSettlementOpKind.SETTLE,
        fingerprint,
        reservationId: reservation.id,
        accountId,
        outcome,
      });
      return { kind: "ok" as const, outcome };
    }

    try {
      const applied = await applyBillable(tx, reservation, billable, operationId);
      const outcome = outcomeFromReservation(applied.reservation, applied.ledgerIds);
      await recordEvent(tx, applied.reservation.id, "settled", operationId, {
        ...outcome,
        ...technicalQuantities(input),
      });
      await recordOperation(tx, {
        operationId,
        kind: MessageGoSettlementOpKind.SETTLE,
        fingerprint,
        reservationId: applied.reservation.id,
        accountId,
        outcome,
      });
      return { kind: "ok" as const, outcome };
    } catch (error) {
      if (error instanceof SettlementError && error.code === "insufficient_funds") {
        await recordOperation(tx, {
          operationId,
          kind: MessageGoSettlementOpKind.SETTLE,
          fingerprint,
          reservationId: reservation.id,
          accountId,
          outcome: { error: "insufficient_funds" },
          errorCode: "insufficient_funds",
        });
        return {
          kind: "error" as const,
          code: "insufficient_funds" as const,
          message: error.message,
        };
      }
      throw error;
    }
  });

  if (committed.kind === "replay" || committed.kind === "ok") return committed.outcome;
  throw new SettlementError(committed.code, committed.message);
}

export async function releaseWalletAuthority(input: ReleaseInput): Promise<AuthorityOutcome> {
  const operationId = requiredId(input.operationId, "operation_id");
  const accountId = requiredId(input.accountId, "account_id");
  const productId = requiredId(input.productId, "product_id");
  const workspaceId = requiredId(input.workspaceId, "workspace_id");
  const runId = requiredId(input.runId, "run_id");
  const usageReservationId = requiredId(input.usageReservationId, "usage_reservation_id");
  const authorityReservationId = requiredId(
    input.authorityReservationId,
    "authority_reservation_id",
  );
  const callerServiceId = requiredId(input.callerServiceId, "caller_service_id");
  const reason = requiredText(input.reason, "reason");
  const fingerprint = settlementFingerprint({
    account_id: accountId,
    product_id: productId,
    workspace_id: workspaceId,
    run_id: runId,
    usage_reservation_id: usageReservationId,
    authority_reservation_id: authorityReservationId,
    caller_service_id: callerServiceId,
    reason,
  });

  const committed = await prisma.$transaction(async (tx) => {
    await lockOperation(tx, operationId);
    const existing = await tx.messageGoSettlementOperation.findUnique({
      where: { operationId },
    });
    if (existing) {
      return {
        kind: "replay" as const,
        outcome: replay(existing, MessageGoSettlementOpKind.RELEASE, fingerprint),
      };
    }

    let reservation: MessageGoAuthorityReservation;
    try {
      reservation = await loadReservationForMutation(tx, authorityReservationId);
      assertScope(reservation, {
        accountId,
        productId,
        workspaceId,
        runId,
        usageReservationId,
        authorityReservationId,
      });
    } catch (error) {
      if (error instanceof SettlementError && (error.code === "not_found" || error.code === "scope_mismatch")) {
        await recordOperation(tx, {
          operationId,
          kind: MessageGoSettlementOpKind.RELEASE,
          fingerprint,
          reservationId: error.code === "not_found" ? null : authorityReservationId,
          accountId,
          outcome: { error: error.code },
          errorCode: error.code,
        });
        return { kind: "error" as const, code: error.code, message: error.message };
      }
      throw error;
    }

    if (
      reservation.status === MessageGoReservationStatus.SETTLED ||
      reservation.status === MessageGoReservationStatus.RECONCILED ||
      reservation.status === MessageGoReservationStatus.UNCERTAIN
    ) {
      await recordOperation(tx, {
        operationId,
        kind: MessageGoSettlementOpKind.RELEASE,
        fingerprint,
        reservationId: reservation.id,
        accountId,
        outcome: { error: "state_conflict" },
        errorCode: "state_conflict",
      });
      return {
        kind: "error" as const,
        code: "state_conflict" as const,
        message: "Reservation is not eligible for release",
      };
    }

    if (reservation.status === MessageGoReservationStatus.RELEASED) {
      const outcome = outcomeFromReservation(reservation, []);
      await recordOperation(tx, {
        operationId,
        kind: MessageGoSettlementOpKind.RELEASE,
        fingerprint,
        reservationId: reservation.id,
        accountId,
        outcome,
      });
      return { kind: "ok" as const, outcome };
    }

    const releaseEntry = await creditRelease(tx, {
      walletId: reservation.walletId,
      amountRial: reservation.remainingHoldRial,
      idempotencyKey: `messagego:release:${operationId}`,
      referenceId: reservation.id,
      description: "آزادسازی رزرو هوش مصنوعی",
      metadata: { kind: "messagego_release", operation_id: operationId, reason },
    });
    const updated = await tx.messageGoAuthorityReservation.update({
      where: { id: reservation.id },
      data: {
        remainingHoldRial: 0n,
        status: MessageGoReservationStatus.RELEASED,
      },
    });
    const outcome = outcomeFromReservation(
      updated,
      releaseEntry ? [releaseEntry.id] : [],
    );
    await recordEvent(tx, updated.id, "released", operationId, { ...outcome, reason });
    await recordOperation(tx, {
      operationId,
      kind: MessageGoSettlementOpKind.RELEASE,
      fingerprint,
      reservationId: updated.id,
      accountId,
      outcome,
    });
    return { kind: "ok" as const, outcome };
  });

  if (committed.kind === "replay" || committed.kind === "ok") return committed.outcome;
  throw new SettlementError(committed.code, committed.message);
}

export async function reconcileWalletAuthority(
  input: ReconcileInput,
): Promise<AuthorityOutcome> {
  const operationId = requiredId(input.operationId, "operation_id");
  const accountId = requiredId(input.accountId, "account_id");
  const productId = requiredId(input.productId, "product_id");
  const workspaceId = requiredId(input.workspaceId, "workspace_id");
  const runId = requiredId(input.runId, "run_id");
  const usageReservationId = requiredId(input.usageReservationId, "usage_reservation_id");
  const authorityReservationId = requiredId(
    input.authorityReservationId,
    "authority_reservation_id",
  );
  const callerServiceId = requiredId(input.callerServiceId, "caller_service_id");
  const suppliedBillable = parseOptionalWalletAmount(
    input.customerBillableAmount,
    "customer_billable_amount",
  );
  const usage = parseProviderUsage(input.providerUsage);
  const fingerprint = settlementFingerprint({
    account_id: accountId,
    product_id: productId,
    workspace_id: workspaceId,
    run_id: runId,
    usage_reservation_id: usageReservationId,
    authority_reservation_id: authorityReservationId,
    caller_service_id: callerServiceId,
    input_text_tokens: usage.inputTextTokens.toString(10),
    output_text_tokens: usage.outputTextTokens.toString(10),
  });

  const committed = await prisma.$transaction(async (tx) => {
    await lockOperation(tx, operationId);
    const existing = await tx.messageGoSettlementOperation.findUnique({
      where: { operationId },
    });
    if (existing) {
      return {
        kind: "replay" as const,
        outcome: replay(existing, MessageGoSettlementOpKind.RECONCILE, fingerprint),
      };
    }

    let reservation: MessageGoAuthorityReservation;
    try {
      reservation = await loadReservationForMutation(tx, authorityReservationId);
      assertScope(reservation, {
        accountId,
        productId,
        workspaceId,
        runId,
        usageReservationId,
        authorityReservationId,
      });
    } catch (error) {
      if (error instanceof SettlementError && (error.code === "not_found" || error.code === "scope_mismatch")) {
        await recordOperation(tx, {
          operationId,
          kind: MessageGoSettlementOpKind.RECONCILE,
          fingerprint,
          reservationId: error.code === "not_found" ? null : authorityReservationId,
          accountId,
          outcome: { error: error.code },
          errorCode: error.code,
        });
        return { kind: "error" as const, code: error.code, message: error.message };
      }
      throw error;
    }

    assertStoredCustomerPricing(reservation, input.pricingFingerprint, input.pricingVersion);

    if (reservation.status === MessageGoReservationStatus.RELEASED) {
      await recordOperation(tx, {
        operationId,
        kind: MessageGoSettlementOpKind.RECONCILE,
        fingerprint,
        reservationId: reservation.id,
        accountId,
        outcome: { error: "state_conflict" },
        errorCode: "state_conflict",
      });
      return {
        kind: "error" as const,
        code: "state_conflict" as const,
        message: "Released reservation cannot be reconciled into a charge",
      };
    }

    const snapshot = reservationPriceSnapshot(reservation);
    const billable = deriveBillableRial(snapshot, usage, snapshot.maxInput, snapshot.maxOutput);
    rejectUntrustedAmount(suppliedBillable, billable, "customer_billable_amount");

    if (
      reservation.status === MessageGoReservationStatus.SETTLED ||
      reservation.status === MessageGoReservationStatus.RECONCILED
    ) {
      if (reservation.settledAmountRial !== billable) {
        await recordOperation(tx, {
          operationId,
          kind: MessageGoSettlementOpKind.RECONCILE,
          fingerprint,
          reservationId: reservation.id,
          accountId,
          outcome: { error: "state_conflict" },
          errorCode: "state_conflict",
        });
        return {
          kind: "error" as const,
          code: "state_conflict" as const,
          message: "Historical settlement cannot be overwritten",
        };
      }
      const outcome = outcomeFromReservation(reservation, []);
      await recordOperation(tx, {
        operationId,
        kind: MessageGoSettlementOpKind.RECONCILE,
        fingerprint,
        reservationId: reservation.id,
        accountId,
        outcome,
      });
      return { kind: "ok" as const, outcome };
    }

    try {
      const applied = await applyBillable(tx, reservation, billable, operationId);
      const reconciled = await tx.messageGoAuthorityReservation.update({
        where: { id: applied.reservation.id },
        data: { status: MessageGoReservationStatus.RECONCILED },
      });
      const outcome = outcomeFromReservation(reconciled, applied.ledgerIds);
      await recordEvent(tx, reconciled.id, "reconciled", operationId, {
        ...outcome,
        ...technicalQuantities(input),
        previous_status: reservation.status,
      });
      await recordOperation(tx, {
        operationId,
        kind: MessageGoSettlementOpKind.RECONCILE,
        fingerprint,
        reservationId: reconciled.id,
        accountId,
        outcome,
      });
      return { kind: "ok" as const, outcome };
    } catch (error) {
      if (error instanceof SettlementError && error.code === "insufficient_funds") {
        await recordOperation(tx, {
          operationId,
          kind: MessageGoSettlementOpKind.RECONCILE,
          fingerprint,
          reservationId: reservation.id,
          accountId,
          outcome: { error: "insufficient_funds" },
          errorCode: "insufficient_funds",
        });
        return {
          kind: "error" as const,
          code: "insufficient_funds" as const,
          message: error.message,
        };
      }
      throw error;
    }
  });

  if (committed.kind === "replay" || committed.kind === "ok") return committed.outcome;
  throw new SettlementError(committed.code, committed.message);
}
