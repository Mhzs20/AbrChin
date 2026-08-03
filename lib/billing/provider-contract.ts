import type {
  BillingCalculationUnit,
  BillingRoundingPolicy,
  InfrastructureProductKind,
  InfrastructureProvider,
  Prisma,
  PrismaClient,
  ProviderBillingContractVersion,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { WalletError } from "@/lib/wallet/errors";

type Db = PrismaClient | Prisma.TransactionClient;

type ContractField =
  | "calculationUnit"
  | "minimumChargeSeconds"
  | "roundingPolicy"
  | "prorationSupported"
  | "hourlyRateAvailable"
  | "dailyRateAvailable"
  | "stopStateBillableComponents";

const REQUIRED_FIELDS: ContractField[] = [
  "calculationUnit",
  "minimumChargeSeconds",
  "roundingPolicy",
  "prorationSupported",
  "hourlyRateAvailable",
  "dailyRateAvailable",
  "stopStateBillableComponents",
];

type StopStateBillableComponents = {
  compute: boolean;
  disk: boolean;
  ip: boolean;
  backup: boolean;
  traffic: boolean;
  snapshot: boolean;
};

export type VerifiedProviderBillingContract = {
  id: string;
  provider: InfrastructureProvider;
  providerApiVersion: string;
  productKind: InfrastructureProductKind;
  version: number;
  source: string;
  effectiveFrom: Date;
  calculationUnit: BillingCalculationUnit;
  minimumChargeSeconds: number;
  roundingPolicy: BillingRoundingPolicy;
  prorationSupported: boolean;
  hourlyRateAvailable: boolean;
  dailyRateAvailable: boolean;
  stopStateBillableComponents: StopStateBillableComponents;
};

function record(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parsedStopStateComponents(
  value: Prisma.JsonValue,
): StopStateBillableComponents | null {
  const fields = record(value);
  const names = ["compute", "disk", "ip", "backup", "traffic", "snapshot"] as const;
  if (names.some((name) => typeof fields[name] !== "boolean")) return null;
  return {
    compute: fields.compute as boolean,
    disk: fields.disk as boolean,
    ip: fields.ip as boolean,
    backup: fields.backup as boolean,
    traffic: fields.traffic as boolean,
    snapshot: fields.snapshot as boolean,
  };
}

export function providerBillingContractBlockingReasons(
  contract: ProviderBillingContractVersion | null,
) {
  if (!contract) return ["provider_billing_contract_missing"];
  const verification = record(contract.fieldVerification);
  const missing: string[] = REQUIRED_FIELDS.filter(
    (field) => verification[field] !== "VERIFIED",
  );
  if (contract.status !== "VERIFIED") missing.unshift("contract_status");
  if (contract.calculationUnit == null) missing.push("calculationUnit_value");
  if (contract.minimumChargeSeconds == null) {
    missing.push("minimumChargeSeconds_value");
  }
  if (contract.roundingPolicy == null) missing.push("roundingPolicy_value");
  if (contract.prorationSupported == null) {
    missing.push("prorationSupported_value");
  }
  if (contract.hourlyRateAvailable == null) {
    missing.push("hourlyRateAvailable_value");
  }
  if (contract.dailyRateAvailable == null) {
    missing.push("dailyRateAvailable_value");
  }
  if (!parsedStopStateComponents(contract.stopStateBillableComponents)) {
    missing.push("stopStateBillableComponents_value");
  }
  return [...new Set(missing)];
}

export function serializeProviderBillingContract(
  contract: ProviderBillingContractVersion,
) {
  return {
    id: contract.id,
    provider: contract.provider,
    providerApiVersion: contract.providerApiVersion,
    productKind: contract.productKind,
    version: contract.version,
    status: contract.status,
    source: contract.source,
    effectiveFrom: contract.effectiveFrom.toISOString(),
    effectiveTo: contract.effectiveTo?.toISOString() ?? null,
    calculationUnit: contract.calculationUnit,
    minimumChargeSeconds: contract.minimumChargeSeconds,
    roundingPolicy: contract.roundingPolicy,
    prorationSupported: contract.prorationSupported,
    hourlyRateAvailable: contract.hourlyRateAvailable,
    dailyRateAvailable: contract.dailyRateAvailable,
    stopStateBillableComponents: contract.stopStateBillableComponents,
    fieldVerification: contract.fieldVerification,
    unverifiedFields: providerBillingContractBlockingReasons(contract),
  };
}

export async function getEffectiveProviderBillingContract(
  input: {
    provider: InfrastructureProvider;
    providerApiVersion: string;
    productKind: InfrastructureProductKind;
    at?: Date;
  },
  db: Db = prisma,
) {
  const at = input.at ?? new Date();
  return db.providerBillingContractVersion.findFirst({
    where: {
      provider: input.provider,
      providerApiVersion: input.providerApiVersion,
      productKind: input.productKind,
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
  });
}

export function requireVerifiedProviderBillingContract(
  contract: ProviderBillingContractVersion | null,
): VerifiedProviderBillingContract {
  const blockingReasons = providerBillingContractBlockingReasons(contract);
  if (!contract || blockingReasons.length > 0) {
    throw new WalletError(
      "provider_billing_contract_unverified",
      `قرارداد Billing Provider تأیید نشده است: ${blockingReasons.join(", ")}`,
    );
  }
  const stopStateBillableComponents = parsedStopStateComponents(
    contract.stopStateBillableComponents,
  );
  if (!stopStateBillableComponents) {
    throw new WalletError(
      "provider_billing_contract_unverified",
      "قرارداد Billing Provider کامل نیست.",
    );
  }
  return {
    id: contract.id,
    provider: contract.provider,
    providerApiVersion: contract.providerApiVersion,
    productKind: contract.productKind,
    version: contract.version,
    source: contract.source,
    effectiveFrom: contract.effectiveFrom,
    calculationUnit: contract.calculationUnit!,
    minimumChargeSeconds: contract.minimumChargeSeconds!,
    roundingPolicy: contract.roundingPolicy!,
    prorationSupported: contract.prorationSupported!,
    hourlyRateAvailable: contract.hourlyRateAvailable!,
    dailyRateAvailable: contract.dailyRateAvailable!,
    stopStateBillableComponents,
  };
}

export function stopStatePolicyFromProviderContract(
  contract: VerifiedProviderBillingContract,
) {
  return {
    COMPUTE: contract.stopStateBillableComponents.compute,
    DISK: contract.stopStateBillableComponents.disk,
    IP: contract.stopStateBillableComponents.ip,
    BACKUP: contract.stopStateBillableComponents.backup,
    TRAFFIC: contract.stopStateBillableComponents.traffic,
    SNAPSHOT: contract.stopStateBillableComponents.snapshot,
  };
}
