import type {
  BillingCadence,
  BillingPolicyVersion,
  InfrastructureProductKind,
  InfrastructureProvider,
  Prisma,
  PrismaClient,
} from "@prisma/client";

import { validateBillingPolicyContract } from "@/lib/billing/policy";
import {
  getVerifiedProviderBillingContractFromSnapshot,
  requireVerifiedProviderBillingContract,
  type VerifiedProviderBillingContract,
} from "@/lib/billing/provider-contract";

type Db = PrismaClient | Prisma.TransactionClient;

type PendingServiceBillingSnapshot = {
  providerBillingContractSnapshot: Prisma.JsonValue | null;
  estimateSnapshot: Prisma.JsonValue;
  selectedCadence: BillingCadence;
  billingPolicyVersion: BillingPolicyVersion;
};

function record(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positiveRial(value: unknown) {
  return typeof value === "string" && /^\d+$/.test(value) && BigInt(value) > 0n;
}

/**
 * The ActivationRequest is the pending-service Billing Policy Snapshot before
 * a CloudInstance exists. It is immutable after first Admin approval and is
 * copied verbatim into ServiceBillingPolicySnapshot and RateCardVersion only
 * after provider confirmation.
 */
export async function evaluateProvisioningBillingContractGate(
  input: {
    pendingService: PendingServiceBillingSnapshot | null | undefined;
    provider: InfrastructureProvider;
    providerApiVersion: string;
    productKind: InfrastructureProductKind;
    externalPlanId?: string | null;
    at?: Date;
  },
  db: Db,
): Promise<
  | { allowed: true; contract: VerifiedProviderBillingContract }
  | { allowed: false; blockingReasons: string[] }
> {
  const pendingService = input.pendingService;
  if (!pendingService) {
    return {
      allowed: false,
      blockingReasons: ["pending_service_billing_snapshot_missing"],
    };
  }

  const blockingReasons: string[] = [];
  try {
    validateBillingPolicyContract(pendingService.billingPolicyVersion);
  } catch {
    blockingReasons.push("billing_policy_snapshot_invalid");
  }

  const estimate = record(pendingService.estimateSnapshot);
  const billingSnapshot = record(estimate?.billingSnapshot as Prisma.JsonValue);
  if (!estimate || !billingSnapshot) {
    blockingReasons.push("billing_policy_snapshot_missing");
  } else {
    if (estimate.provider !== input.provider) {
      blockingReasons.push("billing_snapshot_provider_mismatch");
    }
    if (estimate.providerApiVersion !== input.providerApiVersion) {
      blockingReasons.push("billing_snapshot_provider_api_version_mismatch");
    }
    if (estimate.productKind !== input.productKind) {
      blockingReasons.push("billing_snapshot_product_kind_mismatch");
    }
    if (billingSnapshot.cadence !== pendingService.selectedCadence) {
      blockingReasons.push("billing_snapshot_cadence_mismatch");
    }
    if (estimate.billingPolicyVersionId !== pendingService.billingPolicyVersion.id) {
      blockingReasons.push("billing_snapshot_policy_version_mismatch");
    }
    if (!positiveRial(estimate.providerHourlyRial)) {
      blockingReasons.push("rate_card_provider_hourly_rate_missing");
    }
    if (!positiveRial(estimate.hourlyEstimateRial)) {
      blockingReasons.push("rate_card_hourly_rate_missing");
    }
    if (!positiveRial(estimate.dailyEstimateRial)) {
      blockingReasons.push("rate_card_daily_rate_missing");
    }
    if (
      input.externalPlanId &&
      typeof estimate.externalPlanId === "string" &&
      estimate.externalPlanId !== input.externalPlanId
    ) {
      blockingReasons.push("rate_card_external_plan_mismatch");
    }
  }

  const contractResult = await getVerifiedProviderBillingContractFromSnapshot(
    {
      snapshot: pendingService.providerBillingContractSnapshot,
      provider: input.provider,
      providerApiVersion: input.providerApiVersion,
      productKind: input.productKind,
      at: input.at,
    },
    db,
  );
  blockingReasons.push(...contractResult.blockingReasons);
  if (blockingReasons.length > 0 || !contractResult.contract) {
    return {
      allowed: false,
      blockingReasons: [...new Set(blockingReasons)],
    };
  }

  const contract = requireVerifiedProviderBillingContract(contractResult.contract);
  if (
    (pendingService.selectedCadence === "HOURLY" &&
      !contract.hourlyRateAvailable) ||
    (pendingService.selectedCadence === "DAILY" &&
      !contract.dailyRateAvailable)
  ) {
    return {
      allowed: false,
      blockingReasons: [
        pendingService.selectedCadence === "HOURLY"
          ? "provider_hourly_rate_not_verified"
          : "provider_daily_rate_not_verified",
      ],
    };
  }
  return { allowed: true, contract };
}
