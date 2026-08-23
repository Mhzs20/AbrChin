import {
  InfrastructureProductKind,
  InfrastructureProvider,
} from "@prisma/client";

import { InfrastructureError } from "@/lib/infrastructure/errors";

export const API_CATALOG_VERSIONS = {
  [InfrastructureProvider.ARVAN]: "v1",
} as const;

export type LockedProviderRoute = {
  productKind: InfrastructureProductKind;
  provider: InfrastructureProvider;
  apiVersion: "v1";
};

export function resolveProviderRoute(
  productKind: InfrastructureProductKind,
  provider?: InfrastructureProvider,
): LockedProviderRoute {
  const resolvedProvider =
    productKind === InfrastructureProductKind.CLOUD_SERVER
      ? InfrastructureProvider.ARVAN
      : provider ?? InfrastructureProvider.ARVAN;
  if (resolvedProvider !== InfrastructureProvider.ARVAN) {
    throw new InfrastructureError(
      "provider_route_mismatch",
      "Provider is not allowed for this product kind",
    );
  }
  return {
    productKind,
    provider: resolvedProvider,
    apiVersion: API_CATALOG_VERSIONS[resolvedProvider],
  };
}

export function assertProviderRoute(input: {
  productKind: InfrastructureProductKind;
  provider: InfrastructureProvider;
  apiVersion: string;
}): LockedProviderRoute {
  const route = resolveProviderRoute(input.productKind, input.provider);
  if (
    input.provider !== route.provider ||
    input.apiVersion.trim().toLowerCase() !== route.apiVersion
  ) {
    throw new InfrastructureError(
      "provider_route_mismatch",
      "Provider is not allowed for this product kind",
    );
  }
  return route;
}

export function catalogExternalKey(input: {
  provider: InfrastructureProvider;
  apiVersion: string;
  region: string;
  externalPlanId: string;
}): string {
  const apiVersion = input.apiVersion.trim().toLowerCase();
  const region = input.region.trim();
  const planId = input.externalPlanId.trim();
  if (!apiVersion || !region || !planId) {
    throw new Error("invalid_catalog_identity");
  }
  return `${input.provider.toLowerCase()}:${apiVersion}:${region}:${planId}`;
}

export function isProviderLockedSnapshot(input: {
  productKind: InfrastructureProductKind;
  provider: InfrastructureProvider;
  providerApiVersion: string;
}): boolean {
  try {
    assertProviderRoute({
      productKind: input.productKind,
      provider: input.provider,
      apiVersion: input.providerApiVersion,
    });
    return true;
  } catch {
    return false;
  }
}
