import { assertPositiveIntegerToman } from "../money.ts";
import { WalletError } from "./errors.ts";

export const MIN_TOPUP_TOMAN = 50_000;
export const MAX_TOPUP_TOMAN = 50_000_000;
export const TOPUP_TTL_MS = 30 * 60 * 1000;

export const DEFAULT_TOPUP_SUGGESTIONS_TOMAN = [
  1_000_000,
  5_000_000,
  10_000_000,
  20_000_000,
] as const;

export const TOPUP_SUGGESTION_COUNT = 4;

export function normalizeSuggestedAmounts(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length !== TOPUP_SUGGESTION_COUNT) {
    throw new WalletError(
      "invalid_suggestions",
      `باید دقیقاً ${TOPUP_SUGGESTION_COUNT} مبلغ پیشنهادی وارد شود.`,
    );
  }

  const amounts = raw.map((value, index) => {
    try {
      return assertPositiveIntegerToman(value);
    } catch {
      throw new WalletError("invalid_suggestions", `مبلغ پیشنهادی ${index + 1} نامعتبر است.`);
    }
  });

  for (const amount of amounts) {
    if (amount < MIN_TOPUP_TOMAN || amount > MAX_TOPUP_TOMAN) {
      throw new WalletError(
        "invalid_suggestions",
        `هر مبلغ پیشنهادی باید بین ${MIN_TOPUP_TOMAN.toLocaleString("fa-IR")} تا ${MAX_TOPUP_TOMAN.toLocaleString("fa-IR")} تومان باشد.`,
      );
    }
  }

  const unique = new Set(amounts);
  if (unique.size !== amounts.length) {
    throw new WalletError("invalid_suggestions", "مبالغ پیشنهادی نباید تکراری باشند.");
  }

  return [...amounts].sort((a, b) => a - b);
}
