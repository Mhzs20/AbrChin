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
  PROVIDER_PRICE_SCALE,
} from "@/lib/pricing/provider-pricing";

export const PARSPACK_UNSCOPED_REGION_CODE = "__unscoped__";

function parsPackSizeRegions(
  catalog: ProviderCatalog,
  size: ProviderCatalog["sizes"][number],
): string[] {
  return [
    ...new Set(
      [
        ...(size.regionCodes ?? []),
        ...(size.regionCode ? [size.regionCode] : []),
        ...catalog.regions
          .filter((region) => region.sizeCodes?.includes(size.code))
          .map((region) => region.code),
      ].filter(Boolean),
    ),
  ];
}

function validateParsPackCatalogRelationships(catalog: ProviderCatalog): void {
  const regionCodes = new Set(catalog.regions.map((region) => region.code));
  const sizeCodes = new Set(catalog.sizes.map((size) => size.code));
  const imageCodes = new Set(catalog.images.map((image) => image.code));
  if (
    regionCodes.size !== catalog.regions.length ||
    sizeCodes.size !== catalog.sizes.length ||
    imageCodes.size !== catalog.images.length
  ) {
    throw new InfrastructureError(
      "provider_invalid_response",
      "ParsPack catalog contains duplicate identities",
    );
  }
  const unknownRegion = (codes?: string[]) =>
    codes?.some((code) => !regionCodes.has(code)) === true;
  if (
    catalog.regions.some((region) =>
      region.sizeCodes?.some((code) => !sizeCodes.has(code)),
    ) ||
    catalog.sizes.some(
      (size) =>
        (size.regionCode != null && !regionCodes.has(size.regionCode)) ||
        unknownRegion(size.regionCodes),
    ) ||
    catalog.images.some((image) => unknownRegion(image.regionCodes))
  ) {
    throw new InfrastructureError(
      "provider_invalid_response",
      "ParsPack catalog relationships are invalid",
    );
  }
}

function parseProviderDate(value?: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function positiveInteger(value: number | undefined): number | null {
  return value != null && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

export class ParsPackV1Adapter implements CloudProviderAdapter {
  readonly provider = InfrastructureProvider.PARSPACK;
  readonly apiVersion = "v1";
  readonly topologyVerificationMode = "PROVIDER_MANAGED" as const;
  readonly billingPolicy = {
    verificationStatus: "UNVERIFIED",
    settlementSupported: false,
    calculationUnit: "UNVERIFIED",
    minimumChargeSeconds: null,
    roundingPolicy: "UNVERIFIED",
    prorationSupported: null,
    hourlyRateAvailable: true,
    dailyRateAvailable: false,
    stopStateBillableComponents: {
      compute: "UNVERIFIED",
      disk: "UNVERIFIED",
      ip: "UNVERIFIED",
      backup: "UNVERIFIED",
      traffic: "UNVERIFIED",
      snapshot: "UNVERIFIED",
    },
  } as const;
  private catalogPromise: Promise<ProviderCatalog> | null = null;
  private readonly client: ParsPackProvider;

  constructor(client: ParsPackProvider) {
    this.client = client;
  }

  private catalog(refresh = false): Promise<ProviderCatalog> {
    if (refresh || !this.catalogPromise) {
      this.catalogPromise = this.client.syncCatalog().then((catalog) => {
        validateParsPackCatalogRelationships(catalog);
        return catalog;
      });
    }
    return this.catalogPromise;
  }

  async syncRegions(): Promise<ProviderRegion[]> {
    const catalog = await this.catalog(true);
    const regions: ProviderRegion[] = catalog.regions.map((region) => ({
      code: region.code,
      name: region.name,
      available: region.available === true,
      rawPayload: { ...region },
    }));
    if (
      catalog.sizes.some(
        (size) => parsPackSizeRegions(catalog, size).length === 0,
      )
    ) {
      regions.push({
        code: PARSPACK_UNSCOPED_REGION_CODE,
        name: "Unscoped provider plans",
        available: false,
        rawPayload: {
          code: PARSPACK_UNSCOPED_REGION_CODE,
          source: "provider_region_unspecified",
        },
      });
    }
    if (regions.length === 0) {
      throw new InfrastructureError(
        "provider_invalid_response",
        "ParsPack catalog contains no regions",
      );
    }
    return regions;
  }

  async syncPlans(region: string): Promise<ProviderPlan[]> {
    const catalog = await this.catalog();
    const contract = normalizeProviderPriceContract(catalog.priceContract);
    return catalog.sizes
      .filter((size) => {
        const regions = parsPackSizeRegions(catalog, size);
        return region === PARSPACK_UNSCOPED_REGION_CODE
          ? regions.length === 0
          : regions.includes(region);
      })
      .map((size) => {
        const toSourceAmount = (raw?: string): bigint | null => {
          if (!raw) return null;
          try {
            const amount = decimalToScaledInteger(raw);
            return amount > 0n ? amount : null;
          } catch {
            return null;
          }
        };
        const toIrr = (amount: bigint | null): bigint | null => {
          if (amount == null || !contract) return null;
          try {
            return providerAmountToRial({
              scaledAmount: amount,
              scale: PROVIDER_PRICE_SCALE,
              contract,
            });
          } catch {
            return null;
          }
        };
        const priceHourlyAmount = toSourceAmount(size.priceHourly);
        const priceMonthlyAmount = toSourceAmount(size.priceMonthly);
        const priceHourlyIrr = toIrr(priceHourlyAmount);
        const priceMonthlyIrr = toIrr(priceMonthlyAmount);
        const vcpu = positiveInteger(size.vcpu);
        const ramMb = positiveInteger(size.memoryMb);
        const diskGb = positiveInteger(size.diskGb);
        const resourceContractValid =
          vcpu != null &&
          vcpu > 0 &&
          ramMb != null &&
          ramMb > 0 &&
          diskGb != null &&
          diskGb > 0;
        return {
          externalPlanId: size.code,
          region,
          name: size.name,
          vcpu,
          ramMb,
          diskGb,
          transfer:
            size.transfer == null ? null : String(size.transfer),
          resourceContractValid,
          resourceContractError: resourceContractValid
            ? null
            : "invalid_resource_dimensions",
          available: size.available === true,
          priceHourlyAmount,
          priceMonthlyAmount,
          priceScale: PROVIDER_PRICE_SCALE,
          currencyCode: contract?.currencyCode ?? null,
          amountUnit: contract?.amountUnit ?? null,
          priceHourlyIrr,
          priceMonthlyIrr,
          sourceMoneyUnit: contract?.amountUnit ?? "UNCONFIRMED",
          rawUpdatedAt: parseProviderDate(size.rawUpdatedAt),
          rawPayload: { ...size },
        };
      });
  }

  async syncImages(region: string): Promise<ProviderImage[]> {
    const catalog = await this.catalog();
    return catalog.images
      .filter(
        (image) =>
          region === PARSPACK_UNSCOPED_REGION_CODE ||
          !image.regionCodes?.length ||
          image.regionCodes.includes(region),
      )
      .map((image) => ({
        externalId: image.code,
        region,
        name: image.name,
        operatingSystem: image.osFamily ?? null,
        minDiskGb: image.minDiskGb ?? null,
        minRamMb: null,
        available:
          image.status != null &&
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
      externalNetworkId: null,
      externalSecurityId: null,
      topologyVerificationMode: this.topologyVerificationMode,
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
      externalPlanId: null,
      externalImageId: null,
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
