import type { DeliveryMode, InfrastructureProvider } from "@prisma/client";

export type ProviderCatalog = {
  regions: Array<{ code: string; name: string }>;
  sizes: Array<{ code: string; name: string; regionCode?: string }>;
  images: Array<{ code: string; name: string; osFamily?: string }>;
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
  | "provider_ambiguous"
  | "provider_unavailable"
  | "provider_invalid_response";
