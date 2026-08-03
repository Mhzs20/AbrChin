import {
  Prisma,
  ResourceChangeStatus,
  ResourceVersionState,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { WalletError } from "@/lib/wallet/errors";

const PROVIDER_CONFIRMABLE_CHANGE_STATUSES = new Set<ResourceChangeStatus>([
  ResourceChangeStatus.APPROVED,
  ResourceChangeStatus.PROVIDER_MUTATION_PENDING,
]);

type ConfirmedResources = {
  vcpu: number;
  ramMb: number;
  diskGb: number;
  ipv4Count: number;
  backupEnabled: boolean;
  snapshotCount: number;
};

function validateResources(resources: ConfirmedResources) {
  if (
    !Number.isInteger(resources.vcpu) ||
    resources.vcpu <= 0 ||
    !Number.isInteger(resources.ramMb) ||
    resources.ramMb <= 0 ||
    !Number.isInteger(resources.diskGb) ||
    resources.diskGb < 0 ||
    !Number.isInteger(resources.ipv4Count) ||
    resources.ipv4Count < 0 ||
    !Number.isInteger(resources.snapshotCount) ||
    resources.snapshotCount < 0
  ) {
    throw new WalletError(
      "invalid_provider_resource_snapshot",
      "Snapshot منابع تأییدشده Provider معتبر نیست.",
    );
  }
}

export async function recordProviderConfirmedResourceVersion(input: {
  cloudInstanceId: string;
  planId: string;
  state: ResourceVersionState;
  resources: ConfirmedResources;
  providerEventId: string;
  providerConfirmedAt: Date;
  idempotencyKey: string;
  sourceChangeRequestId?: string;
}) {
  validateResources(input.resources);
  if (
    !input.providerEventId.trim() ||
    input.providerConfirmedAt.getTime() > Date.now() + 60_000
  ) {
    throw new WalletError(
      "invalid_provider_confirmation",
      "تأیید Provider برای Timeline معتبر نیست.",
    );
  }

  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "CloudInstance" WHERE id = ${input.cloudInstanceId} FOR UPDATE`;
      const replay = await tx.resourceVersion.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (replay) return replay;
      const instance = await tx.cloudInstance.findUniqueOrThrow({
        where: { id: input.cloudInstanceId },
      });
      const plan = await tx.infrastructurePlan.findUniqueOrThrow({
        where: { id: input.planId },
      });
      if (
        plan.provider !== instance.provider ||
        plan.productKind !== "CLOUD_SERVER"
      ) {
        throw new WalletError(
          "resource_plan_provider_mismatch",
          "Plan با Resource تأییدشده Provider سازگار نیست.",
        );
      }
      const current = await tx.resourceVersion.findFirst({
        where: {
          cloudInstanceId: instance.id,
          effectiveTo: null,
        },
        orderBy: { effectiveFrom: "desc" },
      });
      if (
        current &&
        input.providerConfirmedAt <= current.effectiveFrom
      ) {
        throw new WalletError(
          "non_monotonic_resource_version",
          "زمان نسخه جدید منابع باید پس از نسخه فعلی باشد.",
        );
      }
      const snapshot = await tx.serviceBillingPolicySnapshot.findFirst({
        where: {
          cloudInstanceId: instance.id,
          effectiveFrom: { lte: input.providerConfirmedAt },
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gt: input.providerConfirmedAt } },
          ],
        },
        orderBy: { effectiveFrom: "desc" },
      });
      if (!snapshot) {
        throw new WalletError(
          "billing_policy_snapshot_missing",
          "Policy Snapshot فعال برای Resource پیدا نشد.",
        );
      }
      let changeRequest = null;
      if (input.sourceChangeRequestId) {
        changeRequest =
          await tx.resourceChangeRequest.findUniqueOrThrow({
            where: { id: input.sourceChangeRequestId },
          });
        if (
          changeRequest.cloudInstanceId !== instance.id ||
          !PROVIDER_CONFIRMABLE_CHANGE_STATUSES.has(
            changeRequest.status,
          )
        ) {
          throw new WalletError(
            "resource_change_not_provider_confirmable",
            "درخواست تغییر منابع برای ثبت تأیید Provider آماده نیست.",
          );
        }
      }
      if (current) {
        await tx.resourceVersion.update({
          where: { id: current.id },
          data: { effectiveTo: input.providerConfirmedAt },
        });
        await tx.usageInterval.updateMany({
          where: {
            cloudInstanceId: instance.id,
            resourceVersionId: current.id,
            startedAt: { lt: input.providerConfirmedAt },
            OR: [
              { endedAt: null },
              { endedAt: { gt: input.providerConfirmedAt } },
            ],
          },
          data: {
            status: "COMPLETE",
            endedAt: input.providerConfirmedAt,
            providerEventEndId: input.providerEventId,
          },
        });
      }
      const resourceVersion = await tx.resourceVersion.create({
        data: {
          cloudInstanceId: instance.id,
          planId: plan.id,
          provider: instance.provider,
          providerInstanceId: instance.providerInstanceId,
          sourceChangeRequestId: input.sourceChangeRequestId,
          state: input.state,
          ...input.resources,
          resourceSnapshot: {
            ...input.resources,
            state: input.state,
            providerEventId: input.providerEventId,
          },
          providerEventId: input.providerEventId,
          providerConfirmedAt: input.providerConfirmedAt,
          effectiveFrom: input.providerConfirmedAt,
          idempotencyKey: input.idempotencyKey,
        },
      });
      if (current) {
        await tx.usageInterval.updateMany({
          where: {
            cloudInstanceId: instance.id,
            resourceVersionId: current.id,
            startedAt: { gte: input.providerConfirmedAt },
          },
          data: { resourceVersionId: resourceVersion.id },
        });
      }
      const existingScheduledInterval = await tx.usageInterval.findFirst({
        where: {
          cloudInstanceId: instance.id,
          resourceVersionId: resourceVersion.id,
          billingPolicySnapshotId: snapshot.id,
          startedAt: { lte: input.providerConfirmedAt },
          OR: [
            { endedAt: null },
            { endedAt: { gt: input.providerConfirmedAt } },
          ],
        },
      });
      if (!existingScheduledInterval) {
        await tx.usageInterval.create({
          data: {
            cloudInstanceId: instance.id,
            resourceVersionId: resourceVersion.id,
            billingPolicySnapshotId: snapshot.id,
            status: snapshot.effectiveTo ? "COMPLETE" : "OPEN",
            startedAt: input.providerConfirmedAt,
            endedAt: snapshot.effectiveTo,
            providerEventStartId: input.providerEventId,
            providerEventEndId: snapshot.effectiveTo
              ? `billing-policy:${snapshot.id}`
              : null,
            idempotencyKey: `usage:${input.idempotencyKey}`,
          },
        });
      }
      if (changeRequest) {
        await tx.resourceChangeRequest.update({
          where: { id: changeRequest.id },
          data: {
            status: ResourceChangeStatus.APPLIED,
            providerConfirmedAt: input.providerConfirmedAt,
            effectiveFrom: input.providerConfirmedAt,
          },
        });
      }
      await tx.cloudInstance.update({
        where: { id: instance.id },
        data:
          input.state === ResourceVersionState.TERMINATED
            ? {
                status: "TERMINATED",
                providerState: "TERMINATED",
                providerObservedAt: input.providerConfirmedAt,
                terminatedAt: input.providerConfirmedAt,
              }
            : {
                status: "ACTIVE",
                providerState: input.state,
                providerObservedAt: input.providerConfirmedAt,
                terminatedAt: null,
              },
      });
      return resourceVersion;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}
