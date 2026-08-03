import type {
  BillingCalculationUnit,
  BillingComponentType,
  BillingResourceUnit,
  BillingRoundingPolicy,
  Prisma,
  ResourceVersionState,
} from "@prisma/client";

export class BillingCalculationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BillingCalculationError";
    this.code = code;
  }
}

export type ResourceQuantitySnapshot = {
  state: ResourceVersionState;
  vcpu: number;
  ramMb: number;
  diskGb: number;
  ipv4Count: number;
  backupEnabled: boolean;
  snapshotCount: number;
};

export type CalculableRate = {
  calculationUnit: BillingCalculationUnit;
  minimumChargeSeconds: number;
  roundingPolicy: BillingRoundingPolicy;
  prorationSupported: boolean;
  resourceUnit: BillingResourceUnit;
  normalizedProviderRial: bigint;
  customerRateRial: bigint;
  markupBasisPoints: number;
};

function ceilDiv(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n || numerator < 0n) {
    throw new BillingCalculationError(
      "invalid_division",
      "Billing division inputs are invalid",
    );
  }
  if (numerator === 0n) return 0n;
  return (numerator + denominator - 1n) / denominator;
}

function unitSeconds(unit: BillingCalculationUnit) {
  if (unit === "SECOND") return 1n;
  if (unit === "MINUTE") return 60n;
  if (unit === "HOUR") return 3_600n;
  return 86_400n;
}

function resourceFactor(
  unit: BillingResourceUnit,
  resource: ResourceQuantitySnapshot,
) {
  if (unit === "INSTANCE" || unit === "ADDON") {
    return { numerator: 1n, denominator: 1n };
  }
  if (unit === "VCPU") {
    return { numerator: BigInt(resource.vcpu), denominator: 1n };
  }
  if (unit === "GB_RAM") {
    return { numerator: BigInt(resource.ramMb), denominator: 1_024n };
  }
  if (unit === "GB_DISK") {
    return { numerator: BigInt(resource.diskGb), denominator: 1n };
  }
  if (unit === "IP") {
    return { numerator: BigInt(resource.ipv4Count), denominator: 1n };
  }
  if (unit === "BACKUP") {
    return {
      numerator: resource.backupEnabled ? 1n : 0n,
      denominator: 1n,
    };
  }
  if (unit === "SNAPSHOT") {
    return {
      numerator: BigInt(resource.snapshotCount),
      denominator: 1n,
    };
  }
  throw new BillingCalculationError(
    "metered_usage_required",
    `${unit} requires provider-confirmed metered usage`,
  );
}

function roundedTimeFactor(input: {
  durationSeconds: bigint;
  unitSeconds: bigint;
  minimumChargeSeconds: number;
  roundingPolicy: BillingRoundingPolicy;
  prorationSupported: boolean;
}) {
  const duration = [
    input.durationSeconds,
    BigInt(input.minimumChargeSeconds),
  ].reduce((maximum, value) => (value > maximum ? value : maximum), 0n);

  if (input.prorationSupported && input.roundingPolicy === "EXACT") {
    return { numerator: duration, denominator: input.unitSeconds };
  }
  if (!input.prorationSupported || input.roundingPolicy === "CEIL_UNIT") {
    return {
      numerator: ceilDiv(duration, input.unitSeconds),
      denominator: 1n,
    };
  }
  if (input.roundingPolicy === "FLOOR_UNIT") {
    return {
      numerator: duration / input.unitSeconds,
      denominator: 1n,
    };
  }
  if (input.roundingPolicy === "NEAREST_UNIT") {
    return {
      numerator:
        (duration + input.unitSeconds / 2n) / input.unitSeconds,
      denominator: 1n,
    };
  }
  return { numerator: duration, denominator: input.unitSeconds };
}

export function calculateBillingLineAmount(input: {
  intervalStart: Date;
  intervalEnd: Date;
  resource: ResourceQuantitySnapshot;
  rate: CalculableRate;
}) {
  const durationMilliseconds =
    input.intervalEnd.getTime() - input.intervalStart.getTime();
  if (durationMilliseconds <= 0 || durationMilliseconds % 1_000 !== 0) {
    throw new BillingCalculationError(
      "invalid_usage_interval",
      "Usage intervals must be positive and aligned to whole seconds",
    );
  }
  if (
    input.rate.normalizedProviderRial < 0n ||
    input.rate.customerRateRial < 0n ||
    input.rate.markupBasisPoints < 0
  ) {
    throw new BillingCalculationError(
      "invalid_rate",
      "Rate card amounts and markup must be non-negative",
    );
  }

  const time = roundedTimeFactor({
    durationSeconds: BigInt(durationMilliseconds / 1_000),
    unitSeconds: unitSeconds(input.rate.calculationUnit),
    minimumChargeSeconds: input.rate.minimumChargeSeconds,
    roundingPolicy: input.rate.roundingPolicy,
    prorationSupported: input.rate.prorationSupported,
  });
  const resource = resourceFactor(input.rate.resourceUnit, input.resource);
  const quantityNumerator = time.numerator * resource.numerator;
  const quantityDenominator = time.denominator * resource.denominator;
  const providerCostRial = ceilDiv(
    input.rate.normalizedProviderRial * quantityNumerator,
    quantityDenominator,
  );
  const amountRial = ceilDiv(
    input.rate.customerRateRial * quantityNumerator,
    quantityDenominator,
  );
  if (amountRial < providerCostRial) {
    throw new BillingCalculationError(
      "negative_markup",
      "Customer rate cannot be lower than normalized provider rate",
    );
  }
  return {
    quantityNumerator,
    quantityDenominator,
    providerCostRial,
    markupAmountRial: amountRial - providerCostRial,
    amountRial,
  };
}

function readPolicyBoolean(
  policy: Prisma.JsonValue,
  component: BillingComponentType,
) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return false;
  }
  const record = policy as Record<string, Prisma.JsonValue>;
  const direct = record[component];
  if (typeof direct === "boolean") return direct;
  const lower = record[component.toLowerCase()];
  return typeof lower === "boolean" ? lower : false;
}

export function requiredBillableComponents(input: {
  resource: ResourceQuantitySnapshot;
  stopStateComponentPolicy: Prisma.JsonValue;
}) {
  const candidates: BillingComponentType[] = [
    "COMPUTE",
    ...(input.resource.diskGb > 0 ? (["DISK"] as const) : []),
    ...(input.resource.ipv4Count > 0 ? (["IP"] as const) : []),
    ...(input.resource.backupEnabled ? (["BACKUP"] as const) : []),
    ...(input.resource.snapshotCount > 0 ? (["SNAPSHOT"] as const) : []),
  ];
  if (input.resource.state === "ACTIVE") return candidates;
  if (input.resource.state === "TERMINATED") {
    return candidates.filter(
      (component) =>
        component !== "COMPUTE" &&
        readPolicyBoolean(input.stopStateComponentPolicy, component),
    );
  }
  return candidates.filter((component) =>
    readPolicyBoolean(input.stopStateComponentPolicy, component),
  );
}

export function assertCoveredByRanges(
  start: Date,
  end: Date,
  ranges: Array<{ start: Date; end: Date }>,
) {
  const sorted = ranges
    .filter((range) => range.end > start && range.start < end)
    .map((range) => ({
      start: range.start > start ? range.start : start,
      end: range.end < end ? range.end : end,
    }))
    .sort((left, right) => left.start.getTime() - right.start.getTime());
  let cursor = start.getTime();
  for (const range of sorted) {
    if (range.start.getTime() > cursor) return false;
    if (range.end.getTime() > cursor) cursor = range.end.getTime();
  }
  return cursor >= end.getTime();
}
