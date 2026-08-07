import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";

import { PrismaClient } from "@prisma/client";

import {
  createPlanBillingPolicyVersion,
  scheduleServiceBillingCadenceChange,
} from "../lib/billing/policy-admin.ts";
import { getEffectiveBillingPolicy } from "../lib/billing/policy-service.ts";
import { periodContainingUtc } from "../lib/billing/policy.ts";
import { recordProviderConfirmedResourceVersion } from "../lib/billing/resource-timeline.ts";
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

test("Admin policy versions and controlled service cadence changes are future-only", async () => {
  const suffix = randomBytes(5).toString("hex");
  const now = new Date();
  const globalPolicy =
    await db.billingPolicyVersion.findFirstOrThrow({
      where: {
        policyKey: "global",
        scope: "GLOBAL",
        effectiveTo: null,
      },
      orderBy: { version: "desc" },
    });
  const adminMobile = `policy-admin-${suffix}`;
  allowAdminMobile(adminMobile);
  const [customer, admin] = await Promise.all([
    db.user.create({ data: { mobile: `policy-customer-${suffix}` } }),
    db.user.create({
      data: {
        mobile: adminMobile,
        role: "ADMIN",
      },
    }),
  ]);
  const wallet = await db.wallet.create({
    data: {
      userId: customer.id,
      availableBalance: 10_000_000n,
    },
  });
  const plan = await db.infrastructurePlan.create({
    data: {
      code: `POLICY-${suffix}`,
      title: "Billing policy fixture",
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "CLOUD_SERVER",
      regionCode: "ir-thr",
      sizeCode: `size-${suffix}`,
      imageCode: "ubuntu-24",
      deliveryMode: "MANAGED",
      vcpu: 2,
      ramGb: 4,
      storageGb: 50,
      salePriceRial: 240_000n,
      renewalPriceRial: 240_000n,
      estimatedProviderCostRial: 200_000n,
      billingModel: "PAYG_WALLET",
      billingPolicyVersionId: globalPolicy.id,
    },
  });
  const order = await db.serviceOrder.create({
    data: {
      userId: customer.id,
      planId: plan.id,
      title: "Active policy fixture",
      amount: 0n,
      currency: "IRR",
      status: "PAID",
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "CLOUD_SERVER",
    },
  });
  const infrastructureOrder = await db.infrastructureOrder.create({
    data: {
      serviceOrderId: order.id,
      userId: customer.id,
      planId: plan.id,
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "CLOUD_SERVER",
      deliveryMode: "MANAGED",
      status: "ACTIVE",
      requiredFundingRial: 0n,
    },
  });
  const instance = await db.cloudInstance.create({
    data: {
      infrastructureOrderId: infrastructureOrder.id,
      userId: customer.id,
      provider: "ARVAN",
      providerApiVersion: "v1",
      providerInstanceId: `provider-${suffix}`,
      name: `policy-${suffix}`,
      region: plan.regionCode,
      size: plan.sizeCode,
      image: plan.imageCode,
      deliveryMode: "MANAGED",
      status: "ACTIVE",
      providerState: "active",
      providerObservedAt: now,
      provisionedAt: now,
    },
  });
  const currentSnapshot =
    await db.serviceBillingPolicySnapshot.create({
      data: {
        cloudInstanceId: instance.id,
        billingPolicyVersionId: globalPolicy.id,
        cadence: "HOURLY",
        displayMode: "BOTH",
        calculationUnit: "SECOND",
        minimumChargeSeconds: 0,
        roundingPolicy: "EXACT",
        prorationSupported: true,
        hourlyEstimateRial: 1_000n,
        dailyEstimateRial: 24_000n,
        minimumCreditRial: 24_000n,
        gracePeriods: 24,
        lowBalanceThresholdPeriods: 3,
        stopStateComponentPolicy: {
          COMPUTE: true,
          DISK: true,
          IP: true,
        },
        providerPolicySnapshot: {
          verificationStatus: "UNVERIFIED",
          calculationUnit: "SECOND",
        },
        effectiveFrom: new Date(now.getTime() - 3_600_000),
        idempotencyKey: `policy-current-${suffix}`,
      },
    });
  const resource = await db.resourceVersion.create({
    data: {
      cloudInstanceId: instance.id,
      planId: plan.id,
      provider: "ARVAN",
      providerInstanceId: instance.providerInstanceId,
      state: "ACTIVE",
      vcpu: 2,
      ramMb: 4_096,
      diskGb: 50,
      ipv4Count: 1,
      backupEnabled: false,
      snapshotCount: 0,
      resourceSnapshot: { fixture: true },
      providerEventId: `policy-event-${suffix}`,
      providerConfirmedAt: now,
      effectiveFrom: new Date(now.getTime() - 3_600_000),
      idempotencyKey: `policy-resource-${suffix}`,
    },
  });
  const usage = await db.usageInterval.create({
    data: {
      cloudInstanceId: instance.id,
      resourceVersionId: resource.id,
      billingPolicySnapshotId: currentSnapshot.id,
      status: "OPEN",
      startedAt: currentSnapshot.effectiveFrom,
      providerEventStartId: `policy-event-${suffix}`,
      idempotencyKey: `policy-usage-${suffix}`,
    },
  });

  const immediate = new Date();
  const first = await createPlanBillingPolicyVersion({
    planId: plan.id,
    actorUserId: admin.id,
    idempotencyKey: `plan-policy-current-${suffix}`,
    policy: {
      availability: "HOURLY_ONLY",
      defaultCadence: "HOURLY",
      displayMode: "BOTH",
      hourlyMinimumCreditHours: 12,
      dailyMinimumCreditDays: 1,
      hourlyGracePeriods: 6,
      dailyGracePeriods: 2,
      lowBalanceThresholdPeriods: 3,
      effectiveFrom: immediate,
      changeReason: "activate controlled hourly override",
    },
  });
  const currentPolicy = await getEffectiveBillingPolicy(
    plan.id,
    new Date(immediate.getTime() + 1_000),
  );
  assert.equal(currentPolicy.availability, "HOURLY_ONLY");
  assert.equal(
    (
      await db.serviceBillingPolicySnapshot.findUniqueOrThrow({
        where: { id: currentSnapshot.id },
      })
    ).billingPolicyVersionId,
    globalPolicy.id,
  );

  const futureBoundary = periodContainingUtc(
    "HOURLY",
    new Date(),
  ).periodEnd;
  const secondInput = {
    planId: plan.id,
    actorUserId: admin.id,
    idempotencyKey: `plan-policy-future-${suffix}`,
    policy: {
      availability: "HOURLY_AND_DAILY" as const,
      defaultCadence: "HOURLY" as const,
      displayMode: "BOTH" as const,
      hourlyMinimumCreditHours: 12,
      dailyMinimumCreditDays: 1,
      hourlyGracePeriods: 6,
      dailyGracePeriods: 2,
      lowBalanceThresholdPeriods: 3,
      effectiveFrom: futureBoundary,
      changeReason: "enable daily choice from next period",
    },
  };
  const second = await createPlanBillingPolicyVersion(secondInput);
  assert.deepEqual(
    await createPlanBillingPolicyVersion(secondInput),
    second,
  );
  const futurePolicy = await getEffectiveBillingPolicy(
    plan.id,
    new Date(futureBoundary.getTime() + 1),
  );
  assert.equal(futurePolicy.availability, "HOURLY_AND_DAILY");
  assert.equal(futurePolicy.version, 2);
  assert.equal(
    (
      await db.infrastructurePlan.findUniqueOrThrow({
        where: { id: plan.id },
      })
    ).billingPolicyVersionId,
    futurePolicy.id,
  );

  const changeInput = {
    cloudInstanceId: instance.id,
    targetBillingPolicyVersionId: futurePolicy.id,
    targetCadence: "DAILY" as const,
    effectiveFrom: futureBoundary,
    actorUserId: admin.id,
    reason: "customer-approved cadence migration",
    idempotencyKey: `service-cadence-change-${suffix}`,
  };
  const change =
    await scheduleServiceBillingCadenceChange(changeInput);
  assert.deepEqual(
    await scheduleServiceBillingCadenceChange(changeInput),
    change,
  );
  const snapshots =
    await db.serviceBillingPolicySnapshot.findMany({
      where: { cloudInstanceId: instance.id },
      orderBy: { effectiveFrom: "asc" },
    });
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0]!.cadence, "HOURLY");
  assert.equal(
    snapshots[0]!.effectiveTo?.getTime(),
    futureBoundary.getTime(),
  );
  assert.equal(snapshots[1]!.cadence, "DAILY");
  assert.equal(
    snapshots[1]!.effectiveFrom.getTime(),
    futureBoundary.getTime(),
  );
  const usageIntervals = await db.usageInterval.findMany({
    where: { cloudInstanceId: instance.id },
    orderBy: { startedAt: "asc" },
  });
  assert.equal(usageIntervals.length, 2);
  assert.equal(usageIntervals[0]!.id, usage.id);
  assert.equal(usageIntervals[0]!.status, "COMPLETE");
  assert.equal(
    usageIntervals[0]!.endedAt?.getTime(),
    futureBoundary.getTime(),
  );
  assert.equal(usageIntervals[1]!.status, "OPEN");
  assert.equal(
    usageIntervals[1]!.startedAt.getTime(),
    futureBoundary.getTime(),
  );
  const resizedAt = new Date();
  const resizedResource =
    await recordProviderConfirmedResourceVersion({
      cloudInstanceId: instance.id,
      planId: plan.id,
      state: "ACTIVE",
      resources: {
        vcpu: 4,
        ramMb: 8_192,
        diskGb: 50,
        ipv4Count: 1,
        backupEnabled: false,
        snapshotCount: 0,
      },
      providerEventId: `policy-resize-event-${suffix}`,
      providerConfirmedAt: resizedAt,
      idempotencyKey: `policy-resize-${suffix}`,
    });
  const resizedIntervals = await db.usageInterval.findMany({
    where: { cloudInstanceId: instance.id },
    orderBy: { startedAt: "asc" },
  });
  assert.equal(resizedIntervals.length, 3);
  assert.equal(
    resizedIntervals[0]!.endedAt?.getTime(),
    resizedAt.getTime(),
  );
  assert.equal(
    resizedIntervals[1]!.billingPolicySnapshotId,
    snapshots[0]!.id,
  );
  assert.equal(
    resizedIntervals[1]!.endedAt?.getTime(),
    futureBoundary.getTime(),
  );
  assert.equal(
    resizedIntervals[1]!.resourceVersionId,
    resizedResource.id,
  );
  assert.equal(
    resizedIntervals[2]!.billingPolicySnapshotId,
    snapshots[1]!.id,
  );
  assert.equal(
    resizedIntervals[2]!.resourceVersionId,
    resizedResource.id,
  );
  assert.equal(resizedIntervals[2]!.status, "OPEN");
  assert.equal(
    await db.billingInvoice.count({
      where: { cloudInstanceId: instance.id },
    }),
    0,
  );
  assert.equal(
    (
      await db.wallet.findUniqueOrThrow({
        where: { id: wallet.id },
      })
    ).availableBalance,
    10_000_000n,
  );
  assert.equal(
    await db.auditLog.count({
      where: {
        actorUserId: admin.id,
        action: {
          in: ["billing_policy_update", "billing_cadence_change"],
        },
      },
    }),
    3,
  );
  assert.equal(
    (first as { activeServiceSnapshotsChanged: boolean })
      .activeServiceSnapshotsChanged,
    false,
  );
});
