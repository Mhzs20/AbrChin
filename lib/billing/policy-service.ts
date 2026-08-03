import type {
  BillingCadence,
  BillingPolicyVersion,
  Prisma,
  PrismaClient,
  ProviderBillingContractVersion,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  assertCadenceAllowed,
  calculateMinimumCreditRial,
  validateBillingPolicyContract,
} from "@/lib/billing/policy";
import { serializeProviderBillingContract } from "@/lib/billing/provider-contract";

type Db = PrismaClient | Prisma.TransactionClient;

export async function getEffectiveBillingPolicy(
  planId: string,
  at = new Date(),
  db: Db = prisma,
): Promise<BillingPolicyVersion> {
  const plan = await db.infrastructurePlan.findUnique({
    where: { id: planId },
  });
  if (!plan || plan.billingModel !== "PAYG_WALLET") {
    throw new Error("payg_plan_not_found");
  }
  const planPolicy = await db.billingPolicyVersion.findFirst({
    where: {
      planId,
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
  });
  const policy =
    planPolicy ??
    (await db.billingPolicyVersion.findFirst({
      where: {
        policyKey: "global",
        scope: "GLOBAL",
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
    }));
  if (
    !policy ||
    policy.effectiveFrom.getTime() > at.getTime() ||
    (policy.effectiveTo && policy.effectiveTo.getTime() <= at.getTime())
  ) {
    throw new Error("billing_policy_unavailable");
  }
  validateBillingPolicyContract(policy);
  return policy;
}

export function buildActivationBillingSnapshot(input: {
  policy: BillingPolicyVersion;
  cadence: BillingCadence;
  hourlyEstimateRial: bigint | null;
  dailyEstimateRial: bigint | null;
  oneTimeChargesRial: bigint;
  providerContract: ProviderBillingContractVersion | null;
}) {
  assertCadenceAllowed(input.policy.availability, input.cadence);
  const minimumCreditRial = calculateMinimumCreditRial({
    policy: input.policy,
    cadence: input.cadence,
    hourlyEstimateRial: input.hourlyEstimateRial,
    dailyEstimateRial: input.dailyEstimateRial,
    oneTimeChargesRial: input.oneTimeChargesRial,
  });
  const gracePeriods =
    input.cadence === "HOURLY"
      ? input.policy.hourlyGracePeriods
      : input.policy.dailyGracePeriods;
  return {
    cadence: input.cadence,
    displayMode: input.policy.displayMode,
    calculationUnit: input.policy.calculationUnit,
    minimumChargeSeconds: input.policy.minimumChargeSeconds,
    roundingPolicy: input.policy.roundingPolicy,
    prorationSupported: input.policy.prorationSupported,
    hourlyEstimateRial: input.hourlyEstimateRial,
    dailyEstimateRial: input.dailyEstimateRial,
    minimumCreditRial,
    gracePeriods,
    lowBalanceThresholdPeriods:
      input.policy.lowBalanceThresholdPeriods,
    stopStateComponentPolicy:
      input.policy.stopStateComponentPolicy as Prisma.InputJsonValue,
    providerPolicySnapshot:
      input.providerContract
        ? (serializeProviderBillingContract(
            input.providerContract,
          ) as Prisma.InputJsonValue)
        : ({
            status: "UNVERIFIED",
            source: "provider_billing_contract_missing",
            unverifiedFields: ["provider_billing_contract_missing"],
          } as Prisma.InputJsonValue),
  };
}
