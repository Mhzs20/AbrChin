import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import {
  costRial,
  SettlementError,
  walletAmountString,
} from "@/lib/messagego/settlement/amount";

type PriceDb = PrismaClient | Prisma.TransactionClient;

export const DEFAULT_CUSTOMER_MODEL = "messagego.fast";
export const UNIT_RIAL_PER_MILLION = 1_000_000n;

export type CustomerPriceRecord = {
  stableModelAlias: string;
  revision: bigint;
  pricingVersion: string;
  pricingFingerprint: string;
  inputRialPerMillion: bigint;
  outputRialPerMillion: bigint;
  maxInputTokens: bigint;
  maxOutputTokens: bigint;
};

export function customerPriceFingerprint(input: {
  stableModelAlias: string;
  pricingVersion: string;
  inputRialPerMillion: bigint;
  outputRialPerMillion: bigint;
}) {
  return createHash("sha256")
    .update(
      [
        "abrchin.customer_price",
        input.stableModelAlias,
        input.pricingVersion,
        input.inputRialPerMillion.toString(10),
        input.outputRialPerMillion.toString(10),
      ].join("|"),
    )
    .digest("hex");
}

export function parseTokenCount(value: unknown, field: string): bigint {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 1 || value > Number.MAX_SAFE_INTEGER) {
      throw new SettlementError("invalid_request", `${field} must be a positive integer token count`);
    }
    return BigInt(value);
  }
  if (typeof value === "string") {
    if (!/^[1-9][0-9]*$/.test(value.trim())) {
      throw new SettlementError("invalid_request", `${field} must be a positive integer token count`);
    }
    return BigInt(value.trim());
  }
  throw new SettlementError("invalid_request", `${field} is required`);
}

export type ProviderUsageTokens = {
  inputTextTokens: bigint;
  outputTextTokens: bigint;
};

export function parseProviderUsage(value: unknown): ProviderUsageTokens {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SettlementError("usage_unknown", "provider_usage is required");
  }
  const record = value as Record<string, unknown>;
  const input = parseUsageToken(record.input_text_tokens, "provider_usage.input_text_tokens");
  const output = parseUsageToken(record.output_text_tokens, "provider_usage.output_text_tokens");
  return { inputTextTokens: input, outputTextTokens: output };
}

function parseUsageToken(value: unknown, field: string): bigint {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
      throw new SettlementError("usage_unknown", `${field} is not a usable token count`);
    }
    return BigInt(value);
  }
  if (typeof value === "string") {
    if (!/^(0|[1-9][0-9]*)$/.test(value.trim())) {
      throw new SettlementError("usage_unknown", `${field} is not a usable token count`);
    }
    return BigInt(value.trim());
  }
  throw new SettlementError("usage_unknown", `${field} is required`);
}

export function deriveHoldRial(price: CustomerPriceRecord, maxInput: bigint, maxOutput: bigint): bigint {
  if (maxInput > price.maxInputTokens || maxOutput > price.maxOutputTokens) {
    throw new SettlementError("invalid_request", "requested token bounds exceed the published customer price");
  }
  return costRial(maxInput, price.inputRialPerMillion) + costRial(maxOutput, price.outputRialPerMillion);
}

export function deriveBillableRial(
  price: Pick<CustomerPriceRecord, "inputRialPerMillion" | "outputRialPerMillion">,
  usage: ProviderUsageTokens,
  maxInput: bigint,
  maxOutput: bigint,
): bigint {
  if (usage.inputTextTokens > maxInput || usage.outputTextTokens > maxOutput) {
    throw new SettlementError("usage_unknown", "provider usage exceeds the reserved token bounds");
  }
  return (
    costRial(usage.inputTextTokens, price.inputRialPerMillion) +
    costRial(usage.outputTextTokens, price.outputRialPerMillion)
  );
}

export async function latestCustomerPrice(
  db: PriceDb,
  modelAlias: string,
): Promise<CustomerPriceRecord> {
  const alias = modelAlias.trim();
  if (!alias) {
    throw new SettlementError("unknown_pricing", "model_alias is required");
  }
  const row = await db.messageGoCustomerPrice.findFirst({
    where: { stableModelAlias: alias },
    orderBy: { revision: "desc" },
  });
  if (!row || row.inputRialPerMillion < 1n || row.outputRialPerMillion < 1n) {
    throw new SettlementError("unknown_pricing", `no customer price for ${alias}`);
  }
  return {
    stableModelAlias: row.stableModelAlias,
    revision: row.revision,
    pricingVersion: row.pricingVersion,
    pricingFingerprint: row.pricingFingerprint,
    inputRialPerMillion: row.inputRialPerMillion,
    outputRialPerMillion: row.outputRialPerMillion,
    maxInputTokens: row.maxInputTokens,
    maxOutputTokens: row.maxOutputTokens,
  };
}

export function unitCustomerPriceRow(alias = DEFAULT_CUSTOMER_MODEL) {
  const pricingVersion = "price.v2.test";
  const inputRialPerMillion = UNIT_RIAL_PER_MILLION;
  const outputRialPerMillion = UNIT_RIAL_PER_MILLION;
  return {
    stableModelAlias: alias,
    revision: 1n,
    pricingVersion,
    pricingFingerprint: customerPriceFingerprint({
      stableModelAlias: alias,
      pricingVersion,
      inputRialPerMillion,
      outputRialPerMillion,
    }),
    currency: "IRR",
    inputRialPerMillion,
    outputRialPerMillion,
    maxInputTokens: 1_000_000n,
    maxOutputTokens: 1_000_000n,
    effectiveAt: new Date("2026-09-01T00:00:00.000Z"),
  };
}

export async function ensureUnitCustomerPrice(db: PriceDb, alias = DEFAULT_CUSTOMER_MODEL) {
  const data = unitCustomerPriceRow(alias);
  const existing = await db.messageGoCustomerPrice.findUnique({
    where: {
      stableModelAlias_revision: {
        stableModelAlias: data.stableModelAlias,
        revision: data.revision,
      },
    },
  });
  if (existing) return existing;
  return db.messageGoCustomerPrice.create({ data });
}

export function describeDerivedHold(hold: bigint) {
  return walletAmountString(hold);
}
