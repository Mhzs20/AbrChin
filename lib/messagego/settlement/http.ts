import { jsonError, jsonOk } from "@/lib/http";
import {
  assertNoJsonNumberMoney,
  isSettlementError,
  SettlementError,
} from "@/lib/messagego/settlement/amount";
import {
  reconcileWalletAuthority,
  releaseWalletAuthority,
  reserveWalletAuthority,
  settleWalletAuthority,
} from "@/lib/messagego/settlement/authority";
import { authenticateSettlementRequest } from "@/lib/messagego/settlement/service-auth";
import type { SettlementOutcomeClass } from "@/lib/messagego/settlement/types";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function outcomeClass(value: unknown): SettlementOutcomeClass | undefined {
  if (value === "uncertain" || value === "known") return value;
  return undefined;
}

export async function handleSettlementHttp(request: Request) {
  if (request.method !== "POST") {
    return jsonError("Method not allowed", 405, { code: "method_not_allowed" });
  }
  try {
    const auth = authenticateSettlementRequest(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new SettlementError("invalid_request", "JSON body is required");
    }
    assertNoJsonNumberMoney(body);
    const payload = asRecord(body);
    const operation = readString(payload.operation).trim().toLowerCase();
    const callerServiceId = readString(payload.caller_service_id).trim() || auth.callerServiceId;
    if (callerServiceId !== auth.callerServiceId) {
      throw new SettlementError(
        "invalid_request",
        "caller_service_id does not match the authenticated service identity",
      );
    }
    const base = {
      operationId: readString(payload.operation_id),
      accountId: readString(payload.account_id),
      productId: readString(payload.product_id),
      workspaceId: readString(payload.workspace_id),
      runId: readString(payload.run_id),
      usageReservationId: readString(payload.usage_reservation_id),
      callerServiceId,
    };
    if (operation === "reserve") {
      const outcome = await reserveWalletAuthority({
        ...base,
        holdAmount: payload.hold_amount,
        pricingFingerprint: readString(payload.pricing_fingerprint),
        pricingVersion: readString(payload.pricing_version),
      });
      assertNoJsonNumberMoney(outcome);
      return jsonOk({ outcome });
    }
    if (operation === "settle") {
      const outcome = await settleWalletAuthority({
        ...base,
        authorityReservationId: readString(payload.authority_reservation_id),
        customerBillableAmount: payload.customer_billable_amount,
        pricingFingerprint: readString(payload.pricing_fingerprint),
        pricingVersion: readString(payload.pricing_version),
        outcomeClass: outcomeClass(payload.outcome_class),
        providerUsage: payload.provider_usage,
        providerCost: payload.provider_cost,
      });
      assertNoJsonNumberMoney(outcome);
      return jsonOk({ outcome });
    }
    if (operation === "release") {
      const outcome = await releaseWalletAuthority({
        ...base,
        authorityReservationId: readString(payload.authority_reservation_id),
        reason: readString(payload.reason),
      });
      assertNoJsonNumberMoney(outcome);
      return jsonOk({ outcome });
    }
    if (operation === "reconcile") {
      const outcome = await reconcileWalletAuthority({
        ...base,
        authorityReservationId: readString(payload.authority_reservation_id),
        customerBillableAmount: payload.customer_billable_amount,
        pricingFingerprint: readString(payload.pricing_fingerprint),
        pricingVersion: readString(payload.pricing_version),
        providerUsage: payload.provider_usage,
        providerCost: payload.provider_cost,
      });
      assertNoJsonNumberMoney(outcome);
      return jsonOk({ outcome });
    }
    throw new SettlementError("invalid_request", "operation must be reserve, settle, release, or reconcile");
  } catch (error) {
    if (isSettlementError(error)) {
      return jsonError(error.message, error.httpStatus, { code: error.code });
    }
    return jsonError("Settlement request failed closed", 500, { code: "internal_error" });
  }
}
