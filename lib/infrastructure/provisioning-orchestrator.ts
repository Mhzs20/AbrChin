import type {
  CloudProviderAdapter,
  CreateServerInput,
  ProviderTask,
} from "@/lib/infrastructure/cloud-provider-adapter";
import { InfrastructureError } from "@/lib/infrastructure/errors";

export type ProvisioningAttempt = {
  paid: boolean;
  providerLocked: boolean;
  createSentAt: Date | null;
  providerTaskId: string | null;
  providerResourceId: string | null;
  noResourceConfirmedAt: Date | null;
};

export type ProvisioningSubmissionResult =
  | {
      state: "EXISTING_RESOURCE";
      resourceId: string;
      task: null;
    }
  | {
      state: "SUBMITTED";
      resourceId: string | null;
      task: ProviderTask;
    }
  | {
      state: "RECONCILING";
      resourceId: null;
      task: null;
    };

export async function submitProvisioningOnce(input: {
  adapter: CloudProviderAdapter;
  attempt: ProvisioningAttempt;
  create: CreateServerInput;
}): Promise<ProvisioningSubmissionResult> {
  if (!input.attempt.paid) throw new Error("provisioning_requires_paid_order");
  if (!input.attempt.providerLocked) throw new Error("provider_lock_required");

  if (input.attempt.providerResourceId) {
    const existing = await input.adapter.findExistingResource({
      region: input.create.region,
      orderPublicId: input.create.orderPublicId,
      expectedName: input.create.name,
      providerResourceId: input.attempt.providerResourceId,
    });
    if (!existing) {
      throw new InfrastructureError(
        "provider_ambiguous",
        "Locked provider resource could not be reconciled",
      );
    }
    return {
      state: "EXISTING_RESOURCE",
      resourceId: existing.id,
      task: null,
    };
  }

  if (input.attempt.providerTaskId) {
    const status = await input.adapter.getTaskStatus({
      region: input.create.region,
      taskId: input.attempt.providerTaskId,
      resourceId: input.attempt.providerResourceId,
    });
    return {
      state: "SUBMITTED",
      resourceId: status.resourceId,
      task: status,
    };
  }

  if (
    input.attempt.createSentAt &&
    input.attempt.noResourceConfirmedAt == null
  ) {
    const existing = await input.adapter.findExistingResource({
      region: input.create.region,
      orderPublicId: input.create.orderPublicId,
      expectedName: input.create.name,
    });
    if (existing) {
      return {
        state: "EXISTING_RESOURCE",
        resourceId: existing.id,
        task: null,
      };
    }
    // Absence from one list response is not proof that the asynchronous
    // create failed. An operator/reconciliation policy must explicitly mark
    // noResourceConfirmedAt before a retry can submit another create.
    return { state: "RECONCILING", resourceId: null, task: null };
  }

  try {
    const task = await input.adapter.createServer(input.create);
    return {
      state: "SUBMITTED",
      resourceId: task.resourceId,
      task,
    };
  } catch (error) {
    if (
      error instanceof InfrastructureError &&
      error.code === "provider_timeout"
    ) {
      return { state: "RECONCILING", resourceId: null, task: null };
    }
    throw error;
  }
}
