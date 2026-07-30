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
import { ParsPackProvider } from "@/lib/infrastructure/parspack/client";
import type { ProviderCatalog } from "@/lib/infrastructure/types";
import {
  decimalToScaledInteger,
  normalizeProviderPriceContract,
  providerAmountToRial,
} from "@/lib/pricing/provider-pricing";

export class ParsPackV1Adapter implements CloudProviderAdapter {
  readonly provider = InfrastructureProvider.PARSPACK;
  readonly apiVersion = "v1";
  private catalogPromise: Promise<ProviderCatalog> | null = null;
  private readonly client: ParsPackProvider;

  constructor(client: ParsPackProvider) {
    this.client = client;
  }

  private catalog(refresh = false): Promise<ProviderCatalog> {
    if (refresh || !this.catalogPromise) {
      this.catalogPromise = this.client.syncCatalog();
    }
    return this.catalogPromise;
  }

  async syncRegions(): Promise<ProviderRegion[]> {
    const catalog = await this.catalog(true);
    return catalog.regions.map((region) => ({
      code: region.code,
      name: region.name,
      available: region.available !== false,
      rawPayload: { ...region },
    }));
  }

  async syncPlans(region: string): Promise<ProviderPlan[]> {
    const catalog = await this.catalog();
    const contract = normalizeProviderPriceContract(catalog.priceContract);
    return catalog.sizes
      .filter(
        (size) =>
          size.regionCode === region ||
          size.regionCodes?.includes(region) ||
          (!size.regionCode && !size.regionCodes?.length),
      )
      .map((size) => {
        const toIrr = (raw?: string): bigint | null => {
          if (!raw || !contract) return null;
          try {
            return providerAmountToRial({
              scaledAmount: decimalToScaledInteger(raw),
              contract,
            });
          } catch {
            return null;
          }
        };
        const priceHourlyIrr = toIrr(size.priceHourly);
        const priceMonthlyIrr = toIrr(size.priceMonthly);
        return {
          externalPlanId: size.code,
          region,
          name: size.name,
          vcpu: size.vcpu == null ? null : Math.trunc(size.vcpu),
          ramMb: size.memoryMb == null ? null : Math.trunc(size.memoryMb),
          diskGb: size.diskGb == null ? null : Math.trunc(size.diskGb),
          resourceContractValid:
            size.vcpu != null &&
            size.vcpu > 0 &&
            size.memoryMb != null &&
            size.memoryMb > 0 &&
            size.diskGb != null &&
            size.diskGb > 0,
          resourceContractError: null,
          available:
            size.available !== false &&
            priceMonthlyIrr != null &&
            priceMonthlyIrr > 0n,
          priceHourlyIrr,
          priceMonthlyIrr,
          sourceMoneyUnit: contract?.amountUnit ?? "UNCONFIRMED",
          rawUpdatedAt: size.rawUpdatedAt
            ? new Date(size.rawUpdatedAt)
            : null,
          rawPayload: { ...size },
        };
      });
  }

  async syncImages(region: string): Promise<ProviderImage[]> {
    const catalog = await this.catalog();
    return catalog.images
      .filter(
        (image) =>
          !image.regionCodes?.length || image.regionCodes.includes(region),
      )
      .map((image) => ({
        externalId: image.code,
        region,
        name: image.name,
        operatingSystem: image.osFamily ?? null,
        minDiskGb: image.minDiskGb ?? null,
        minRamMb: null,
        available:
          !image.status ||
          ["available", "active", "ready"].includes(
            image.status.toLowerCase(),
          ),
        sshKeySupported: null,
        sshPasswordSupported: null,
        rawUpdatedAt: null,
        rawPayload: { ...image },
      }));
  }

  syncNetworks(region: string): Promise<ProviderNetwork[]> {
    void region;
    return Promise.resolve([]);
  }

  syncSecurity(region: string): Promise<ProviderSecurity[]> {
    void region;
    return Promise.resolve([]);
  }

  listSshKeys(region: string): Promise<ProviderSshKey[]> {
    void region;
    return Promise.resolve([]);
  }

  resolveSelectionDefaults(region: string) {
    return Promise.resolve({
      region,
      externalNetworkId: "provider-default",
      externalSecurityId: "provider-default",
      checkedAt: new Date(),
      providerRequestIds: [],
    });
  }

  async validateSelection(
    input: ProviderSelection,
  ): Promise<ValidationResult> {
    if (input.productKind !== InfrastructureProductKind.READY_INSTANT_SERVER) {
      return {
        valid: false,
        code: "product_kind_mismatch",
        checkedAt: new Date(),
      };
    }
    const [plans, images] = await Promise.all([
      this.syncPlans(input.region),
      this.syncImages(input.region),
    ]);
    const plan = plans.find(
      (candidate) => candidate.externalPlanId === input.externalPlanId,
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
    if (!plan.priceMonthlyIrr) {
      return { valid: false, code: "invalid_price", checkedAt: new Date() };
    }
    const image = images.find(
      (candidate) => candidate.externalId === input.externalImageId,
    );
    if (
      !image?.available ||
      (image.minDiskGb != null &&
        plan.diskGb != null &&
        image.minDiskGb > plan.diskGb)
    ) {
      return {
        valid: false,
        code: "image_incompatible",
        checkedAt: new Date(),
      };
    }
    return { valid: true, checkedAt: new Date() };
  }

  async refreshPrice(
    input: ProviderSelection,
  ): Promise<ProviderPriceSnapshot> {
    this.catalogPromise = null;
    const plan = (await this.syncPlans(input.region)).find(
      (candidate) => candidate.externalPlanId === input.externalPlanId,
    );
    if (!plan?.available || !plan.priceMonthlyIrr) {
      throw new InfrastructureError(
        "provider_unavailable",
        "ParsPack plan is not sellable",
      );
    }
    return {
      provider: this.provider,
      apiVersion: this.apiVersion,
      productKind: InfrastructureProductKind.READY_INSTANT_SERVER,
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
    const instance = await this.client.createInstance({
      name: input.name,
      region: input.region,
      size: input.externalPlanId,
      image: input.externalImageId,
      deliveryMode: "MANAGED",
    });
    return {
      taskId: null,
      actionId: null,
      resourceId: instance.id,
      requestId: instance.id,
      state:
        instance.status.toLowerCase() === "active"
          ? "SUCCEEDED"
          : "SUBMITTED",
      submittedAt: new Date(),
    };
  }

  async getTaskStatus(
    input: ProviderTaskLookup,
  ): Promise<ProviderTaskStatus> {
    if (!input.resourceId) {
      throw new InfrastructureError(
        "provider_not_found",
        "ParsPack resource id is required",
      );
    }
    const instance = await this.client.getInstance(input.resourceId);
    const status = instance.status.toLowerCase();
    return {
      taskId: input.taskId ?? null,
      actionId: null,
      resourceId: instance.id,
      requestId: instance.id,
      state:
        status === "active"
          ? "SUCCEEDED"
          : status === "failed" || status === "error"
            ? "FAILED"
            : "RUNNING",
      submittedAt: new Date(),
      checkedAt: new Date(),
    };
  }

  async findExistingResource(
    input: ReconciliationInput,
  ): Promise<ProviderResource | null> {
    const instance = input.providerResourceId
      ? await this.client.getInstance(input.providerResourceId)
      : await this.client.findInstanceByName(input.expectedName);
    if (!instance) return null;
    return {
      id: instance.id,
      name: instance.name,
      region: instance.region,
      state: instance.status,
      ipv4: instance.ipv4,
      networkIds: null,
      securityIds: null,
      observedAt: new Date(),
      rawPayload: {
        id: instance.id,
        name: instance.name,
        status: instance.status,
      },
    };
  }

  private unsupported(): never {
    throw new InfrastructureError(
      "provider_operation_unsupported",
      "ParsPack lifecycle operation is not enabled",
    );
  }

  async powerOn(input: ProviderResourceInput): Promise<ProviderTask> {
    void input;
    return this.unsupported();
  }

  async powerOff(input: ProviderResourceInput): Promise<ProviderTask> {
    void input;
    return this.unsupported();
  }

  async reboot(input: ProviderResourceInput): Promise<ProviderTask> {
    void input;
    return this.unsupported();
  }

  async resize(input: ProviderResizeInput): Promise<ProviderTask> {
    void input;
    return this.unsupported();
  }

  async terminate(input: ProviderResourceInput): Promise<ProviderTask> {
    void input;
    return this.unsupported();
  }
}
