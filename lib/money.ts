/** Money helpers: store IRR (rial) as integer BigInt; display as toman. */

export const TOMAN_TO_RIAL = 10n;

export function tomanToRial(toman: number | bigint): bigint {
  const value = typeof toman === "bigint" ? toman : BigInt(toman);
  if (value <= 0n) {
    throw new Error("Amount must be positive");
  }
  return value * TOMAN_TO_RIAL;
}

export function rialToToman(rial: bigint): bigint {
  return rial / TOMAN_TO_RIAL;
}

export function assertPositiveIntegerToman(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error("Amount must be a positive integer toman value");
  }
  return value;
}

export function formatTomanFa(rial: bigint): string {
  const toman = rialToToman(rial);
  return toman.toLocaleString("fa-IR");
}

export function bigintToString(value: bigint): string {
  return value.toString();
}
