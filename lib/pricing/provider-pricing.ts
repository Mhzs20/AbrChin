export {
  DEFAULT_LAUNCH_MARKUP_BASIS_POINTS,
  DEFAULT_TARGET_GROSS_MARGIN_BPS,
  LEGACY_LAUNCH_MARKUP_BASIS_POINTS,
  grossMarginBpsToMarkupBps,
  markupBpsToGrossMarginBps,
} from "@/lib/pricing/commercial-engine";

export const PROVIDER_PRICE_SCALE = 6;
export const MARKUP_DENOMINATOR_BPS = 10_000n;

/**
 * Launch default: target gross margin 30% of the sale price ⇒ provider cost
 * ~70% of the pre-tax infrastructure sale, AbrChin profit ~30%.
 * sale ≈ cost × (10000 + 4286) / 10000. Historical quotes/orders keep their
 * own markup snapshots and never change retroactively.
 */
export const DEFAULT_LAUNCH_COST_SHARE_BPS = 7_000;
export const DEFAULT_LAUNCH_PROFIT_SHARE_BPS = 3_000;

export type ProviderPriceContract = {
  currencyCode: "IRR";
  amountUnit: "RIAL" | "TOMAN";
  rialMultiplier: bigint;
};

function divideRoundUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) {
    throw new Error("invalid_rounding_input");
  }
  return (numerator + denominator - 1n) / denominator;
}

export function decimalToScaledInteger(
  value: string,
  scale = PROVIDER_PRICE_SCALE,
): bigint {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error("invalid_provider_price");
  }
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > scale) {
    const discarded = fraction.slice(scale);
    if (/[1-9]/.test(discarded)) {
      throw new Error("provider_price_precision_exceeded");
    }
  }
  const padded = fraction.slice(0, scale).padEnd(scale, "0");
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(padded || "0");
}

export function normalizeProviderPriceContract(input: {
  currencyCode?: string | null;
  amountUnit?: string | null;
}): ProviderPriceContract | null {
  const currencyCode = input.currencyCode?.trim().toUpperCase();
  const amountUnit = input.amountUnit?.trim().toUpperCase();
  if (currencyCode !== "IRR") return null;
  if (amountUnit === "RIAL") {
    return { currencyCode, amountUnit, rialMultiplier: 1n };
  }
  if (amountUnit === "TOMAN") {
    return { currencyCode, amountUnit, rialMultiplier: 10n };
  }
  return null;
}

export function providerAmountToRial(params: {
  scaledAmount: bigint;
  scale?: number;
  contract: ProviderPriceContract;
}): bigint {
  if (params.scaledAmount <= 0n) throw new Error("invalid_provider_price");
  const scale = params.scale ?? PROVIDER_PRICE_SCALE;
  return divideRoundUp(
    params.scaledAmount * params.contract.rialMultiplier,
    10n ** BigInt(scale),
  );
}

export function calculateFinalPriceRial(
  providerBasePriceRial: bigint,
  markupBasisPoints: number,
): bigint {
  if (providerBasePriceRial <= 0n) throw new Error("invalid_provider_price");
  if (!Number.isInteger(markupBasisPoints) || markupBasisPoints < 0) {
    throw new Error("invalid_markup");
  }
  return divideRoundUp(
    providerBasePriceRial *
      (MARKUP_DENOMINATOR_BPS + BigInt(markupBasisPoints)),
    MARKUP_DENOMINATOR_BPS,
  );
}

export function parseMarkupPercentToBasisPoints(value: unknown): number {
  const raw =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error("invalid_markup");
  const [whole, fraction = ""] = raw.split(".");
  const basisPoints = Number.parseInt(whole, 10) * 100 +
    Number.parseInt(fraction.padEnd(2, "0") || "0", 10);
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > 100_000) {
    throw new Error("invalid_markup");
  }
  return basisPoints;
}

export function formatBasisPointsPercent(basisPoints: number): string {
  if (!Number.isInteger(basisPoints) || basisPoints < 0) throw new Error("invalid_markup");
  const whole = Math.floor(basisPoints / 100);
  const fraction = basisPoints % 100;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}
