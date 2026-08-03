import {
  BillingCadence,
  BillingInvoiceStatus,
  BillingRunStatus,
  Prisma,
  type BillingComponentType,
} from "@prisma/client";

import {
  assertCoveredByRanges,
  calculateBillingLineAmount,
  requiredBillableComponents,
} from "@/lib/billing/calculation";
import { latestClosedPeriodUtc } from "@/lib/billing/policy";
import { prisma } from "@/lib/db";

type BillingPeriod = {
  cadence: BillingCadence;
  periodStart: Date;
  periodEnd: Date;
  workerId: string;
  now?: Date;
};

type InvoiceReview = {
  kind: "RATE_CARD" | "RESOURCE_STATE";
  reason: string;
  evidence: Prisma.InputJsonObject;
};

const SETTLED_INVOICE_STATUSES = new Set<BillingInvoiceStatus>([
  BillingInvoiceStatus.PAID,
  BillingInvoiceStatus.PARTIALLY_PAID,
  BillingInvoiceStatus.UNPAID,
]);

function maximumDate(left: Date, right: Date) {
  return left > right ? left : right;
}

function minimumDate(left: Date, right: Date) {
  return left < right ? left : right;
}

function periodKey(cadence: BillingCadence, start: Date, end: Date) {
  return `${cadence}:${start.toISOString()}:${end.toISOString()}`;
}

async function retrySerializableBilling<T>(
  operation: () => Promise<T>,
  maximumAttempts = 4,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";
      if (!retryable || attempt === maximumAttempts) throw error;
    }
  }
  throw lastError;
}

function validatePeriod(input: BillingPeriod) {
  const now = input.now ?? new Date();
  if (
    input.periodStart.getTime() >= input.periodEnd.getTime() ||
    input.periodEnd.getTime() > now.getTime()
  ) {
    throw new Error("billing_period_not_closed");
  }
  const expected =
    input.cadence === BillingCadence.HOURLY
      ? 60 * 60 * 1_000
      : 24 * 60 * 60 * 1_000;
  if (
    input.periodEnd.getTime() - input.periodStart.getTime() !== expected ||
    input.periodStart.getUTCMinutes() !== 0 ||
    input.periodStart.getUTCSeconds() !== 0 ||
    input.periodStart.getUTCMilliseconds() !== 0 ||
    (input.cadence === BillingCadence.DAILY &&
      input.periodStart.getUTCHours() !== 0)
  ) {
    throw new Error("billing_period_not_utc_aligned");
  }
}

function intersection(
  start: Date,
  end: Date,
  candidateStart: Date,
  candidateEnd: Date | null,
) {
  const intervalStart = maximumDate(start, candidateStart);
  const intervalEnd = candidateEnd
    ? minimumDate(end, candidateEnd)
    : end;
  return intervalStart < intervalEnd
    ? { start: intervalStart, end: intervalEnd }
    : null;
}

function validateIntervalCoverage(
  targetStart: Date,
  targetEnd: Date,
  ranges: Array<{ start: Date; end: Date }>,
) {
  const sorted = [...ranges].sort(
    (left, right) => left.start.getTime() - right.start.getTime(),
  );
  let cursor = targetStart.getTime();
  for (const range of sorted) {
    if (range.start.getTime() < cursor) return false;
    if (range.start.getTime() > cursor) return false;
    cursor = range.end.getTime();
  }
  return cursor === targetEnd.getTime();
}

function lineDescription(
  component: BillingComponentType,
  resourceUnit: string,
) {
  return `${component} usage (${resourceUnit})`;
}

async function markInvoiceForReview(
  tx: Prisma.TransactionClient,
  input: {
    runId: string;
    snapshotId: string;
    userId: string;
    walletId: string;
    cloudInstanceId: string;
    infrastructureOrderId: string;
    provider: "ARVAN" | "PARSPACK";
    cadence: BillingCadence;
    periodStart: Date;
    periodEnd: Date;
    review: InvoiceReview;
  },
) {
  const invoice = await tx.billingInvoice.upsert({
    where: {
      cloudInstanceId_periodStart_periodEnd_billingPolicySnapshotId: {
        cloudInstanceId: input.cloudInstanceId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        billingPolicySnapshotId: input.snapshotId,
      },
    },
    create: {
      billingRunId: input.runId,
      userId: input.userId,
      walletId: input.walletId,
      cloudInstanceId: input.cloudInstanceId,
      billingPolicySnapshotId: input.snapshotId,
      cadence: input.cadence,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: BillingInvoiceStatus.UNDER_REVIEW,
      reviewReason: input.review.reason,
      idempotencyKey: `billing-invoice:${input.cloudInstanceId}:${input.snapshotId}:${periodKey(input.cadence, input.periodStart, input.periodEnd)}`,
      finalizedAt: new Date(),
    },
    update: {
      billingRunId: input.runId,
      status: BillingInvoiceStatus.UNDER_REVIEW,
      reviewReason: input.review.reason,
      finalizedAt: new Date(),
    },
  });
  await tx.billingReconciliation.upsert({
    where: {
      idempotencyKey: `billing-review:${invoice.id}:${input.review.kind}`,
    },
    create: {
      provider: input.provider,
      kind: input.review.kind,
      status: "REVIEW",
      cloudInstanceId: input.cloudInstanceId,
      billingInvoiceId: invoice.id,
      reason: input.review.reason,
      evidence: input.review.evidence,
      idempotencyKey: `billing-review:${invoice.id}:${input.review.kind}`,
    },
    update: {
      status: "REVIEW",
      reason: input.review.reason,
      evidence: input.review.evidence,
      resolvedAt: null,
    },
  });
  const existingNotice = await tx.adminNotification.findFirst({
    where: {
      infrastructureOrderId: input.infrastructureOrderId,
      type: "PROVIDER_BILLING_RECONCILIATION",
      status: "UNREAD",
      message: { contains: invoice.id },
    },
  });
  if (!existingNotice) {
    await tx.adminNotification.create({
      data: {
        type: "PROVIDER_BILLING_RECONCILIATION",
        infrastructureOrderId: input.infrastructureOrderId,
        title: "صورتحساب مصرف نیازمند تطبیق است",
        message: `Invoice ${invoice.id}: ${input.review.reason}`,
      },
    });
  }
  return invoice;
}

async function processSnapshot(
  tx: Prisma.TransactionClient,
  input: {
    runId: string;
    snapshot: Awaited<
      ReturnType<typeof loadSnapshots>
    >[number];
    cadence: BillingCadence;
    periodStart: Date;
    periodEnd: Date;
    now: Date;
  },
) {
  const { snapshot } = input;
  const instance = snapshot.cloudInstance;
  const wallet =
    instance.user.wallet ??
    (await tx.wallet.create({
      data: { userId: instance.userId, currency: "IRR" },
    }));
  const targetStart = maximumDate(
    input.periodStart,
    snapshot.effectiveFrom,
  );
  const targetEnd = snapshot.effectiveTo
    ? minimumDate(input.periodEnd, snapshot.effectiveTo)
    : input.periodEnd;
  if (targetStart >= targetEnd) return { invoiced: false, review: false };

  const existing = await tx.billingInvoice.findUnique({
    where: {
      cloudInstanceId_periodStart_periodEnd_billingPolicySnapshotId: {
        cloudInstanceId: instance.id,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        billingPolicySnapshotId: snapshot.id,
      },
    },
  });
  if (
    existing &&
    SETTLED_INVOICE_STATUSES.has(existing.status)
  ) {
    return { invoiced: true, review: false };
  }

  const intervals = await tx.usageInterval.findMany({
    where: {
      cloudInstanceId: instance.id,
      billingPolicySnapshotId: snapshot.id,
      startedAt: { lt: targetEnd },
      OR: [{ endedAt: null }, { endedAt: { gt: targetStart } }],
    },
    orderBy: { startedAt: "asc" },
    include: { resourceVersion: true },
  });
  const incomplete = intervals.find(
    (interval) =>
      interval.status === "INCOMPLETE" || interval.status === "REVIEW",
  );
  if (incomplete) {
    await markInvoiceForReview(tx, {
      runId: input.runId,
      snapshotId: snapshot.id,
      userId: instance.userId,
      walletId: wallet.id,
      cloudInstanceId: instance.id,
      infrastructureOrderId: instance.infrastructureOrderId,
      provider: instance.provider,
      cadence: input.cadence,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      review: {
        kind: "RESOURCE_STATE",
        reason: incomplete.completenessReason ?? "usage_interval_incomplete",
        evidence: {
          usageIntervalId: incomplete.id,
          fabricatedAmount: false,
        },
      },
    });
    return { invoiced: true, review: true };
  }

  const boundedIntervals = intervals
    .map((interval) => {
      const usage = intersection(
        targetStart,
        targetEnd,
        interval.startedAt,
        interval.endedAt,
      );
      if (!usage) return null;
      const resource = intersection(
        usage.start,
        usage.end,
        interval.resourceVersion.effectiveFrom,
        interval.resourceVersion.effectiveTo,
      );
      return resource
        ? { interval, start: resource.start, end: resource.end }
        : null;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (
    boundedIntervals.length === 0 ||
    !validateIntervalCoverage(
      targetStart,
      targetEnd,
      boundedIntervals.map((item) => ({
        start: item.start,
        end: item.end,
      })),
    )
  ) {
    await markInvoiceForReview(tx, {
      runId: input.runId,
      snapshotId: snapshot.id,
      userId: instance.userId,
      walletId: wallet.id,
      cloudInstanceId: instance.id,
      infrastructureOrderId: instance.infrastructureOrderId,
      provider: instance.provider,
      cadence: input.cadence,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      review: {
        kind: "RESOURCE_STATE",
        reason: "usage_timeline_has_gap_or_overlap",
        evidence: {
          intervalCount: boundedIntervals.length,
          fabricatedAmount: false,
        },
      },
    });
    return { invoiced: true, review: true };
  }

  const lineDrafts: Array<{
    usageIntervalId: string;
    resourceVersionId: string;
    rateCardVersionId: string;
    component: BillingComponentType;
    intervalStart: Date;
    intervalEnd: Date;
    quantityNumerator: bigint;
    quantityDenominator: bigint;
    providerCostRial: bigint;
    markupBasisPoints: number;
    markupAmountRial: bigint;
    amountRial: bigint;
    description: string;
    metadata: Prisma.InputJsonObject;
    idempotencyKey: string;
  }> = [];

  for (const usage of boundedIntervals) {
    const resource = usage.interval.resourceVersion;
    const components = requiredBillableComponents({
      resource,
      stopStateComponentPolicy: snapshot.stopStateComponentPolicy,
    });
    if (components.length === 0) continue;
    const rates = await tx.rateCardVersion.findMany({
      where: {
        planId: resource.planId,
        provider: resource.provider,
        productKind: "CLOUD_SERVER",
        component: { in: components },
        rateCadence: input.cadence,
        effectiveFrom: { lt: usage.end },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: usage.start } }],
      },
      orderBy: { effectiveFrom: "asc" },
    });
    const boundaries = new Set<number>([
      usage.start.getTime(),
      usage.end.getTime(),
    ]);
    for (const rate of rates) {
      if (rate.effectiveFrom > usage.start && rate.effectiveFrom < usage.end) {
        boundaries.add(rate.effectiveFrom.getTime());
      }
      if (
        rate.effectiveTo &&
        rate.effectiveTo > usage.start &&
        rate.effectiveTo < usage.end
      ) {
        boundaries.add(rate.effectiveTo.getTime());
      }
    }
    const orderedBoundaries = [...boundaries].sort(
      (left, right) => left - right,
    );
    for (
      let boundaryIndex = 0;
      boundaryIndex < orderedBoundaries.length - 1;
      boundaryIndex += 1
    ) {
      const sliceStart = new Date(orderedBoundaries[boundaryIndex]!);
      const sliceEnd = new Date(orderedBoundaries[boundaryIndex + 1]!);
      const activeRates = rates.filter(
        (rate) =>
          rate.effectiveFrom <= sliceStart &&
          (!rate.effectiveTo || rate.effectiveTo >= sliceEnd),
      );
      const missingComponent = components.find(
        (component) =>
          !activeRates.some((rate) => rate.component === component),
      );
      const duplicateUnit = activeRates.find((rate, index) =>
        activeRates.some(
          (candidate, candidateIndex) =>
            candidateIndex !== index &&
            candidate.component === rate.component &&
            candidate.resourceUnit === rate.resourceUnit,
        ),
      );
      if (missingComponent || duplicateUnit) {
        await markInvoiceForReview(tx, {
          runId: input.runId,
          snapshotId: snapshot.id,
          userId: instance.userId,
          walletId: wallet.id,
          cloudInstanceId: instance.id,
          infrastructureOrderId: instance.infrastructureOrderId,
          provider: instance.provider,
          cadence: input.cadence,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          review: {
            kind: "RATE_CARD",
            reason: missingComponent
              ? `missing_rate_card:${missingComponent}`
              : `overlapping_rate_card:${duplicateUnit!.component}:${duplicateUnit!.resourceUnit}`,
            evidence: {
              planId: resource.planId,
              resourceVersionId: resource.id,
              intervalStart: sliceStart.toISOString(),
              intervalEnd: sliceEnd.toISOString(),
              fabricatedAmount: false,
            },
          },
        });
        return { invoiced: true, review: true };
      }

      for (const rate of activeRates) {
        if (
          !rate.providerCurrency.trim() ||
          !rate.providerAmountUnit.trim()
        ) {
          await markInvoiceForReview(tx, {
            runId: input.runId,
            snapshotId: snapshot.id,
            userId: instance.userId,
            walletId: wallet.id,
            cloudInstanceId: instance.id,
            infrastructureOrderId: instance.infrastructureOrderId,
            provider: instance.provider,
            cadence: input.cadence,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            review: {
              kind: "RATE_CARD",
              reason: "provider_money_unit_not_explicit",
              evidence: {
                rateCardVersionId: rate.id,
                fabricatedAmount: false,
              },
            },
          });
          return { invoiced: true, review: true };
        }
        const calculated = calculateBillingLineAmount({
          intervalStart: sliceStart,
          intervalEnd: sliceEnd,
          resource,
          rate,
        });
        if (calculated.quantityNumerator === 0n) continue;
        lineDrafts.push({
          usageIntervalId: usage.interval.id,
          resourceVersionId: resource.id,
          rateCardVersionId: rate.id,
          component: rate.component,
          intervalStart: sliceStart,
          intervalEnd: sliceEnd,
          quantityNumerator: calculated.quantityNumerator,
          quantityDenominator: calculated.quantityDenominator,
          providerCostRial: calculated.providerCostRial,
          markupBasisPoints: rate.markupBasisPoints,
          markupAmountRial: calculated.markupAmountRial,
          amountRial: calculated.amountRial,
          description: lineDescription(
            rate.component,
            rate.resourceUnit,
          ),
          metadata: {
            resourceUnit: rate.resourceUnit,
            providerCurrency: rate.providerCurrency,
            providerAmountUnit: rate.providerAmountUnit,
            rateSourceRevision: rate.sourceRevision,
          },
          idempotencyKey: `billing-line:${instance.id}:${snapshot.id}:${resource.id}:${rate.id}:${sliceStart.toISOString()}:${sliceEnd.toISOString()}`,
        });
      }
    }
  }

  const invoice = await tx.billingInvoice.upsert({
    where: {
      cloudInstanceId_periodStart_periodEnd_billingPolicySnapshotId: {
        cloudInstanceId: instance.id,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        billingPolicySnapshotId: snapshot.id,
      },
    },
    create: {
      billingRunId: input.runId,
      userId: instance.userId,
      walletId: wallet.id,
      cloudInstanceId: instance.id,
      billingPolicySnapshotId: snapshot.id,
      cadence: input.cadence,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      idempotencyKey: `billing-invoice:${instance.id}:${snapshot.id}:${periodKey(input.cadence, input.periodStart, input.periodEnd)}`,
    },
    update: {
      billingRunId: input.runId,
      status: BillingInvoiceStatus.CALCULATING,
      reviewReason: null,
    },
  });
  await tx.billingLine.deleteMany({
    where: { billingInvoiceId: invoice.id },
  });
  for (const line of lineDrafts) {
    await tx.billingLine.create({
      data: { billingInvoiceId: invoice.id, ...line },
    });
  }
  const totalAmountRial = lineDrafts.reduce(
    (total, line) => total + line.amountRial,
    0n,
  );
  await tx.$queryRaw`SELECT id FROM "Wallet" WHERE id = ${wallet.id} FOR UPDATE`;
  const lockedWallet = await tx.wallet.findUniqueOrThrow({
    where: { id: wallet.id },
  });
  const paidAmountRial =
    lockedWallet.availableBalance < totalAmountRial
      ? lockedWallet.availableBalance
      : totalAmountRial;
  const outstandingAmountRial = totalAmountRial - paidAmountRial;
  let balanceAfter = lockedWallet.availableBalance;
  if (paidAmountRial > 0n) {
    const updatedWallet = await tx.wallet.update({
      where: { id: wallet.id },
      data: { availableBalance: { decrement: paidAmountRial } },
    });
    balanceAfter = updatedWallet.availableBalance;
    await tx.walletLedgerEntry.create({
      data: {
        walletId: wallet.id,
        direction: "DEBIT",
        type: "USAGE_SETTLEMENT",
        amount: paidAmountRial,
        status: "COMPLETED",
        referenceType: "billing_invoice",
        referenceId: invoice.id,
        idempotencyKey: `billing-invoice-debit:${invoice.id}`,
        balanceAfter,
        description: `${input.cadence} cloud usage settlement`,
        metadata: {
          cloudInstanceId: instance.id,
          periodStart: input.periodStart.toISOString(),
          periodEnd: input.periodEnd.toISOString(),
        },
      },
    });
  }
  const status =
    outstandingAmountRial === 0n
      ? BillingInvoiceStatus.PAID
      : paidAmountRial > 0n
        ? BillingInvoiceStatus.PARTIALLY_PAID
        : BillingInvoiceStatus.UNPAID;
  await tx.billingInvoice.update({
    where: { id: invoice.id },
    data: {
      status,
      totalAmountRial,
      paidAmountRial,
      outstandingAmountRial,
      finalizedAt: input.now,
      settledAt: paidAmountRial > 0n ? input.now : null,
      reviewReason: null,
    },
  });

  if (outstandingAmountRial > 0n) {
    await tx.outstandingBalance.upsert({
      where: { billingInvoiceId: invoice.id },
      create: {
        billingInvoiceId: invoice.id,
        userId: instance.userId,
        originalAmountRial: totalAmountRial,
        paidAmountRial,
        remainingAmountRial: outstandingAmountRial,
        status:
          paidAmountRial > 0n ? "PARTIALLY_PAID" : "OPEN",
        dueAt: new Date(
          input.periodEnd.getTime() +
            snapshot.gracePeriods *
              (input.cadence === BillingCadence.HOURLY
                ? 60 * 60 * 1_000
                : 24 * 60 * 60 * 1_000),
        ),
      },
      update: {
        originalAmountRial: totalAmountRial,
        paidAmountRial,
        remainingAmountRial: outstandingAmountRial,
        status:
          paidAmountRial > 0n ? "PARTIALLY_PAID" : "OPEN",
      },
    });
    await tx.dunningCase.upsert({
      where: {
        idempotencyKey: `dunning:outstanding:${instance.id}`,
      },
      create: {
        cloudInstanceId: instance.id,
        billingInvoiceId: invoice.id,
        type: "OUTSTANDING_INVOICE",
        status: "NOTIFIED",
        thresholdRial: totalAmountRial,
        observedBalanceRial: balanceAfter,
        graceEndsAt: new Date(
          input.periodEnd.getTime() +
            snapshot.gracePeriods *
              (input.cadence === BillingCadence.HOURLY
                ? 60 * 60 * 1_000
                : 24 * 60 * 60 * 1_000),
        ),
        notificationSentAt: input.now,
        idempotencyKey: `dunning:outstanding:${instance.id}`,
      },
      update: {
        observedBalanceRial: balanceAfter,
        status: "NOTIFIED",
      },
    });
    await tx.adminNotification.create({
      data: {
        type: "OUTSTANDING_INVOICE",
        infrastructureOrderId: instance.infrastructureOrderId,
        title: "صورتحساب مصرف تسویه‌نشده",
        message: `Invoice ${invoice.id} has ${outstandingAmountRial.toString()} IRR outstanding; no automatic suspend or delete was performed.`,
      },
    });
  }

  const lowBalanceThreshold =
    totalAmountRial * BigInt(snapshot.lowBalanceThresholdPeriods);
  if (
    totalAmountRial > 0n &&
    balanceAfter < lowBalanceThreshold
  ) {
    const periodSeconds =
      input.cadence === BillingCadence.HOURLY ? 3_600n : 86_400n;
    const runwaySeconds =
      (balanceAfter * periodSeconds) / totalAmountRial;
    await tx.dunningCase.upsert({
      where: {
        idempotencyKey: `dunning:low-balance:${instance.id}:${snapshot.id}`,
      },
      create: {
        cloudInstanceId: instance.id,
        billingInvoiceId: invoice.id,
        type: "LOW_BALANCE",
        status: "NOTIFIED",
        thresholdRial: lowBalanceThreshold,
        observedBalanceRial: balanceAfter,
        runwaySeconds,
        notificationSentAt: input.now,
        idempotencyKey: `dunning:low-balance:${instance.id}:${snapshot.id}`,
      },
      update: {
        billingInvoiceId: invoice.id,
        thresholdRial: lowBalanceThreshold,
        observedBalanceRial: balanceAfter,
        runwaySeconds,
        status: "NOTIFIED",
        resolvedAt: null,
      },
    });
    const lowBalanceNotice = await tx.adminNotification.findFirst({
      where: {
        infrastructureOrderId: instance.infrastructureOrderId,
        type: "LOW_BALANCE",
        status: "UNREAD",
      },
    });
    if (!lowBalanceNotice) {
      await tx.adminNotification.create({
        data: {
          type: "LOW_BALANCE",
          infrastructureOrderId: instance.infrastructureOrderId,
          title: "اعتبار Wallet رو به پایان است",
          message: `Estimated runway is ${runwaySeconds.toString()} seconds. Review is required before suspension.`,
        },
      });
    }
  }
  return { invoiced: true, review: false };
}

async function loadSnapshots(
  tx: Prisma.TransactionClient,
  cadence: BillingCadence,
  periodStart: Date,
  periodEnd: Date,
) {
  return tx.serviceBillingPolicySnapshot.findMany({
    where: {
      cadence,
      effectiveFrom: { lt: periodEnd },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: periodStart } }],
    },
    orderBy: [{ cloudInstanceId: "asc" }, { effectiveFrom: "asc" }],
    include: {
      cloudInstance: {
        include: {
          user: { include: { wallet: true } },
        },
      },
    },
  });
}

export async function settleClosedBillingPeriod(input: BillingPeriod) {
  validatePeriod(input);
  const now = input.now ?? new Date();
  const key = periodKey(
    input.cadence,
    input.periodStart,
    input.periodEnd,
  );
  return retrySerializableBilling(() =>
    prisma.$transaction(
      async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`billing-run:${key}`}, 0)
        )::text AS locked
      `;
      const existingRun = await tx.billingRun.findUnique({
        where: { idempotencyKey: `billing-run:${key}` },
      });
      if (existingRun?.status === BillingRunStatus.COMPLETED) {
        return existingRun;
      }
      const run = existingRun
        ? await tx.billingRun.update({
            where: { id: existingRun.id },
            data: {
              status: BillingRunStatus.RUNNING,
              workerId: input.workerId,
              failureCode: null,
              finishedAt: null,
            },
          })
        : await tx.billingRun.create({
            data: {
              cadence: input.cadence,
              periodStart: input.periodStart,
              periodEnd: input.periodEnd,
              workerId: input.workerId,
              idempotencyKey: `billing-run:${key}`,
            },
          });
      const snapshots = await loadSnapshots(
        tx,
        input.cadence,
        input.periodStart,
        input.periodEnd,
      );
      let invoiceCount = 0;
      let reviewCount = 0;
      for (const snapshot of snapshots) {
        const result = await processSnapshot(tx, {
          runId: run.id,
          snapshot,
          cadence: input.cadence,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          now,
        });
        if (result.invoiced) invoiceCount += 1;
        if (result.review) reviewCount += 1;
      }
      return tx.billingRun.update({
        where: { id: run.id },
        data: {
          status:
            reviewCount > 0
              ? BillingRunStatus.PARTIAL
              : BillingRunStatus.COMPLETED,
          invoiceCount,
          reviewCount,
          finishedAt: now,
        },
      });
      },
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 60_000,
      },
    ),
  );
}

export async function settleLatestClosedBillingPeriod(input: {
  cadence: BillingCadence;
  workerId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const period = latestClosedPeriodUtc(input.cadence, now);
  return settleClosedBillingPeriod({
    cadence: input.cadence,
    workerId: input.workerId,
    now,
    ...period,
  });
}

export function billingRangesCoverPeriod(
  start: Date,
  end: Date,
  ranges: Array<{ start: Date; end: Date }>,
) {
  return assertCoveredByRanges(start, end, ranges);
}
