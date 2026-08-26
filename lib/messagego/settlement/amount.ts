export const SETTLEMENT_CONTRACT_ID = "MESSAGEGO-V2-ABRCHIN-SETTLEMENT";
export const SETTLEMENT_CONTRACT_VERSION = "2.0.0";
export const SETTLEMENT_CURRENCY = "IRR";
export const SETTLEMENT_UNIT = "rial";

export const WALLET_AMOUNT_PATTERN = /^(0|[1-9][0-9]*)$/;

export class SettlementError extends Error {
  readonly code: SettlementErrorCode;
  readonly httpStatus: number;

  constructor(code: SettlementErrorCode, message: string, httpStatus = statusFor(code)) {
    super(message);
    this.name = "SettlementError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export type SettlementErrorCode =
  | "invalid_request"
  | "invalid_amount"
  | "json_number_money"
  | "idempotency_conflict"
  | "not_found"
  | "insufficient_funds"
  | "wallet_frozen"
  | "account_inactive"
  | "scope_mismatch"
  | "state_conflict"
  | "production_denied"
  | "browser_forbidden"
  | "unauthenticated"
  | "settlement_runtime_unavailable";

function statusFor(code: SettlementErrorCode): number {
  switch (code) {
    case "unauthenticated":
      return 401;
    case "production_denied":
    case "browser_forbidden":
    case "settlement_runtime_unavailable":
      return 403;
    case "not_found":
      return 404;
    case "idempotency_conflict":
    case "state_conflict":
    case "scope_mismatch":
    case "insufficient_funds":
    case "wallet_frozen":
    case "account_inactive":
      return 409;
    case "json_number_money":
    case "invalid_amount":
    case "invalid_request":
      return 422;
    default:
      return 400;
  }
}

export function isSettlementError(error: unknown): error is SettlementError {
  return error instanceof SettlementError;
}

export function parseWalletAmount(value: unknown, field = "amount"): bigint {
  if (typeof value === "number") {
    throw new SettlementError(
      "json_number_money",
      `${field} must be an integer IRR rial JSON string, not a JSON number`,
    );
  }
  if (typeof value !== "string") {
    throw new SettlementError("invalid_amount", `${field} must be an integer IRR rial string`);
  }
  const trimmed = value.trim();
  if (!WALLET_AMOUNT_PATTERN.test(trimmed)) {
    throw new SettlementError("invalid_amount", `${field} is not a lossless integer rial amount`);
  }
  return BigInt(trimmed);
}

export function walletAmountString(value: bigint): string {
  if (value < 0n) {
    throw new SettlementError("invalid_amount", "wallet amounts must not be negative");
  }
  return value.toString(10);
}

export function assertNoJsonNumberMoney(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoJsonNumberMoney(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (
        /amount|rial|hold|billable|balance|cost|price/i.test(key) &&
        typeof nested === "number"
      ) {
        throw new SettlementError(
          "json_number_money",
          `JSON number money is forbidden at ${path}.${key}`,
        );
      }
      assertNoJsonNumberMoney(nested, `${path}.${key}`);
    }
  }
}
