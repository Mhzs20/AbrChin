import type { MessageGoReservationStatus } from "@prisma/client";

export type SettlementOperationKind = "reserve" | "settle" | "release" | "reconcile";

export type SettlementOutcomeClass = "known" | "uncertain";

export type AuthorityOutcomeStatus =
  | "reserved"
  | "settled"
  | "released"
  | "uncertain"
  | "reconciled";

export type AuthorityOutcome = {
  contract_id: "MESSAGEGO-V2-ABRCHIN-SETTLEMENT";
  contract_version: "2.0.0";
  authority_reservation_id: string;
  status: AuthorityOutcomeStatus;
  hold_amount: string;
  remaining_hold_amount: string;
  settled_amount: string;
  account_id: string;
  product_id: string;
  workspace_id: string;
  run_id: string;
  usage_reservation_id: string;
  pricing_fingerprint: string;
  pricing_version: string;
  ledger_entry_ids: string[];
  wallet_authority: "abrchin";
  inference_proxy: false;
};

export type ReserveInput = {
  operationId: string;
  accountId: string;
  productId: string;
  workspaceId: string;
  runId: string;
  usageReservationId: string;
  callerServiceId: string;
  holdAmount: unknown;
  pricingFingerprint: string;
  pricingVersion: string;
};

export type SettleInput = {
  operationId: string;
  accountId: string;
  productId: string;
  workspaceId: string;
  runId: string;
  usageReservationId: string;
  authorityReservationId: string;
  callerServiceId: string;
  customerBillableAmount: unknown;
  pricingFingerprint: string;
  pricingVersion: string;
  outcomeClass?: SettlementOutcomeClass;
  providerUsage?: unknown;
  providerCost?: unknown;
};

export type ReleaseInput = {
  operationId: string;
  accountId: string;
  productId: string;
  workspaceId: string;
  runId: string;
  usageReservationId: string;
  authorityReservationId: string;
  callerServiceId: string;
  reason: string;
};

export type ReconcileInput = {
  operationId: string;
  accountId: string;
  productId: string;
  workspaceId: string;
  runId: string;
  usageReservationId: string;
  authorityReservationId: string;
  callerServiceId: string;
  customerBillableAmount: unknown;
  pricingFingerprint: string;
  pricingVersion: string;
  providerUsage?: unknown;
  providerCost?: unknown;
};

export function reservationStatusToOutcome(
  status: MessageGoReservationStatus,
): AuthorityOutcomeStatus {
  switch (status) {
    case "RESERVED":
      return "reserved";
    case "SETTLED":
      return "settled";
    case "RELEASED":
      return "released";
    case "UNCERTAIN":
      return "uncertain";
    case "RECONCILED":
      return "reconciled";
    default:
      return "reserved";
  }
}
