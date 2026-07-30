import type {
  InfrastructureProductKind,
  InfrastructureProvider,
} from "@prisma/client";

export type ProviderRegion = {
  code: string;
  name: string;
  available: boolean;
  rawPayload: Record<string, unknown>;
  providerRequestId?: string;
};

export type ProviderPlan = {
  externalPlanId: string;
  region: string;
  name: string;
  vcpu: number | null;
  ramMb: number | null;
  diskGb: number | null;
  resourceContractValid: boolean;
  resourceContractError?: string | null;
  available: boolean;
  priceHourlyIrr: bigint | null;
  priceMonthlyIrr: bigint | null;
  sourceMoneyUnit: string;
  rawUpdatedAt: Date | null;
  rawPayload: Record<string, unknown>;
  providerRequestId?: string;
};

export type ProviderImage = {
  externalId: string;
  region: string;
  name: string;
  operatingSystem: string | null;
  minDiskGb: number | null;
  minRamMb: number | null;
  available: boolean;
  sshKeySupported: boolean | null;
  sshPasswordSupported: boolean | null;
  rawUpdatedAt: Date | null;
  rawPayload: Record<string, unknown>;
  providerRequestId?: string;
};

export type ProviderNetwork = {
  externalId: string;
  region: string;
  name: string;
  isDefault?: boolean;
  available: boolean;
  rawUpdatedAt: Date | null;
  rawPayload: Record<string, unknown>;
  providerRequestId?: string;
};

export type ProviderSecurity = {
  externalId: string;
  region: string;
  name: string;
  isDefault?: boolean;
  available: boolean;
  rawUpdatedAt: Date | null;
  rawPayload: Record<string, unknown>;
  providerRequestId?: string;
};

export type ProviderSelection = {
  productKind: InfrastructureProductKind;
  region: string;
  externalPlanId: string;
  externalImageId: string;
  externalNetworkId?: string | null;
  externalSecurityId?: string | null;
};

export type ProviderSelectionDefaults = {
  region: string;
  externalNetworkId: string;
  externalSecurityId: string;
  checkedAt: Date;
  providerRequestIds: string[];
};

export type ValidationResult =
  | { valid: true; checkedAt: Date }
  | {
      valid: false;
      checkedAt: Date;
      code:
        | "region_unavailable"
        | "plan_unavailable"
        | "invalid_resource_contract"
        | "invalid_price"
        | "image_incompatible"
        | "network_unavailable"
        | "security_unavailable"
        | "product_kind_mismatch";
    };

export type ProviderPriceSnapshot = {
  provider: InfrastructureProvider;
  apiVersion: string;
  productKind: InfrastructureProductKind;
  region: string;
  externalPlanId: string;
  hourlyPriceIrr: bigint | null;
  monthlyPriceIrr: bigint;
  currency: "IRR";
  available: true;
  checkedAt: Date;
  providerRequestId?: string;
  rawPayload: Record<string, unknown>;
};

export type CreateServerInput = ProviderSelection & {
  name: string;
  orderPublicId: string;
  idempotencyKey: string;
  diskSizeGb?: number | null;
  sshKeyEnabled?: boolean;
  sshKeyName?: string | null;
  initScript?: string | null;
};

export type ProviderTask = {
  taskId: string | null;
  actionId: string | null;
  resourceId: string | null;
  requestId: string | null;
  state: "SUBMITTED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  submittedAt: Date;
};

export type ProviderTaskLookup = {
  region: string;
  taskId?: string | null;
  resourceId?: string | null;
};

export type ProviderTaskStatus = ProviderTask & {
  failureCode?: string | null;
  checkedAt: Date;
};

export type ReconciliationInput = {
  region: string;
  orderPublicId: string;
  expectedName: string;
  providerResourceId?: string | null;
};

export type ProviderResource = {
  id: string;
  name: string;
  region: string;
  state: string;
  ipv4: string | null;
  rawPayload: Record<string, unknown>;
};

export type ProviderResourceInput = {
  region: string;
  resourceId: string;
  idempotencyKey: string;
};

export type ProviderResizeInput = ProviderResourceInput & {
  externalPlanId: string;
};

export interface CloudProviderAdapter {
  readonly provider: InfrastructureProvider;
  readonly apiVersion: string;

  syncRegions(): Promise<ProviderRegion[]>;
  syncPlans(region: string): Promise<ProviderPlan[]>;
  syncImages(region: string): Promise<ProviderImage[]>;
  syncNetworks(region: string): Promise<ProviderNetwork[]>;
  syncSecurity(region: string): Promise<ProviderSecurity[]>;
  resolveSelectionDefaults(
    region: string,
  ): Promise<ProviderSelectionDefaults>;

  validateSelection(input: ProviderSelection): Promise<ValidationResult>;
  refreshPrice(input: ProviderSelection): Promise<ProviderPriceSnapshot>;

  createServer(input: CreateServerInput): Promise<ProviderTask>;
  getTaskStatus(input: ProviderTaskLookup): Promise<ProviderTaskStatus>;
  findExistingResource(
    input: ReconciliationInput,
  ): Promise<ProviderResource | null>;

  powerOn(input: ProviderResourceInput): Promise<ProviderTask>;
  powerOff(input: ProviderResourceInput): Promise<ProviderTask>;
  reboot(input: ProviderResourceInput): Promise<ProviderTask>;
  resize(input: ProviderResizeInput): Promise<ProviderTask>;
  terminate(input: ProviderResourceInput): Promise<ProviderTask>;
}
