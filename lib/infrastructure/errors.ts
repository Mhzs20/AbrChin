import type { ProviderErrorCode } from "@/lib/infrastructure/types";

export class InfrastructureError extends Error {
  readonly code: ProviderErrorCode | string;

  constructor(code: ProviderErrorCode | string, message: string) {
    super(message);
    this.name = "InfrastructureError";
    this.code = code;
  }
}

export function isInsufficientBalanceError(error: unknown): boolean {
  return error instanceof InfrastructureError && error.code === "provider_insufficient_balance";
}

export function isAmbiguousProviderError(error: unknown): boolean {
  return error instanceof InfrastructureError && error.code === "provider_ambiguous";
}

export function isProviderTimeoutError(error: unknown): boolean {
  return error instanceof InfrastructureError && error.code === "provider_timeout";
}

export function customerSafeProviderMessage(): string {
  return "عملیات زیرساخت در حال حاضر ممکن نیست. لطفاً با پشتیبانی تماس بگیرید.";
}
