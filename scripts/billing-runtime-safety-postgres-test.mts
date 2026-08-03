import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";

import { PrismaClient } from "@prisma/client";

import { processProvisioningJob } from "../lib/infrastructure/provisioning-service.ts";

if (
  process.env.ABRCHIN_ISOLATED_TEST !== "1" ||
  !process.env.DATABASE_URL
) {
  throw new Error(
    "ABRCHIN_ISOLATED_TEST=1 and DATABASE_URL are required",
  );
}

const db = new PrismaClient();

after(async () => {
  await db.$disconnect();
});

test("a legacy or revoked billing snapshot is held before any provider mutation", async () => {
  const suffix = randomBytes(5).toString("hex");
  const now = new Date();
  const [customer, admin] = await Promise.all([
    db.user.create({ data: { mobile: `runtime-customer-${suffix}` } }),
    db.user.create({ data: { mobile: `runtime-admin-${suffix}`, role: "ADMIN" } }),
  ]);
  const policy = await db.billingPolicyVersion.create({
    data: {
      policyKey: `runtime-safety-${suffix}`,
      version: 1,
      scope: "GLOBAL",
      availability: "HOURLY_AND_DAILY",
      defaultCadence: "HOURLY",
      displayMode: "BOTH",
      hourlyMinimumCreditHours: 24,
      dailyMinimumCreditDays: 1,
      hourlyGracePeriods: 24,
      dailyGracePeriods: 3,
      lowBalanceThresholdPeriods: 3,
      calculationUnit: "SECOND",
      minimumChargeSeconds: 0,
      roundingPolicy: "EXACT",
      prorationSupported: true,
      stopStateComponentPolicy: { COMPUTE: false, DISK: true },
      enabledCadences: ["HOURLY", "DAILY"],
      effectiveFrom: new Date(now.getTime() - 60_000),
      changeReason: "runtime safety test",
    },
  });
  const plan = await db.infrastructurePlan.create({
    data: {
      code: `RUNTIME-${suffix}`,
      title: "Runtime safety fixture",
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "CLOUD_SERVER",
      regionCode: "ir-thr",
      sizeCode: "runtime-small",
      imageCode: "ubuntu-24",
      deliveryMode: "MANAGED",
      vcpu: 2,
      ramGb: 4,
      storageGb: 50,
      salePriceRial: 1_000n,
      estimatedProviderCostRial: 800n,
      billingModel: "PAYG_WALLET",
      billingPolicyVersionId: policy.id,
    },
  });
  const serviceOrder = await db.serviceOrder.create({
    data: {
      userId: customer.id,
      planId: plan.id,
      title: "Runtime safety service",
      amount: 0n,
      currency: "IRR",
      status: "PAID",
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "CLOUD_SERVER",
      productFlowState: "PROVISIONING",
      productFlowRevision: 1,
    },
  });
  const order = await db.infrastructureOrder.create({
    data: {
      serviceOrderId: serviceOrder.id,
      userId: customer.id,
      planId: plan.id,
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "CLOUD_SERVER",
      deliveryMode: "MANAGED",
      status: "PROVISIONING",
      requiredFundingRial: 0n,
      desiredInstanceName: `runtime-${suffix}`,
      productFlowState: "PROVISIONING",
      productFlowRevision: 1,
      providerSelectionSnapshot: {
        provider: "ARVAN",
        providerApiVersion: "v1",
        productKind: "CLOUD_SERVER",
        region: "ir-thr",
        externalPlanId: "runtime-small",
        externalImageId: "ubuntu-24",
        externalNetworkId: "network-runtime",
        externalSecurityId: "security-runtime",
        topologyVerificationMode: "STRICT_OBSERVED",
        deliveryConfiguration: {
          provider: "ARVAN",
          providerApiVersion: "v1",
          productKind: "CLOUD_SERVER",
          region: "ir-thr",
          externalPlanId: "runtime-small",
          externalImageId: "ubuntu-24",
          externalNetworkId: "network-runtime",
          externalSecurityId: "security-runtime",
          topologyVerificationMode: "STRICT_OBSERVED",
          accessMethod: "ONE_TIME_PASSWORD",
        },
      },
    },
  });
  await db.activationRequest.create({
    data: {
      userId: customer.id,
      serviceOrderId: serviceOrder.id,
      planId: plan.id,
      billingPolicyVersionId: policy.id,
      infrastructureOrderId: order.id,
      selectedCadence: "HOURLY",
      status: "APPROVED",
      estimatedHourlyRial: 120n,
      estimatedDailyRial: 2_880n,
      minimumCreditRequiredRial: 2_880n,
      estimateSnapshot: {
        provider: "ARVAN",
        providerApiVersion: "v1",
        productKind: "CLOUD_SERVER",
        externalPlanId: "runtime-small",
        providerHourlyRial: "100",
        hourlyEstimateRial: "120",
        dailyEstimateRial: "2880",
        billingPolicyVersionId: policy.id,
        billingSnapshot: { cadence: "HOURLY" },
      },
      // Simulates an Approved order from before the forward-only snapshot
      // migration. It must never reach adapter.createServer.
      providerBillingContractSnapshot: null,
      idempotencyKey: `runtime-activation-${suffix}`,
      firstApprovedAt: now,
      firstApprovedById: admin.id,
    },
  });
  await db.adminCommandReceipt.create({
    data: {
      operation: "APPROVE_PROVISION",
      idempotencyKey: `runtime-approval-${suffix}`,
      requestFingerprint: `runtime-approval-${suffix}`,
      actorUserId: admin.id,
      infrastructureOrderId: order.id,
      serviceOrderId: serviceOrder.id,
      resultSnapshot: { approved: true },
    },
  });
  const claimToken = `claim-${suffix}`;
  const job = await db.provisioningJob.create({
    data: {
      infrastructureOrderId: order.id,
      operation: "create_instance",
      status: "RUNNING",
      idempotencyKey: `runtime-job-${suffix}`,
      workerId: "runtime-safety-worker",
      claimToken,
      lockedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      startedAt: now,
    },
  });

  let createCalls = 0;
  const controlledProvider = {
    provider: "ARVAN",
    apiVersion: "v1",
    createServer: async () => {
      createCalls += 1;
      throw new Error("provider_create_must_not_be_called");
    },
  };
  const result = await processProvisioningJob(
    job.id,
    controlledProvider as never,
    { claimToken },
  );
  assert.deepEqual(result, { state: "PROVIDER_FAILED" });
  assert.equal(createCalls, 0);
  const [persistedJob, persistedOrder] = await Promise.all([
    db.provisioningJob.findUniqueOrThrow({ where: { id: job.id } }),
    db.infrastructureOrder.findUniqueOrThrow({ where: { id: order.id } }),
  ]);
  assert.equal(persistedJob.status, "FAILED");
  assert.equal(persistedJob.lastErrorCode, "billing_contract_blocked");
  assert.match(
    persistedJob.lastErrorMessage ?? "",
    /provider_billing_contract_snapshot_missing/,
  );
  assert.equal(persistedOrder.status, "MANUAL_REVIEW");
  assert.equal(persistedOrder.productFlowState, "PROVISIONING_MANUAL_REVIEW");

  const replay = await processProvisioningJob(
    job.id,
    controlledProvider as never,
    { claimToken },
  );
  assert.equal(replay, null);
  assert.equal(createCalls, 0);
});
