import { InfrastructureProvider } from "@prisma/client";

const PROVIDER_SOURCE_UNITS = {
  [InfrastructureProvider.ARVAN]: ["IRR", "RIAL"],
  [InfrastructureProvider.PARSPACK]: ["IRR", "RIAL", "TOMAN"],
} as const;

function parseNonNegativeInteger(value: unknown): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error("invalid_provider_money");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("invalid_provider_money");
    }
    return BigInt(value);
  }
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    throw new Error("invalid_provider_money");
  }
  return BigInt(value.trim());
}

export function normalizeProviderMoney(
  provider: InfrastructureProvider,
  rawAmount: unknown,
  sourceUnit: string,
): bigint {
  const unit = sourceUnit.trim().toUpperCase();
  const allowed = PROVIDER_SOURCE_UNITS[provider] as readonly string[];
  if (!allowed.includes(unit)) throw new Error("unsupported_provider_money_unit");

  const amount = parseNonNegativeInteger(rawAmount);
  if (provider === InfrastructureProvider.PARSPACK && unit === "TOMAN") {
    return amount * 10n;
  }
  return amount;
}

export function irrToDisplayToman(amountIrr: bigint): {
  toman: bigint;
  remainderIrr: bigint;
} {
  if (amountIrr < 0n) throw new Error("invalid_money");
  return {
    toman: amountIrr / 10n,
    remainderIrr: amountIrr % 10n,
  };
}
