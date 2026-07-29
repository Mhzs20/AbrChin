import type { DeliveryMode, InfrastructureProvider } from "@prisma/client";

export type ProviderCatalog = {
  priceContract: {
    currencyCode: string | null;
    amountUnit: string | null;
    confirmed: boolean;
  };
  regions: Array<{
    code: string;
    name: string;
    available?: boolean;
    sizeCodes?: string[];
    features?: string[];
  }>;
  sizes: Array<{
    code: string;
    name: string;
    regionCode?: string;
    regionCodes?: string[];
    available?: boolean;
    vcpu?: number;
    memoryMb?: number;
    diskGb?: number;
    priceHourly?: string;
    priceMonthly?: string;
    transfer?: number;
    rawUpdatedAt?: string;
  }>;
  images: Array<{
    code: string;
    name: string;
    osFamily?: string;
    regionCodes?: string[];
    minDiskGb?: number;
    status?: string;
  }>;
};

export type CreateInstanceInput = {
  name: string;
  region: string;
  size: string;
  image: string;
  deliveryMode: DeliveryMode;
};

export type ProviderInstance = {
  id: string;
  name: string;
  region: string;
  size: string;
  image: string;
  ipv4: string | null;
  status: string;
};

export type ProviderHealth = {
  ok: boolean;
  message: string;
  checkedAt: Date;
};

export interface InfrastructureProviderAdapter {
  readonly provider: InfrastructureProvider;
  checkConnection(): Promise<ProviderHealth>;
  syncCatalog(): Promise<ProviderCatalog>;
  createInstance(input: CreateInstanceInput): Promise<ProviderInstance>;
  getInstance(providerInstanceId: string): Promise<ProviderInstance>;
  findInstanceByName(name: string): Promise<ProviderInstance | null>;
}

export type ProviderErrorCode =
  | "provider_disabled"
  | "provider_timeout"
  | "provider_auth_failed"
  | "provider_insufficient_balance"
  | "provider_not_found"
  | "provider_ambiguous"
  | "provider_unavailable"
  | "provider_invalid_response";
