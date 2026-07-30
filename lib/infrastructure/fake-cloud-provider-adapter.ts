import {
  InfrastructureProductKind,
  InfrastructureProvider,
} from "@prisma/client";

import type {
  CloudProviderAdapter,
  CreateServerInput,
  ProviderImage,
  ProviderNetwork,
  ProviderPlan,
  ProviderPriceSnapshot,
  ProviderRegion,
  ProviderResizeInput,
  ProviderResource,
  ProviderResourceInput,
  ProviderSecurity,
  ProviderSelection,
  ProviderSshKey,
  ProviderTask,
  ProviderTaskLookup,
  ProviderTaskStatus,
  ReconciliationInput,
  ValidationResult,
} from "@/lib/infrastructure/cloud-provider-adapter";
import { InfrastructureError } from "@/lib/infrastructure/errors";

export type FakeCloudProviderFixtures = {
  provider?: InfrastructureProvider;
  apiVersion?: string;
  regions?: ProviderRegion[];
  plansByRegion?: Record<string, ProviderPlan[]>;
  imagesByRegion?: Record<string, ProviderImage[]>;
  networksByRegion?: Record<string, ProviderNetwork[]>;
  securityByRegion?: Record<string, ProviderSecurity[]>;
  createBehavior?: "success" | "timeout_after_accept" | "failure";
  sshKeysByRegion?: Record<string, ProviderSshKey[]>;
  observedResource?: {
    state?: string;
    ipv4?: string | null;
    networkIds?: string[] | null;
    securityIds?: string[] | null;
  };
};

export class FakeCloudProviderAdapter implements CloudProviderAdapter {
  readonly provider: InfrastructureProvider;
  readonly apiVersion: string;
  readonly createCalls: CreateServerInput[] = [];
  private readonly fixtures: FakeCloudProviderFixtures;
  private readonly resources = new Map<string, ProviderResource>();

  constructor(fixtures: FakeCloudProviderFixtures = {}) {
    this.provider = fixtures.provider ?? InfrastructureProvider.ARVAN;
    this.apiVersion = fixtures.apiVersion ?? "v1";
    this.fixtures = fixtures;
  }

  async syncRegions(): Promise<ProviderRegion[]> {
    return this.fixtures.regions ?? [];
  }

  async syncPlans(region: string): Promise<ProviderPlan[]> {
    return this.fixtures.plansByRegion?.[region] ?? [];
  }

  async syncImages(region: string): Promise<ProviderImage[]> {
    return this.fixtures.imagesByRegion?.[region] ?? [];
  }

  async syncNetworks(region: string): Promise<ProviderNetwork[]> {
    return this.fixtures.networksByRegion?.[region] ?? [];
  }

  async syncSecurity(region: string): Promise<ProviderSecurity[]> {
    return this.fixtures.securityByRegion?.[region] ?? [];
  }

  async listSshKeys(region: string): Promise<ProviderSshKey[]> {
    return this.fixtures.sshKeysByRegion?.[region] ?? [];
  }

  async resolveSelectionDefaults(region: string) {
    const network = (await this.syncNetworks(region)).find(
      (candidate) => candidate.available && candidate.isDefault,
    );
    const security = (await this.syncSecurity(region)).find(
      (candidate) => candidate.available && candidate.isDefault,
    );
    if (!network || !security) {
      throw new InfrastructureError(
        "provider_default_selection_missing",
        "Fake provider defaults are unavailable",
      );
    }
    return {
      region,
      externalNetworkId: network.externalId,
      externalSecurityId: security.externalId,
      checkedAt: new Date(),
      providerRequestIds: [],
    };
  }

  async validateSelection(
    input: ProviderSelection,
  ): Promise<ValidationResult> {
    const plan = (await this.syncPlans(input.region)).find(
      (candidate) => candidate.externalPlanId === input.externalPlanId,
    );
    const image = (await this.syncImages(input.region)).find(
      (candidate) => candidate.externalId === input.externalImageId,
    );
    if (!plan?.available) {
      return {
        valid: false,
        code: "plan_unavailable",
        checkedAt: new Date(),
      };
    }
    if (!plan.resourceContractValid) {
      return {
        valid: false,
        code: "invalid_resource_contract",
        checkedAt: new Date(),
      };
    }
    if (!plan.priceMonthlyIrr || plan.priceMonthlyIrr <= 0n) {
      return { valid: false, code: "invalid_price", checkedAt: new Date() };
    }
    if (!image?.available) {
      return {
        valid: false,
        code: "image_incompatible",
        checkedAt: new Date(),
      };
    }
    if (
      input.externalNetworkId &&
      !(await this.syncNetworks(input.region)).some(
        (network) =>
          network.externalId === input.externalNetworkId &&
          network.available,
      )
    ) {
      return {
        valid: false,
        code: "network_unavailable",
        checkedAt: new Date(),
      };
    }
    if (
      input.externalSecurityId &&
      !(await this.syncSecurity(input.region)).some(
        (security) =>
          security.externalId === input.externalSecurityId &&
          security.available,
      )
    ) {
      return {
        valid: false,
        code: "security_unavailable",
        checkedAt: new Date(),
      };
    }
    return { valid: true, checkedAt: new Date() };
  }

  async refreshPrice(
    input: ProviderSelection,
  ): Promise<ProviderPriceSnapshot> {
    const plan = (await this.syncPlans(input.region)).find(
      (candidate) => candidate.externalPlanId === input.externalPlanId,
    );
    if (!plan?.available || !plan.priceMonthlyIrr) {
      throw new InfrastructureError(
        "provider_unavailable",
        "Fake plan is not sellable",
      );
    }
    return {
      provider: this.provider,
      apiVersion: this.apiVersion,
      productKind:
        this.provider === InfrastructureProvider.ARVAN
          ? InfrastructureProductKind.CLOUD_SERVER
          : InfrastructureProductKind.READY_INSTANT_SERVER,
      region: input.region,
      externalPlanId: input.externalPlanId,
      hourlyPriceIrr: plan.priceHourlyIrr,
      monthlyPriceIrr: plan.priceMonthlyIrr,
      currency: "IRR",
      available: true,
      checkedAt: new Date(),
      rawPayload: plan.rawPayload,
    };
  }

  async createServer(input: CreateServerInput): Promise<ProviderTask> {
    this.createCalls.push(input);
    const id = `fake-${input.orderPublicId}-${this.createCalls.length}`;
    const resource: ProviderResource = {
      id,
      name: input.name,
      region: input.region,
      state: "build",
      ipv4: null,
      networkIds: input.externalNetworkId
        ? [input.externalNetworkId]
        : null,
      securityIds: input.externalSecurityId
        ? [input.externalSecurityId]
        : null,
      observedAt: new Date(),
      rawPayload: { id, name: input.name, status: "build" },
    };
    this.resources.set(id, resource);
    if (this.fixtures.createBehavior === "failure") {
      this.resources.delete(id);
      throw new InfrastructureError(
        "provider_unavailable",
        "Fake create failed",
      );
    }
    if (this.fixtures.createBehavior === "timeout_after_accept") {
      throw new InfrastructureError(
        "provider_timeout",
        "Fake timeout after accept",
      );
    }
    return {
      taskId: `task-${id}`,
      actionId: null,
      resourceId: id,
      requestId: `request-${id}`,
      state: "SUBMITTED",
      submittedAt: new Date(),
    };
  }

  async getTaskStatus(
    input: ProviderTaskLookup,
  ): Promise<ProviderTaskStatus> {
    const resource = input.resourceId
      ? this.resources.get(input.resourceId)
      : undefined;
    if (!resource) {
      throw new InfrastructureError(
        "provider_not_found",
        "Fake resource not found",
      );
    }
    resource.state =
      this.fixtures.observedResource?.state ?? "active";
    resource.ipv4 =
      this.fixtures.observedResource?.ipv4 === undefined
        ? "192.0.2.10"
        : this.fixtures.observedResource.ipv4;
    resource.networkIds =
      this.fixtures.observedResource?.networkIds === undefined
        ? resource.networkIds
        : this.fixtures.observedResource.networkIds;
    resource.securityIds =
      this.fixtures.observedResource?.securityIds === undefined
        ? resource.securityIds
        : this.fixtures.observedResource.securityIds;
    resource.observedAt = new Date();
    return {
      taskId: input.taskId ?? `task-${resource.id}`,
      actionId: null,
      resourceId: resource.id,
      requestId: `request-${resource.id}`,
      state: "SUCCEEDED",
      submittedAt: new Date(),
      checkedAt: new Date(),
    };
  }

  async findExistingResource(
    input: ReconciliationInput,
  ): Promise<ProviderResource | null> {
    if (input.providerResourceId) {
      return this.resources.get(input.providerResourceId) ?? null;
    }
    return (
      [...this.resources.values()].find(
        (resource) =>
          resource.region === input.region &&
          resource.name === input.expectedName,
      ) ?? null
    );
  }

  private fakeAction(
    input: ProviderResourceInput,
    state: string,
  ): Promise<ProviderTask> {
    const resource = this.resources.get(input.resourceId);
    if (!resource) {
      throw new InfrastructureError(
        "provider_not_found",
        "Fake resource not found",
      );
    }
    resource.state = state;
    return Promise.resolve({
      taskId: `task-${input.resourceId}-${state}`,
      actionId: null,
      resourceId: input.resourceId,
      requestId: `request-${input.resourceId}`,
      state: "SUBMITTED",
      submittedAt: new Date(),
    });
  }

  powerOn(input: ProviderResourceInput): Promise<ProviderTask> {
    return this.fakeAction(input, "active");
  }

  powerOff(input: ProviderResourceInput): Promise<ProviderTask> {
    return this.fakeAction(input, "shutoff");
  }

  reboot(input: ProviderResourceInput): Promise<ProviderTask> {
    return this.fakeAction(input, "reboot");
  }

  resize(input: ProviderResizeInput): Promise<ProviderTask> {
    return this.fakeAction(input, `resize:${input.externalPlanId}`);
  }

  async terminate(input: ProviderResourceInput): Promise<ProviderTask> {
    const task = await this.fakeAction(input, "deleted");
    return task;
  }
}
