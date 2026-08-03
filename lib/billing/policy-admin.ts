import {
  BillingCadence,
  Prisma,
  type BillingAvailability,
  type BillingPolicyVersion,
  type BillingPriceDisplayMode,
  type InfrastructureProductKind,
} from "@prisma/client";

import {
  assertAdminActorTx,
  normalizeAdminCommand,
  persistAdminCommandReceiptTx,
  replayAdminCommandTx,
} from "@/lib/admin/command-receipt";
import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import {
  assertCadenceAllowed,
  calculateMinimumCreditRial,
  periodContainingUtc,
  validateBillingPolicyContract,
} from "@/lib/billing/policy";
import { WalletError } from "@/lib/wallet/errors";

export type PlanBillingPolicyInput = {
  availability: BillingAvailability;
  defaultCadence: BillingCadence;
  displayMode: BillingPriceDisplayMode;
  hourlyMinimumCreditHours: number;
  dailyMinimumCreditDays: number;
  hourlyGracePeriods: number;
  dailyGracePeriods: number;
  lowBalanceThresholdPeriods: number;
  effectiveFrom: Date;
  changeReason: string;
};

export function billingDefaultsForNewPlan(
  productKind: InfrastructureProductKind,
  globalBillingPolicyVersionId: string | null,
) {
  if (productKind === "CLOUD_SERVER") {
    if (!globalBillingPolicyVersionId) {
      throw new WalletError(
        "billing_policy_unavailable",
        "Global Billing Policy برای Cloud Plan الزامی است.",
      );
    }
    return {
      billingModel: "PAYG_WALLET" as const,
      billingPolicyVersionId: globalBillingPolicyVersionId,
    };
  }
  return {
    billingModel: "PREPAID_TERM" as const,
    billingPolicyVersionId: null,
  };
}

function enabledCadences(availability: BillingAvailability) {
  if (availability === "HOURLY_ONLY") return ["HOURLY"];
  if (availability === "DAILY_ONLY") return ["DAILY"];
  return ["HOURLY", "DAILY"];
}

function positiveInteger(value: unknown, field: string) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 10_000) {
    throw new WalletError(
      "invalid_billing_policy",
      `${field} باید عدد صحیح مثبت باشد.`,
    );
  }
  return parsed;
}

function nonNegativeInteger(value: unknown, field: string) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 10_000) {
    throw new WalletError(
      "invalid_billing_policy",
      `${field} باید عدد صحیح نامنفی باشد.`,
    );
  }
  return parsed;
}

export function parsePlanBillingPolicyInput(
  body: Record<string, unknown>,
  now = new Date(),
): PlanBillingPolicyInput {
  const availability = body.availability;
  const defaultCadence = body.defaultCadence;
  const displayMode = body.displayMode;
  if (
    !["HOURLY_ONLY", "DAILY_ONLY", "HOURLY_AND_DAILY"].includes(
      String(availability),
    ) ||
    !["HOURLY", "DAILY"].includes(String(defaultCadence)) ||
    !["HOURLY", "DAILY", "BOTH"].includes(String(displayMode))
  ) {
    throw new WalletError(
      "invalid_billing_policy",
      "Availability، Cadence یا Display Mode معتبر نیست.",
    );
  }
  const effectiveFrom = new Date(String(body.effectiveFrom ?? now.toISOString()));
  if (
    Number.isNaN(effectiveFrom.getTime()) ||
    effectiveFrom.getTime() < now.getTime() - 5_000
  ) {
    throw new WalletError(
      "retroactive_billing_policy",
      "زمان اثر Billing Policy نمی‌تواند در گذشته باشد.",
    );
  }
  const changeReason =
    typeof body.changeReason === "string" ? body.changeReason.trim() : "";
  if (changeReason.length < 3 || changeReason.length > 500) {
    throw new WalletError(
      "invalid_reason",
      "دلیل تغییر باید بین ۳ تا ۵۰۰ کاراکتر باشد.",
    );
  }
  const parsed: PlanBillingPolicyInput = {
    availability: availability as BillingAvailability,
    defaultCadence: defaultCadence as BillingCadence,
    displayMode: displayMode as BillingPriceDisplayMode,
    hourlyMinimumCreditHours: positiveInteger(
      body.hourlyMinimumCreditHours,
      "Hourly buffer",
    ),
    dailyMinimumCreditDays: positiveInteger(
      body.dailyMinimumCreditDays,
      "Daily buffer",
    ),
    hourlyGracePeriods: nonNegativeInteger(
      body.hourlyGracePeriods,
      "Hourly grace",
    ),
    dailyGracePeriods: nonNegativeInteger(
      body.dailyGracePeriods,
      "Daily grace",
    ),
    lowBalanceThresholdPeriods: positiveInteger(
      body.lowBalanceThresholdPeriods,
      "Low-balance threshold",
    ),
    effectiveFrom,
    changeReason,
  };
  validateBillingPolicyContract(parsed);
  return parsed;
}

export function serializeBillingPolicy(policy: BillingPolicyVersion) {
  return {
    id: policy.id,
    policyKey: policy.policyKey,
    version: policy.version,
    scope: policy.scope,
    availability: policy.availability,
    defaultCadence: policy.defaultCadence,
    displayMode: policy.displayMode,
    hourlyMinimumCreditHours: policy.hourlyMinimumCreditHours,
    dailyMinimumCreditDays: policy.dailyMinimumCreditDays,
    hourlyGracePeriods: policy.hourlyGracePeriods,
    dailyGracePeriods: policy.dailyGracePeriods,
    lowBalanceThresholdPeriods: policy.lowBalanceThresholdPeriods,
    enabledCadences: policy.enabledCadences,
    effectiveFrom: policy.effectiveFrom.toISOString(),
    effectiveTo: policy.effectiveTo?.toISOString() ?? null,
    changeReason: policy.changeReason,
  };
}

export async function createPlanBillingPolicyVersion(input: {
  planId: string;
  actorUserId: string;
  policy: PlanBillingPolicyInput;
  idempotencyKey: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const command = normalizeAdminCommand({
    operation: "UPDATE_PLAN_BILLING_POLICY",
    idempotencyKey: input.idempotencyKey,
    actorUserId: input.actorUserId,
    reason: input.policy.changeReason,
    payload: {
      planId: input.planId,
      ...input.policy,
      effectiveFrom: input.policy.effectiveFrom.toISOString(),
    },
  });
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM "InfrastructurePlan"
        WHERE id = ${input.planId}
        FOR UPDATE
      `;
      await assertAdminActorTx(tx, input.actorUserId);
      const replay = await replayAdminCommandTx(tx, command);
      if (replay) return replay;
      const plan = await tx.infrastructurePlan.findUniqueOrThrow({
        where: { id: input.planId },
      });
      if (plan.productKind !== "CLOUD_SERVER") {
        throw new WalletError(
          "billing_policy_not_allowed",
          "Billing Policy مصرفی فقط برای Cloud Server مجاز است.",
        );
      }
      const pending = await tx.billingPolicyVersion.findFirst({
        where: {
          planId: plan.id,
          effectiveFrom: { gt: new Date() },
          effectiveTo: null,
        },
      });
      if (pending) {
        throw new WalletError(
          "billing_policy_change_pending",
          "یک Billing Policy آینده برای این Plan از قبل ثبت شده است.",
        );
      }
      const previous = await tx.billingPolicyVersion.findFirst({
        where: {
          OR: [
            {
              planId: plan.id,
              effectiveFrom: { lte: input.policy.effectiveFrom },
              OR: [
                { effectiveTo: null },
                { effectiveTo: { gt: input.policy.effectiveFrom } },
              ],
            },
            {
              policyKey: "global",
              scope: "GLOBAL",
              effectiveFrom: { lte: input.policy.effectiveFrom },
              OR: [
                { effectiveTo: null },
                { effectiveTo: { gt: input.policy.effectiveFrom } },
              ],
            },
          ],
        },
        orderBy: [{ scope: "desc" }, { effectiveFrom: "desc" }],
      });
      if (!previous) {
        throw new WalletError(
          "billing_policy_unavailable",
          "Global Billing Policy معتبر پیدا نشد.",
        );
      }
      const policyKey = `plan:${plan.id}`;
      const latest = await tx.billingPolicyVersion.findFirst({
        where: { policyKey },
        orderBy: { version: "desc" },
      });
      const previousPlanPolicy = await tx.billingPolicyVersion.findFirst({
        where: {
          planId: plan.id,
          effectiveFrom: { lte: input.policy.effectiveFrom },
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gt: input.policy.effectiveFrom } },
          ],
        },
        orderBy: { effectiveFrom: "desc" },
      });
      if (previousPlanPolicy) {
        await tx.billingPolicyVersion.update({
          where: { id: previousPlanPolicy.id },
          data: { effectiveTo: input.policy.effectiveFrom },
        });
      }
      const created = await tx.billingPolicyVersion.create({
        data: {
          policyKey,
          version: (latest?.version ?? 0) + 1,
          scope: "PLAN",
          planId: plan.id,
          availability: input.policy.availability,
          defaultCadence: input.policy.defaultCadence,
          displayMode: input.policy.displayMode,
          hourlyMinimumCreditHours:
            input.policy.hourlyMinimumCreditHours,
          dailyMinimumCreditDays: input.policy.dailyMinimumCreditDays,
          hourlyGracePeriods: input.policy.hourlyGracePeriods,
          dailyGracePeriods: input.policy.dailyGracePeriods,
          lowBalanceThresholdPeriods:
            input.policy.lowBalanceThresholdPeriods,
          calculationUnit: previous.calculationUnit,
          minimumChargeSeconds: previous.minimumChargeSeconds,
          roundingPolicy: previous.roundingPolicy,
          prorationSupported: previous.prorationSupported,
          stopStateComponentPolicy:
            previous.stopStateComponentPolicy as Prisma.InputJsonValue,
          enabledCadences: enabledCadences(
            input.policy.availability,
          ),
          effectiveFrom: input.policy.effectiveFrom,
          createdById: input.actorUserId,
          changeReason: input.policy.changeReason,
        },
      });
      await tx.infrastructurePlan.update({
        where: { id: plan.id },
        data: {
          billingModel: "PAYG_WALLET",
          billingPolicyVersionId: created.id,
          updatedById: input.actorUserId,
        },
      });
      const snapshot = {
        planId: plan.id,
        policy: serializeBillingPolicy(created),
        activeServiceSnapshotsChanged: false,
      } satisfies Prisma.InputJsonObject;
      await writeAuditLog(
        {
          actorUserId: input.actorUserId,
          action: AuditActions.BILLING_POLICY_UPDATE,
          entityType: "BillingPolicyVersion",
          entityId: created.id,
          beforeData: serializeBillingPolicy(previous),
          afterData: snapshot,
          idempotencyKey: `audit:${command.receiptKey}`,
          ip: input.ip,
          userAgent: input.userAgent,
        },
        tx,
      );
      await persistAdminCommandReceiptTx(tx, command, snapshot);
      return snapshot;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function scheduleServiceBillingCadenceChange(input: {
  cloudInstanceId: string;
  targetBillingPolicyVersionId: string;
  targetCadence: BillingCadence;
  effectiveFrom: Date;
  actorUserId: string;
  reason: string;
  idempotencyKey: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const command = normalizeAdminCommand({
    operation: "CHANGE_SERVICE_BILLING_CADENCE",
    idempotencyKey: input.idempotencyKey,
    actorUserId: input.actorUserId,
    reason: input.reason,
    payload: {
      cloudInstanceId: input.cloudInstanceId,
      targetBillingPolicyVersionId:
        input.targetBillingPolicyVersionId,
      targetCadence: input.targetCadence,
      effectiveFrom: input.effectiveFrom.toISOString(),
    },
  });
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM "CloudInstance"
        WHERE id = ${input.cloudInstanceId}
        FOR UPDATE
      `;
      await assertAdminActorTx(tx, input.actorUserId);
      const replay = await replayAdminCommandTx(tx, command);
      if (replay) return replay;
      const instance = await tx.cloudInstance.findUniqueOrThrow({
        where: { id: input.cloudInstanceId },
        include: {
          user: { include: { wallet: true } },
          infrastructureOrder: true,
          billingPolicySnapshots: {
            where: { effectiveTo: null },
            orderBy: { effectiveFrom: "desc" },
            take: 1,
          },
          usageIntervals: {
            where: { endedAt: null },
            orderBy: { startedAt: "desc" },
            take: 1,
          },
        },
      });
      const current = instance.billingPolicySnapshots[0];
      const openUsage = instance.usageIntervals[0];
      if (!current || !openUsage || instance.status !== "ACTIVE") {
        throw new WalletError(
          "billing_cadence_change_not_eligible",
          "Service فعال با Usage باز برای تغییر Cadence پیدا نشد.",
        );
      }
      const earliestBoundary = periodContainingUtc(
        current.cadence,
        new Date(),
      ).periodEnd;
      const requestedBoundary = periodContainingUtc(
        current.cadence,
        input.effectiveFrom,
      ).periodStart;
      if (
        input.effectiveFrom.getTime() !== requestedBoundary.getTime() ||
        input.effectiveFrom < earliestBoundary
      ) {
        throw new WalletError(
          "billing_cadence_boundary_required",
          "تغییر Cadence باید از مرز Period بسته‌شده بعدی اعمال شود.",
        );
      }
      const targetPolicy =
        await tx.billingPolicyVersion.findUniqueOrThrow({
          where: { id: input.targetBillingPolicyVersionId },
        });
      if (
        targetPolicy.planId !== instance.infrastructureOrder.planId ||
        targetPolicy.effectiveFrom > input.effectiveFrom ||
        (targetPolicy.effectiveTo &&
          targetPolicy.effectiveTo <= input.effectiveFrom)
      ) {
        throw new WalletError(
          "billing_policy_unavailable",
          "Billing Policy هدف در زمان اثر برای این Service معتبر نیست.",
        );
      }
      assertCadenceAllowed(
        targetPolicy.availability,
        input.targetCadence,
      );
      const minimumCreditRial = calculateMinimumCreditRial({
        policy: targetPolicy,
        cadence: input.targetCadence,
        hourlyEstimateRial: current.hourlyEstimateRial,
        dailyEstimateRial: current.dailyEstimateRial,
        oneTimeChargesRial: 0n,
      });
      if (
        !instance.user.wallet ||
        instance.user.wallet.availableBalance < minimumCreditRial
      ) {
        throw new WalletError(
          "insufficient_credit",
          "اعتبار Wallet برای Cadence جدید کافی نیست.",
        );
      }
      const future = await tx.serviceBillingPolicySnapshot.findFirst({
        where: {
          cloudInstanceId: instance.id,
          effectiveFrom: { gt: new Date() },
        },
      });
      if (future) {
        throw new WalletError(
          "billing_cadence_change_pending",
          "یک تغییر Cadence آینده برای این Service ثبت شده است.",
        );
      }
      await tx.serviceBillingPolicySnapshot.update({
        where: { id: current.id },
        data: { effectiveTo: input.effectiveFrom },
      });
      await tx.usageInterval.update({
        where: { id: openUsage.id },
        data: {
          endedAt: input.effectiveFrom,
          status: "COMPLETE",
          providerEventEndId:
            `billing-cadence:${command.receiptKey}`,
        },
      });
      const next = await tx.serviceBillingPolicySnapshot.create({
        data: {
          cloudInstanceId: instance.id,
          billingPolicyVersionId: targetPolicy.id,
          cadence: input.targetCadence,
          displayMode: targetPolicy.displayMode,
          calculationUnit: targetPolicy.calculationUnit,
          minimumChargeSeconds: targetPolicy.minimumChargeSeconds,
          roundingPolicy: targetPolicy.roundingPolicy,
          prorationSupported: targetPolicy.prorationSupported,
          hourlyEstimateRial: current.hourlyEstimateRial,
          dailyEstimateRial: current.dailyEstimateRial,
          minimumCreditRial,
          gracePeriods:
            input.targetCadence === "HOURLY"
              ? targetPolicy.hourlyGracePeriods
              : targetPolicy.dailyGracePeriods,
          lowBalanceThresholdPeriods:
            targetPolicy.lowBalanceThresholdPeriods,
          stopStateComponentPolicy:
            targetPolicy.stopStateComponentPolicy as Prisma.InputJsonValue,
          providerPolicySnapshot:
            current.providerPolicySnapshot as Prisma.InputJsonValue,
          effectiveFrom: input.effectiveFrom,
          idempotencyKey:
            `billing-cadence:${instance.id}:${command.receiptKey}`,
        },
      });
      await tx.usageInterval.create({
        data: {
          cloudInstanceId: instance.id,
          resourceVersionId: openUsage.resourceVersionId,
          billingPolicySnapshotId: next.id,
          status: "OPEN",
          startedAt: input.effectiveFrom,
          providerEventStartId:
            `billing-cadence:${command.receiptKey}`,
          idempotencyKey:
            `usage-cadence:${instance.id}:${command.receiptKey}`,
        },
      });
      const snapshot = {
        cloudInstanceId: instance.id,
        previousSnapshotId: current.id,
        nextSnapshotId: next.id,
        previousCadence: current.cadence,
        targetCadence: next.cadence,
        effectiveFrom: input.effectiveFrom.toISOString(),
        walletChanged: false,
      } satisfies Prisma.InputJsonObject;
      await writeAuditLog(
        {
          actorUserId: input.actorUserId,
          action: AuditActions.BILLING_CADENCE_CHANGE,
          entityType: "CloudInstance",
          entityId: instance.id,
          afterData: snapshot,
          idempotencyKey: `audit:${command.receiptKey}`,
          ip: input.ip,
          userAgent: input.userAgent,
        },
        tx,
      );
      await persistAdminCommandReceiptTx(tx, command, snapshot);
      return snapshot;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
