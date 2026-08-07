import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";

import { PrismaClient } from "@prisma/client";

import { serializeProviderBillingContract } from "../lib/billing/provider-contract.ts";
import { FakeCloudProviderAdapter } from "../lib/infrastructure/fake-cloud-provider-adapter.ts";
import { processProvisioningJob } from "../lib/infrastructure/provisioning-service.ts";
import { allowAdminMobile } from "./test-admin-allowlist.mts";

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

async function seedRuntimeFixture(input: { verifiedContract: boolean }) {
  const suffix = randomBytes(5).toString("hex");
  const contractVersion = Number.parseInt(suffix.slice(0, 6), 16) + 1;
  const now = new Date();
  const adminMobile = `runtime-admin-${suffix}`;
  allowAdminMobile(adminMobile);
  const [customer, admin] = await Promise.all([
    db.user.create({ data: { mobile: `runtime-customer-${suffix}` } }),
    db.user.create({ data: { mobile: adminMobile, role: "ADMIN" } }),
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
  const contract = input.verifiedContract
    ? await db.providerBillingContractVersion.create({
        data: {
          provider: "ARVAN",
          providerApiVersion: "v1",
          productKind: "CLOUD_SERVER",
          version: contractVersion,
          status: "VERIFIED",
          source: "controlled-postgres-test",
          calculationUnit: "SECOND",
          minimumChargeSeconds: 1,
          roundingPolicy: "EXACT",
          prorationSupported: true,
          hourlyRateAvailable: true,
          dailyRateAvailable: true,
          stopStateBillableComponents: {
            compute: false,
            disk: true,
            ip: true,
            backup: true,
            traffic: false,
            snapshot: true,
          },
          fieldVerification: {
            calculationUnit: "VERIFIED",
            minimumChargeSeconds: "VERIFIED",
            roundingPolicy: "VERIFIED",
            prorationSupported: "VERIFIED",
            hourlyRateAvailable: "VERIFIED",
            dailyRateAvailable: "VERIFIED",
            stopStateBillableComponents: "VERIFIED",
          },
          effectiveFrom: new Date(now.getTime() - 60_000),
        },
      })
    : null;
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
      // A null value models a forward-only legacy Approval. A verified test
      // contract is serialized exactly as a current Approval snapshot.
      providerBillingContractSnapshot: contract
        ? serializeProviderBillingContract(contract)
        : null,
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

  return { contract, job, order, claimToken };
}

test("a legacy PAYG job without a billing snapshot is held before provider mutation", async () => {
  const fixture = await seedRuntimeFixture({ verifiedContract: false });
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
    fixture.job.id,
    controlledProvider as never,
    { claimToken: fixture.claimToken },
  );
  assert.deepEqual(result, { state: "PROVIDER_FAILED" });
  assert.equal(createCalls, 0);
  const [persistedJob, persistedOrder] = await Promise.all([
    db.provisioningJob.findUniqueOrThrow({ where: { id: fixture.job.id } }),
    db.infrastructureOrder.findUniqueOrThrow({ where: { id: fixture.order.id } }),
  ]);
  assert.equal(persistedJob.status, "FAILED");
  assert.equal(persistedJob.lastErrorCode, "billing_contract_blocked");
  assert.match(
    persistedJob.lastErrorMessage ?? "",
    /provider_billing_contract_snapshot_missing/,
  );
  assert.equal(persistedOrder.status, "MANUAL_REVIEW");
  assert.equal(persistedOrder.productFlowState, "PROVISIONING_MANUAL_REVIEW");
});

test("a contract revoked between the two guards never reaches provider mutation", async () => {
  const fixture = await seedRuntimeFixture({ verifiedContract: true });
  assert.ok(fixture.contract);
  const provider = new FakeCloudProviderAdapter({ provider: "ARVAN" });
  let finalGuardReached = false;

  const result = await processProvisioningJob(fixture.job.id, provider, {
    claimToken: fixture.claimToken,
    beforeProviderMutationBillingGuard: async () => {
      finalGuardReached = true;
      await db.providerBillingContractVersion.update({
        where: { id: fixture.contract!.id },
        data: { status: "REVOKED" },
      });
    },
  });
  assert.deepEqual(result, { state: "PROVIDER_FAILED" });
  assert.equal(finalGuardReached, true);
  assert.equal(provider.createCalls.length, 0);
  const [persistedJob, persistedOrder] = await Promise.all([
    db.provisioningJob.findUniqueOrThrow({ where: { id: fixture.job.id } }),
    db.infrastructureOrder.findUniqueOrThrow({ where: { id: fixture.order.id } }),
  ]);
  assert.equal(persistedJob.status, "FAILED");
  assert.equal(persistedJob.lastErrorCode, "billing_contract_blocked");
  assert.match(persistedJob.lastErrorMessage ?? "", /contract_revoked/);
  assert.equal(persistedOrder.status, "MANUAL_REVIEW");
  assert.equal(persistedOrder.productFlowState, "PROVISIONING_MANUAL_REVIEW");

  const replay = await processProvisioningJob(fixture.job.id, provider, {
    claimToken: fixture.claimToken,
  });
  assert.equal(replay, null);
  assert.equal(provider.createCalls.length, 0);
});

test("a valid contract snapshot submits exactly one idempotent provider mutation", async () => {
  const fixture = await seedRuntimeFixture({ verifiedContract: true });
  const provider = new FakeCloudProviderAdapter({ provider: "ARVAN" });

  const result = await processProvisioningJob(fixture.job.id, provider, {
    claimToken: fixture.claimToken,
    healthProbe: async () => true,
  });
  assert.equal(result?.healthy, true);
  assert.equal(provider.createCalls.length, 1);
  const persistedJob = await db.provisioningJob.findUniqueOrThrow({
    where: { id: fixture.job.id },
  });
  assert.equal(persistedJob.status, "SUCCEEDED");

  const replay = await processProvisioningJob(fixture.job.id, provider, {
    claimToken: fixture.claimToken,
    healthProbe: async () => true,
  });
  assert.equal(replay, null);
  assert.equal(provider.createCalls.length, 1);
});
