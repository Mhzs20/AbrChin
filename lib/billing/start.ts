import {
  ActivationRequestStatus,
  Prisma,
  ResourceVersionState,
} from "@prisma/client";

import { WalletError } from "@/lib/wallet/errors";

function record(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function bigintField(value: unknown, name: string) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new WalletError(
      "billing_estimate_snapshot_invalid",
      `Billing snapshot field ${name} is invalid`,
    );
  }
  return BigInt(value);
}

export async function startInitialUsageBillingTx(
  tx: Prisma.TransactionClient,
  input: {
    cloudInstanceId: string;
    providerConfirmedAt: Date;
    providerEventId: string;
  },
) {
  const instance = await tx.cloudInstance.findUniqueOrThrow({
    where: { id: input.cloudInstanceId },
    include: {
      infrastructureOrder: {
        include: {
          activationRequest: {
            include: {
              billingPolicyVersion: true,
              plan: { include: { catalogItem: true } },
            },
          },
        },
      },
    },
  });
  const activation = instance.infrastructureOrder.activationRequest;
  if (!activation) return null;
  const replay = await tx.serviceBillingPolicySnapshot.findUnique({
    where: { activationRequestId: activation.id },
  });
  if (replay) return replay;
  if (
    activation.status !== ActivationRequestStatus.APPROVED &&
    activation.status !== ActivationRequestStatus.PROVISIONING
  ) {
    throw new WalletError(
      "activation_not_provider_confirmable",
      "درخواست فعال‌سازی برای شروع Billing آماده نیست.",
    );
  }
  const plan = activation.plan;
  if (
    plan.billingModel !== "PAYG_WALLET" ||
    !plan.vcpu ||
    !plan.ramGb ||
    plan.storageGb == null
  ) {
    throw new WalletError(
      "resource_snapshot_incomplete",
      "منابع Plan برای شروع Billing کامل نیست.",
    );
  }
  const estimate = record(activation.estimateSnapshot);
  const nestedBilling = record(
    estimate.billingSnapshot as Prisma.JsonValue,
  );
  const providerHourlyRial = bigintField(
    estimate.providerHourlyRial,
    "providerHourlyRial",
  );
  const hourlyEstimateRial = bigintField(
    estimate.hourlyEstimateRial,
    "hourlyEstimateRial",
  );
  const dailyEstimateRial = bigintField(
    estimate.dailyEstimateRial,
    "dailyEstimateRial",
  );
  const policy = activation.billingPolicyVersion;
  const snapshot = await tx.serviceBillingPolicySnapshot.create({
    data: {
      cloudInstanceId: instance.id,
      billingPolicyVersionId: policy.id,
      activationRequestId: activation.id,
      cadence: activation.selectedCadence,
      displayMode: policy.displayMode,
      calculationUnit: policy.calculationUnit,
      minimumChargeSeconds: policy.minimumChargeSeconds,
      roundingPolicy: policy.roundingPolicy,
      prorationSupported: policy.prorationSupported,
      hourlyEstimateRial,
      dailyEstimateRial,
      minimumCreditRial: activation.minimumCreditRequiredRial,
      gracePeriods:
        activation.selectedCadence === "HOURLY"
          ? policy.hourlyGracePeriods
          : policy.dailyGracePeriods,
      lowBalanceThresholdPeriods:
        policy.lowBalanceThresholdPeriods,
      stopStateComponentPolicy:
        policy.stopStateComponentPolicy as Prisma.InputJsonValue,
      providerPolicySnapshot:
        (nestedBilling.providerPolicySnapshot ??
          {}) as Prisma.InputJsonValue,
      effectiveFrom: input.providerConfirmedAt,
      idempotencyKey: `billing-policy:activation:${activation.id}`,
    },
  });
  const externalPlanId =
    typeof estimate.externalPlanId === "string"
      ? estimate.externalPlanId
      : plan.catalogItem?.externalPlanId ?? plan.sizeCode;
  const rate = await tx.rateCardVersion.create({
    data: {
      planId: plan.id,
      provider: plan.provider,
      providerApiVersion: plan.providerApiVersion,
      productKind: plan.productKind,
      externalPlanId,
      regionCode: plan.regionCode,
      component: "COMPUTE",
      resourceUnit: "INSTANCE",
      // Usage calculation and Wallet settlement are independent. This
      // duration-based rate is valid for either hourly or daily settlement;
      // an independent Provider daily contract is stored as a DAILY rate.
      rateCadence: null,
      calculationUnit: policy.calculationUnit,
      minimumChargeSeconds: policy.minimumChargeSeconds,
      roundingPolicy: policy.roundingPolicy,
      prorationSupported: policy.prorationSupported,
      providerAmount: providerHourlyRial,
      providerCurrency: "IRR",
      providerAmountUnit: "RIAL",
      normalizedProviderRial: providerHourlyRial,
      markupBasisPoints:
        typeof estimate.markupBasisPoints === "number"
          ? estimate.markupBasisPoints
          : 0,
      customerRateRial: hourlyEstimateRial,
      sourceRevision:
        typeof estimate.quoteId === "string"
          ? `quote:${estimate.quoteId}`
          : `activation:${activation.id}`,
      effectiveFrom: input.providerConfirmedAt,
      idempotencyKey: `rate:activation:${activation.id}:compute`,
    },
  });
  const resource = await tx.resourceVersion.create({
    data: {
      cloudInstanceId: instance.id,
      planId: plan.id,
      provider: instance.provider,
      providerInstanceId: instance.providerInstanceId,
      state: ResourceVersionState.ACTIVE,
      vcpu: plan.vcpu,
      ramMb: plan.ramGb * 1024,
      diskGb: plan.storageGb,
      ipv4Count: instance.ipv4 ? 1 : 0,
      backupEnabled: false,
      snapshotCount: 0,
      resourceSnapshot: {
        vcpu: plan.vcpu,
        ramMb: plan.ramGb * 1024,
        diskGb: plan.storageGb,
        externalPlanId,
        rateCardVersionId: rate.id,
      },
      providerEventId: input.providerEventId,
      providerConfirmedAt: input.providerConfirmedAt,
      effectiveFrom: input.providerConfirmedAt,
      idempotencyKey: `resource:activation:${activation.id}`,
    },
  });
  await tx.usageInterval.create({
    data: {
      cloudInstanceId: instance.id,
      resourceVersionId: resource.id,
      billingPolicySnapshotId: snapshot.id,
      status: "OPEN",
      startedAt: input.providerConfirmedAt,
      providerEventStartId: input.providerEventId,
      idempotencyKey: `usage:activation:${activation.id}`,
    },
  });
  await tx.activationRequest.update({
    where: { id: activation.id },
    data: {
      status: ActivationRequestStatus.PROVIDER_CONFIRMED,
      providerConfirmedAt: input.providerConfirmedAt,
    },
  });
  return snapshot;
}
