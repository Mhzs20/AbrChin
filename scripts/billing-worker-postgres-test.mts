import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
import test, { after } from "node:test";

import {
  BillingCadence,
  PrismaClient,
  type BillingComponentType,
  type BillingResourceUnit,
  type ResourceVersionState,
} from "@prisma/client";

import { applyProviderBillingAdjustment } from "../lib/billing/adjustments.ts";
import {
  approveControlledSuspensionRequest,
  enqueueExpiredDunningForSuspensionReview,
} from "../lib/billing/dunning.ts";
import {
  calculateResourceChangeBufferRial,
  evaluateResourceChangeCredit,
} from "../lib/billing/policy.ts";
import { recordProviderConfirmedResourceVersion } from "../lib/billing/resource-timeline.ts";
import {
  getBillingCatchUpStatus,
  settleClosedBillingPeriod,
  settleClosedBillingPeriodsCatchUp,
} from "../lib/billing/worker.ts";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for billing worker tests");
}

const db = new PrismaClient();
const runId = `billing-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
let fixtureCounter = 0;

after(async () => {
  await db.$disconnect();
});

type SegmentInput = {
  start: Date;
  end: Date | null;
  state?: ResourceVersionState;
  vcpu?: number;
  ramMb?: number;
  diskGb?: number;
  ipv4Count?: number;
  backupEnabled?: boolean;
  snapshotCount?: number;
  status?: "OPEN" | "COMPLETE" | "INCOMPLETE" | "REVIEW";
  completenessReason?: string;
};

type RateInput = {
  component?: BillingComponentType;
  resourceUnit?: BillingResourceUnit;
  start: Date;
  end: Date | null;
  providerRateRial: bigint;
  customerRateRial: bigint;
  markupBasisPoints?: number;
  calculationUnit?: "SECOND" | "MINUTE" | "HOUR" | "DAY";
  rateCadence?: BillingCadence | null;
};

function utcDay(day: number) {
  return new Date(`2026-06-${String(day).padStart(2, "0")}T00:00:00.000Z`);
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1_000);
}

async function createFixture(input: {
  suffix: string;
  periodStart: Date;
  cadence?: BillingCadence;
  walletBalance?: bigint;
  segments?: SegmentInput[];
  rates?: RateInput[];
  stopPolicy?: Record<string, boolean>;
  lowBalanceThresholdPeriods?: number;
  gracePeriods?: number;
  serviceStartedAt?: Date;
}) {
  fixtureCounter += 1;
  const cadence = input.cadence ?? BillingCadence.DAILY;
  const periodEnd =
    cadence === BillingCadence.DAILY
      ? addHours(input.periodStart, 24)
      : addHours(input.periodStart, 1);
  const serviceStartedAt = input.serviceStartedAt ?? input.periodStart;
  const prefix = `${runId}-${fixtureCounter}-${input.suffix}`;
  const user = await db.user.create({
    data: {
      mobile: `098${String(randomInt(0, 100_000_000)).padStart(8, "0")}`,
    },
  });
  const wallet = await db.wallet.create({
    data: {
      userId: user.id,
      availableBalance: input.walletBalance ?? 10_000_000n,
      currency: "IRR",
    },
  });
  const plan = await db.infrastructurePlan.create({
    data: {
      code: `${prefix}-plan`,
      title: `${input.suffix} plan`,
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "CLOUD_SERVER",
      regionCode: "ir-thr",
      sizeCode: `${input.suffix}-size`,
      imageCode: "ubuntu",
      deliveryMode: "RAW",
      vcpu: 2,
      ramGb: 4,
      storageGb: 0,
      salePriceRial: 1_000_000n,
      estimatedProviderCostRial: 800_000n,
      billingModel: "PAYG_WALLET",
    },
  });
  const order = await db.serviceOrder.create({
    data: {
      userId: user.id,
      title: `${input.suffix} service`,
      amount: 0n,
      currency: "IRR",
      status: "PAID",
      planId: plan.id,
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "CLOUD_SERVER",
    },
  });
  const infrastructureOrder = await db.infrastructureOrder.create({
    data: {
      serviceOrderId: order.id,
      userId: user.id,
      planId: plan.id,
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "CLOUD_SERVER",
      deliveryMode: "RAW",
      status: "ACTIVE",
      requiredFundingRial: 0n,
    },
  });
  const instance = await db.cloudInstance.create({
    data: {
      infrastructureOrderId: infrastructureOrder.id,
      userId: user.id,
      provider: "ARVAN",
      providerApiVersion: "v1",
      providerInstanceId: `${prefix}-provider-instance`,
      name: `${prefix}-instance`,
      region: "ir-thr",
      size: `${input.suffix}-size`,
      image: "ubuntu",
      deliveryMode: "RAW",
      status: "ACTIVE",
      providerState: "ACTIVE",
      providerObservedAt: serviceStartedAt,
      provisionedAt: serviceStartedAt,
    },
  });
  const policy = await db.billingPolicyVersion.create({
    data: {
      policyKey: `${prefix}-policy`,
      version: 1,
      scope: "PLAN",
      planId: plan.id,
      availability:
        cadence === BillingCadence.HOURLY
          ? "HOURLY_ONLY"
          : "DAILY_ONLY",
      defaultCadence: cadence,
      displayMode: "BOTH",
      hourlyMinimumCreditHours: 24,
      dailyMinimumCreditDays: 1,
      hourlyGracePeriods: input.gracePeriods ?? 2,
      dailyGracePeriods: input.gracePeriods ?? 2,
      lowBalanceThresholdPeriods:
        input.lowBalanceThresholdPeriods ?? 2,
      calculationUnit: "SECOND",
      minimumChargeSeconds: 0,
      roundingPolicy: "EXACT",
      prorationSupported: true,
      stopStateComponentPolicy:
        input.stopPolicy ?? {
          COMPUTE: false,
          DISK: true,
          IP: true,
          BACKUP: true,
          TRAFFIC: false,
          SNAPSHOT: true,
        },
      enabledCadences: [cadence],
      effectiveFrom: serviceStartedAt,
      effectiveTo: periodEnd,
      changeReason: "controlled billing worker test",
    },
  });
  const snapshot = await db.serviceBillingPolicySnapshot.create({
    data: {
      cloudInstanceId: instance.id,
      billingPolicyVersionId: policy.id,
      cadence,
      displayMode: "BOTH",
      calculationUnit: "SECOND",
      minimumChargeSeconds: 0,
      roundingPolicy: "EXACT",
      prorationSupported: true,
      hourlyEstimateRial: 1_000n,
      dailyEstimateRial: 24_000n,
      minimumCreditRial: 24_000n,
      gracePeriods: input.gracePeriods ?? 2,
      lowBalanceThresholdPeriods:
        input.lowBalanceThresholdPeriods ?? 2,
      stopStateComponentPolicy:
        input.stopPolicy ?? {
          COMPUTE: false,
          DISK: true,
          IP: true,
          BACKUP: true,
          TRAFFIC: false,
          SNAPSHOT: true,
        },
      providerPolicySnapshot: {
        verificationStatus: "VERIFIED",
        calculationUnit: "SECOND",
        currencyNormalizedExplicitly: true,
      },
      effectiveFrom: serviceStartedAt,
      effectiveTo: periodEnd,
      idempotencyKey: `${prefix}-snapshot`,
    },
  });
  const segments =
    input.segments ??
    [
      {
        start: serviceStartedAt,
        end: periodEnd,
      },
    ];
  const resources = [];
  for (const [index, segment] of segments.entries()) {
    const resource = await db.resourceVersion.create({
      data: {
        cloudInstanceId: instance.id,
        planId: plan.id,
        provider: "ARVAN",
        providerInstanceId: instance.providerInstanceId,
        state: segment.state ?? "ACTIVE",
        vcpu: segment.vcpu ?? 2,
        ramMb: segment.ramMb ?? 4_096,
        diskGb: segment.diskGb ?? 0,
        ipv4Count: segment.ipv4Count ?? 0,
        backupEnabled: segment.backupEnabled ?? false,
        snapshotCount: segment.snapshotCount ?? 0,
        resourceSnapshot: {
          controlled: true,
          segment: index,
        },
        providerEventId: `${prefix}-event-${index}`,
        providerConfirmedAt: segment.start,
        effectiveFrom: segment.start,
        effectiveTo: segment.end,
        idempotencyKey: `${prefix}-resource-${index}`,
      },
    });
    await db.usageInterval.create({
      data: {
        cloudInstanceId: instance.id,
        resourceVersionId: resource.id,
        billingPolicySnapshotId: snapshot.id,
        status:
          segment.status ??
          (segment.end ? "COMPLETE" : "OPEN"),
        startedAt: segment.start,
        endedAt: segment.end,
        providerEventStartId: `${prefix}-event-${index}`,
        providerEventEndId: segment.end
          ? `${prefix}-event-${index + 1}`
          : null,
        completenessReason: segment.completenessReason,
        idempotencyKey: `${prefix}-usage-${index}`,
      },
    });
    resources.push(resource);
  }
  const rates =
    input.rates ??
    [
      {
        start: input.periodStart,
        end: periodEnd,
        providerRateRial: 800n,
        customerRateRial: 1_000n,
      },
    ];
  const rateCards = [];
  for (const [index, rate] of rates.entries()) {
    rateCards.push(
      await db.rateCardVersion.create({
        data: {
          planId: plan.id,
          provider: "ARVAN",
          providerApiVersion: "v1",
          productKind: "CLOUD_SERVER",
          externalPlanId: `${prefix}-external-plan`,
          regionCode: "ir-thr",
          component: rate.component ?? "COMPUTE",
          resourceUnit: rate.resourceUnit ?? "INSTANCE",
          rateCadence:
            rate.rateCadence === undefined
              ? cadence
              : rate.rateCadence,
          calculationUnit: rate.calculationUnit ?? "HOUR",
          minimumChargeSeconds: 0,
          roundingPolicy: "EXACT",
          prorationSupported: true,
          providerAmount: rate.providerRateRial,
          providerCurrency: "IRR",
          providerAmountUnit: "RIAL",
          normalizedProviderRial: rate.providerRateRial,
          markupBasisPoints: rate.markupBasisPoints ?? 2_500,
          customerRateRial: rate.customerRateRial,
          sourceRevision: `${prefix}-rate-revision-${index}`,
          effectiveFrom: rate.start,
          effectiveTo: rate.end,
          idempotencyKey: `${prefix}-rate-${index}`,
        },
      }),
    );
  }
  return {
    user,
    wallet,
    plan,
    infrastructureOrder,
    instance,
    policy,
    snapshot,
    resources,
    rateCards,
    cadence,
    periodStart: input.periodStart,
    periodEnd,
    serviceStartedAt,
  };
}

async function runFixture(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  workerId = "billing-test-worker",
) {
  return settleClosedBillingPeriod({
    cadence: fixture.cadence,
    periodStart: fixture.periodStart,
    periodEnd: fixture.periodEnd,
    workerId,
    now: new Date("2026-08-01T00:00:00.000Z"),
  });
}

async function invoiceFor(instanceId: string) {
  return db.billingInvoice.findFirstOrThrow({
    where: { cloudInstanceId: instanceId },
    include: {
      lines: { orderBy: { intervalStart: "asc" } },
      outstandingBalance: true,
    },
  });
}

test("usage billing worker is crash-safe, split-aware and wallet-safe", async (t) => {
  await t.test("full day with fixed resources", async () => {
    const fixture = await createFixture({
      suffix: "fixed-day",
      periodStart: utcDay(1),
    });
    await runFixture(fixture);
    const invoice = await invoiceFor(fixture.instance.id);
    assert.equal(invoice.totalAmountRial, 24_000n);
    assert.equal(invoice.status, "PAID");
    assert.equal(invoice.lines.length, 1);
  });

  await t.test("hourly cadence settles an independent UTC hour", async () => {
    const fixture = await createFixture({
      suffix: "fixed-hour",
      periodStart: utcDay(13),
      cadence: BillingCadence.HOURLY,
    });
    await runFixture(fixture);
    const invoice = await invoiceFor(fixture.instance.id);
    assert.equal(invoice.cadence, "HOURLY");
    assert.equal(invoice.totalAmountRial, 1_000n);
    assert.equal(invoice.status, "PAID");
  });

  await t.test("catch-up settles every missed hourly period in chronological batches", async () => {
    const starts = [14, 15, 16].map((hour) =>
      new Date(`2026-06-14T${String(hour).padStart(2, "0")}:00:00.000Z`),
    );
    const fixtures = await Promise.all(
      starts.map((periodStart, index) =>
        createFixture({
          suffix: `catchup-hour-${index}`,
          periodStart,
          cadence: BillingCadence.HOURLY,
        }),
      ),
    );
    const now = new Date("2026-06-14T17:10:00.000Z");
    assert.equal((await getBillingCatchUpStatus(now)).status, "BACKLOG");
    const result = await settleClosedBillingPeriodsCatchUp({
      cadence: BillingCadence.HOURLY,
      workerId: "catchup-hourly",
      now,
      maxPeriods: 3,
    });
    assert.equal(result.runs.length, 3);
    assert.equal(result.failedPeriod, null);
    for (const fixture of fixtures) {
      const invoice = await invoiceFor(fixture.instance.id);
      assert.equal(invoice.status, "PAID");
      assert.equal(
        await db.walletLedgerEntry.count({
          where: {
            walletId: fixture.wallet.id,
            type: "USAGE_SETTLEMENT",
          },
        }),
        1,
      );
    }
  });

  await t.test("catch-up processes missed daily periods independently", async () => {
    const fixtures = await Promise.all(
      [15, 16, 17].map((day) =>
        createFixture({ suffix: `catchup-day-${day}`, periodStart: utcDay(day) }),
      ),
    );
    const result = await settleClosedBillingPeriodsCatchUp({
      cadence: BillingCadence.DAILY,
      workerId: "catchup-daily",
      now: utcDay(19),
      maxPeriods: 3,
    });
    assert.equal(result.runs.length, 3);
    for (const fixture of fixtures) {
      assert.equal((await invoiceFor(fixture.instance.id)).status, "PAID");
    }
  });

  await t.test("restart resumes a bounded catch-up from the next period", async () => {
    const starts = [18, 19, 20].map((hour) =>
      new Date(`2026-06-20T${String(hour).padStart(2, "0")}:00:00.000Z`),
    );
    const fixtures = await Promise.all(
      starts.map((periodStart, index) =>
        createFixture({
          suffix: `catchup-restart-${index}`,
          periodStart,
          cadence: BillingCadence.HOURLY,
        }),
      ),
    );
    const now = new Date("2026-06-20T21:10:00.000Z");
    const first = await settleClosedBillingPeriodsCatchUp({
      cadence: BillingCadence.HOURLY,
      workerId: "catchup-before-restart",
      now,
      maxPeriods: 1,
    });
    assert.equal(first.runs.length, 1);
    const resumed = await settleClosedBillingPeriodsCatchUp({
      cadence: BillingCadence.HOURLY,
      workerId: "catchup-after-restart",
      now,
      maxPeriods: 3,
    });
    assert.equal(resumed.runs.length, 2);
    assert.equal(
      await db.billingInvoice.count({
        where: { cloudInstanceId: { in: fixtures.map((fixture) => fixture.instance.id) } },
      }),
      3,
    );
  });

  await t.test("two workers can run the same catch-up without duplicate debits", async () => {
    const fixtures = await Promise.all(
      [21, 22, 23].map((hour) =>
        createFixture({
          suffix: `catchup-concurrent-${hour}`,
          periodStart: new Date(`2026-06-21T${String(hour).padStart(2, "0")}:00:00.000Z`),
          cadence: BillingCadence.HOURLY,
        }),
      ),
    );
    const input = {
      cadence: BillingCadence.HOURLY,
      now: new Date("2026-06-22T00:10:00.000Z"),
      maxPeriods: 3,
    };
    await Promise.all([
      settleClosedBillingPeriodsCatchUp({ ...input, workerId: "catchup-a" }),
      settleClosedBillingPeriodsCatchUp({ ...input, workerId: "catchup-b" }),
    ]);
    for (const fixture of fixtures) {
      assert.equal(
        await db.walletLedgerEntry.count({
          where: { walletId: fixture.wallet.id, type: "USAGE_SETTLEMENT" },
        }),
        1,
      );
    }
  });

  await t.test("a failed period is retried without a double debit", async () => {
    const fixture = await createFixture({
      suffix: "catchup-failed-retry",
      periodStart: new Date("2026-06-22T10:00:00.000Z"),
      cadence: BillingCadence.HOURLY,
    });
    await db.billingRun.create({
      data: {
        cadence: BillingCadence.HOURLY,
        periodStart: fixture.periodStart,
        periodEnd: fixture.periodEnd,
        status: "FAILED",
        workerId: "crashed-worker",
        failureCode: "simulated_crash",
        finishedAt: fixture.periodEnd,
        idempotencyKey: `billing-run:HOURLY:${fixture.periodStart.toISOString()}:${fixture.periodEnd.toISOString()}`,
      },
    });
    const result = await settleClosedBillingPeriodsCatchUp({
      cadence: BillingCadence.HOURLY,
      workerId: "retry-worker",
      now: new Date("2026-06-22T11:10:00.000Z"),
      maxPeriods: 1,
    });
    assert.equal(result.runs.length, 1);
    assert.equal((await invoiceFor(fixture.instance.id)).status, "PAID");
    assert.equal(
      await db.walletLedgerEntry.count({
        where: { walletId: fixture.wallet.id, type: "USAGE_SETTLEMENT" },
      }),
      1,
    );
  });

  await t.test("a service beginning mid-period receives only its covered usage", async () => {
    const periodStart = new Date("2026-06-23T12:00:00.000Z");
    const fixture = await createFixture({
      suffix: "catchup-mid-period-service",
      periodStart,
      cadence: BillingCadence.HOURLY,
      serviceStartedAt: new Date(periodStart.getTime() + 30 * 60 * 1_000),
    });
    await settleClosedBillingPeriodsCatchUp({
      cadence: BillingCadence.HOURLY,
      workerId: "mid-period-worker",
      now: new Date("2026-06-23T13:10:00.000Z"),
      maxPeriods: 1,
    });
    const invoice = await invoiceFor(fixture.instance.id);
    assert.equal(invoice.totalAmountRial, 500n);
    assert.equal(invoice.status, "PAID");
  });

  await t.test("a partial review does not hide later closed periods", async () => {
    const incomplete = await createFixture({
      suffix: "catchup-partial-review",
      periodStart: new Date("2026-06-24T08:00:00.000Z"),
      cadence: BillingCadence.HOURLY,
      segments: [
        {
          start: new Date("2026-06-24T08:00:00.000Z"),
          end: new Date("2026-06-24T09:00:00.000Z"),
          status: "INCOMPLETE",
          completenessReason: "provider_event_missing",
        },
      ],
    });
    const later = await createFixture({
      suffix: "catchup-after-partial",
      periodStart: new Date("2026-06-24T09:00:00.000Z"),
      cadence: BillingCadence.HOURLY,
    });
    const result = await settleClosedBillingPeriodsCatchUp({
      cadence: BillingCadence.HOURLY,
      workerId: "partial-continues-worker",
      now: new Date("2026-06-24T10:10:00.000Z"),
      maxPeriods: 2,
    });
    assert.equal(result.runs.length, 2);
    assert.equal((await invoiceFor(incomplete.instance.id)).status, "UNDER_REVIEW");
    assert.equal((await invoiceFor(later.instance.id)).status, "PAID");
  });

  await t.test(
    "generic duration rate settles a daily period without inventing a daily contract",
    async () => {
      const fixture = await createFixture({
        suffix: "generic-daily-rate",
        periodStart: utcDay(14),
        rates: [
          {
            start: utcDay(14),
            end: utcDay(15),
            providerRateRial: 800n,
            customerRateRial: 1_000n,
            rateCadence: null,
          },
        ],
      });
      await runFixture(fixture);
      const invoice = await invoiceFor(fixture.instance.id);
      assert.equal(invoice.totalAmountRial, 24_000n);
      assert.equal(fixture.rateCards[0]!.rateCadence, null);
    },
  );

  await t.test("mid-day CPU/RAM resource versions are split", async () => {
    const start = utcDay(2);
    const middle = addHours(start, 12);
    const fixture = await createFixture({
      suffix: "midday-resize",
      periodStart: start,
      segments: [
        {
          start,
          end: middle,
          vcpu: 2,
          ramMb: 2_048,
        },
        {
          start: middle,
          end: addHours(start, 24),
          vcpu: 4,
          ramMb: 4_096,
        },
      ],
      rates: [
        {
          start,
          end: addHours(start, 24),
          providerRateRial: 80n,
          customerRateRial: 100n,
          component: "COMPUTE",
          resourceUnit: "VCPU",
        },
      ],
    });
    await runFixture(fixture);
    const invoice = await invoiceFor(fixture.instance.id);
    assert.equal(invoice.totalAmountRial, 7_200n);
    assert.equal(invoice.lines.length, 2);
    assert.notEqual(
      invoice.lines[0]!.resourceVersionId,
      invoice.lines[1]!.resourceVersionId,
    );
  });

  await t.test("rate and markup changes affect future slices only", async () => {
    const start = utcDay(3);
    const middle = addHours(start, 12);
    const fixture = await createFixture({
      suffix: "rate-change",
      periodStart: start,
      rates: [
        {
          start,
          end: middle,
          providerRateRial: 800n,
          customerRateRial: 1_000n,
          markupBasisPoints: 2_500,
        },
        {
          start: middle,
          end: addHours(start, 24),
          providerRateRial: 800n,
          customerRateRial: 1_200n,
          markupBasisPoints: 5_000,
        },
      ],
    });
    await runFixture(fixture);
    const invoice = await invoiceFor(fixture.instance.id);
    assert.equal(invoice.totalAmountRial, 26_400n);
    assert.deepEqual(
      invoice.lines.map((line) => line.markupBasisPoints),
      [2_500, 5_000],
    );
  });

  await t.test("worker retry never double-debits", async () => {
    const fixture = await createFixture({
      suffix: "retry-safe",
      periodStart: utcDay(4),
    });
    await runFixture(fixture, "worker-first");
    await runFixture(fixture, "worker-retry");
    assert.equal(
      await db.walletLedgerEntry.count({
        where: {
          walletId: fixture.wallet.id,
          type: "USAGE_SETTLEMENT",
        },
      }),
      1,
    );
  });

  await t.test("two concurrent workers never double-debit", async () => {
    const fixture = await createFixture({
      suffix: "concurrent-safe",
      periodStart: utcDay(5),
    });
    await Promise.all([
      runFixture(fixture, "worker-a"),
      runFixture(fixture, "worker-b"),
    ]);
    assert.equal(
      await db.walletLedgerEntry.count({
        where: {
          walletId: fixture.wallet.id,
          type: "USAGE_SETTLEMENT",
        },
      }),
      1,
    );
  });

  await t.test("sufficient wallet fully pays invoice", async () => {
    const fixture = await createFixture({
      suffix: "fully-paid",
      periodStart: utcDay(6),
      walletBalance: 30_000n,
    });
    await runFixture(fixture);
    const invoice = await invoiceFor(fixture.instance.id);
    const wallet = await db.wallet.findUniqueOrThrow({
      where: { id: fixture.wallet.id },
    });
    assert.equal(invoice.status, "PAID");
    assert.equal(invoice.paidAmountRial, 24_000n);
    assert.equal(wallet.availableBalance, 6_000n);
  });

  await t.test("insufficient wallet records partial and outstanding", async () => {
    const fixture = await createFixture({
      suffix: "partial",
      periodStart: utcDay(7),
      walletBalance: 10_000n,
      segments: [
        {
          start: utcDay(7),
          end: null,
          status: "OPEN",
        },
      ],
    });
    await runFixture(fixture);
    const invoice = await invoiceFor(fixture.instance.id);
    const instance = await db.cloudInstance.findUniqueOrThrow({
      where: { id: fixture.instance.id },
    });
    assert.equal(invoice.status, "PARTIALLY_PAID");
    assert.equal(invoice.totalAmountRial, 24_000n);
    assert.equal(invoice.paidAmountRial, 10_000n);
    assert.equal(invoice.outstandingAmountRial, 14_000n);
    assert.equal(
      invoice.outstandingBalance?.remainingAmountRial,
      14_000n,
    );
    assert.equal(instance.status, "ACTIVE");
    assert.equal(instance.terminatedAt, null);
    await enqueueExpiredDunningForSuspensionReview(
      addHours(fixture.periodEnd, 72),
    );
    const suspensionCase = await db.dunningCase.findFirstOrThrow({
      where: {
        cloudInstanceId: fixture.instance.id,
        type: "SUSPENSION_REVIEW",
      },
    });
    assert.equal(
      await db.resourceChangeRequest.count({
        where: { cloudInstanceId: fixture.instance.id },
      }),
      0,
    );
    const suspensionAdmin = await db.user.create({
      data: {
        mobile: "09600000001",
        role: "ADMIN",
      },
    });
    const suspension = await approveControlledSuspensionRequest({
      dunningCaseId: suspensionCase.id,
      actorUserId: suspensionAdmin.id,
      idempotencyKey: `${runId}:suspension:approved`,
      reason: "تأیید کنترل‌شده تعلیق پس از Grace",
    });
    assert.equal(suspension.providerMutationExecuted, false);
    const queuedChange =
      await db.resourceChangeRequest.findFirstOrThrow({
        where: { cloudInstanceId: fixture.instance.id },
      });
    assert.equal(queuedChange.status, "APPROVED");
    assert.equal(instance.status, "ACTIVE");
  });

  await t.test("stopped server keeps disk and IP billable", async () => {
    const start = utcDay(8);
    const fixture = await createFixture({
      suffix: "stopped-storage",
      periodStart: start,
      segments: [
        {
          start,
          end: addHours(start, 24),
          state: "STOPPED",
          diskGb: 40,
          ipv4Count: 1,
        },
      ],
      rates: [
        {
          start,
          end: addHours(start, 24),
          providerRateRial: 80n,
          customerRateRial: 100n,
          component: "COMPUTE",
          resourceUnit: "INSTANCE",
        },
        {
          start,
          end: addHours(start, 24),
          providerRateRial: 8n,
          customerRateRial: 10n,
          component: "DISK",
          resourceUnit: "GB_DISK",
        },
        {
          start,
          end: addHours(start, 24),
          providerRateRial: 40n,
          customerRateRial: 50n,
          component: "IP",
          resourceUnit: "IP",
        },
      ],
    });
    await runFixture(fixture);
    const invoice = await invoiceFor(fixture.instance.id);
    assert.equal(
      invoice.lines.some((line) => line.component === "COMPUTE"),
      false,
    );
    assert.deepEqual(
      invoice.lines.map((line) => line.component).sort(),
      ["DISK", "IP"],
    );
    assert.equal(invoice.totalAmountRial, 10_800n);
  });

  await t.test("provider-confirmed termination stops compute mid-period", async () => {
    const start = utcDay(9);
    const middle = addHours(start, 12);
    const fixture = await createFixture({
      suffix: "terminated-midday",
      periodStart: start,
      segments: [
        {
          start,
          end: middle,
          state: "ACTIVE",
          diskGb: 10,
          ipv4Count: 0,
        },
        {
          start: middle,
          end: addHours(start, 24),
          state: "TERMINATED",
          diskGb: 10,
          ipv4Count: 0,
        },
      ],
      rates: [
        {
          start,
          end: addHours(start, 24),
          providerRateRial: 800n,
          customerRateRial: 1_000n,
          component: "COMPUTE",
          resourceUnit: "INSTANCE",
        },
        {
          start,
          end: addHours(start, 24),
          providerRateRial: 8n,
          customerRateRial: 10n,
          component: "DISK",
          resourceUnit: "GB_DISK",
        },
      ],
    });
    await runFixture(fixture);
    const invoice = await invoiceFor(fixture.instance.id);
    const computeLines = invoice.lines.filter(
      (line) => line.component === "COMPUTE",
    );
    assert.equal(computeLines.length, 1);
    assert.equal(computeLines[0]!.intervalEnd.getTime(), middle.getTime());
    assert.equal(invoice.totalAmountRial, 14_400n);
  });

  await t.test("incomplete usage enters review without fabricated amount", async () => {
    const start = utcDay(10);
    const fixture = await createFixture({
      suffix: "incomplete",
      periodStart: start,
      segments: [
        {
          start,
          end: addHours(start, 24),
          status: "INCOMPLETE",
          completenessReason: "provider_event_missing",
        },
      ],
    });
    const run = await runFixture(fixture);
    const invoice = await invoiceFor(fixture.instance.id);
    assert.equal(run.status, "PARTIAL");
    assert.equal(invoice.status, "UNDER_REVIEW");
    assert.equal(invoice.totalAmountRial, 0n);
    assert.equal(invoice.lines.length, 0);
    assert.equal(
      await db.walletLedgerEntry.count({
        where: {
          walletId: fixture.wallet.id,
          type: "USAGE_SETTLEMENT",
        },
      }),
      0,
    );
  });

  await t.test("provider adjustment replay creates one ledger entry", async () => {
    const fixture = await createFixture({
      suffix: "adjustment",
      periodStart: utcDay(11),
      walletBalance: 100_000n,
    });
    await runFixture(fixture);
    const invoice = await invoiceFor(fixture.instance.id);
    const admin = await db.user.create({
      data: {
        mobile: `097${String(fixtureCounter).padStart(8, "0")}`,
        role: "ADMIN",
      },
    });
    const reconciliation = await db.billingReconciliation.create({
      data: {
        provider: "ARVAN",
        kind: "PROVIDER_INVOICE",
        status: "MISMATCH",
        cloudInstanceId: fixture.instance.id,
        billingInvoiceId: invoice.id,
        internalAmountRial: invoice.totalAmountRial,
        normalizedProviderRial: invoice.totalAmountRial + 500n,
        differenceRial: 500n,
        reason: "controlled provider invoice difference",
        idempotencyKey: `${runId}:adjustment-reconciliation`,
      },
    });
    const idempotencyKey = `${runId}:adjustment:apply`;
    const first = await applyProviderBillingAdjustment({
      billingReconciliationId: reconciliation.id,
      amountRial: 500n,
      reason: "اعمال اختلاف صورتحساب Provider",
      actorUserId: admin.id,
      idempotencyKey,
    });
    const replay = await applyProviderBillingAdjustment({
      billingReconciliationId: reconciliation.id,
      amountRial: 500n,
      reason: "اعمال اختلاف صورتحساب Provider",
      actorUserId: admin.id,
      idempotencyKey,
    });
    assert.deepEqual(replay, first);
    assert.equal(
      await db.walletLedgerEntry.count({
        where: {
          referenceType: "billing_adjustment",
          type: "BILLING_ADJUSTMENT",
        },
      }),
      1,
    );
  });

  await t.test("upgrade needs incremental buffer while downgrade remains allowed", () => {
    const policy = {
      availability: "HOURLY_AND_DAILY" as const,
      defaultCadence: "HOURLY" as const,
      displayMode: "BOTH" as const,
      hourlyMinimumCreditHours: 24,
      dailyMinimumCreditDays: 2,
      hourlyGracePeriods: 6,
      dailyGracePeriods: 2,
      lowBalanceThresholdPeriods: 3,
    };
    const required = calculateResourceChangeBufferRial({
      policy,
      cadence: "HOURLY",
      currentHourlyEstimateRial: 1_000n,
      targetHourlyEstimateRial: 1_500n,
      currentDailyEstimateRial: 24_000n,
      targetDailyEstimateRial: 36_000n,
    });
    assert.equal(required, 12_000n);
    assert.deepEqual(
      evaluateResourceChangeCredit({
        availableBalanceRial: 10_000n,
        requiredIncrementalBufferRial: required,
        isDowngrade: false,
      }),
      { allowed: false, shortfallRial: 2_000n },
    );
    assert.deepEqual(
      evaluateResourceChangeCredit({
        availableBalanceRial: 0n,
        requiredIncrementalBufferRial: 0n,
        isDowngrade: true,
      }),
      { allowed: true, shortfallRial: 0n },
    );
  });

  await t.test("resource version changes only at provider-confirmed time", async () => {
    const start = utcDay(12);
    const fixture = await createFixture({
      suffix: "provider-confirmed-timeline",
      periodStart: start,
      segments: [{ start, end: null, status: "OPEN" }],
    });
    const confirmedAt = addHours(start, 12);
    const change = await db.resourceChangeRequest.create({
      data: {
        cloudInstanceId: fixture.instance.id,
        planId: fixture.plan.id,
        requestedById: fixture.user.id,
        sourceResourceVersionId: fixture.resources[0]!.id,
        requestedResources: { vcpu: 4, ramMb: 8_192 },
        estimateSnapshot: { controlled: true },
        status: "PROVIDER_MUTATION_PENDING",
        idempotencyKey: `${runId}:provider-change-request`,
      },
    });
    const next = await recordProviderConfirmedResourceVersion({
      cloudInstanceId: fixture.instance.id,
      planId: fixture.plan.id,
      state: "ACTIVE",
      resources: {
        vcpu: 4,
        ramMb: 8_192,
        diskGb: 0,
        ipv4Count: 0,
        backupEnabled: false,
        snapshotCount: 0,
      },
      providerEventId: `${runId}:provider-confirmed-event`,
      providerConfirmedAt: confirmedAt,
      idempotencyKey: `${runId}:provider-confirmed-version`,
      sourceChangeRequestId: change.id,
    });
    const previous = await db.resourceVersion.findUniqueOrThrow({
      where: { id: fixture.resources[0]!.id },
    });
    const appliedChange =
      await db.resourceChangeRequest.findUniqueOrThrow({
        where: { id: change.id },
      });
    assert.equal(previous.effectiveTo?.getTime(), confirmedAt.getTime());
    assert.equal(next.effectiveFrom.getTime(), confirmedAt.getTime());
    assert.equal(appliedChange.status, "APPLIED");
  });
});
