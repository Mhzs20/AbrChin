import type {
  InfrastructureProductKind,
  InfrastructureProvider,
} from "@prisma/client";

import type {
  CloudProviderAdapter,
  ProviderPriceSnapshot,
  ProviderSelection,
  ProviderSelectionDefaults,
} from "@/lib/infrastructure/cloud-provider-adapter";
import { InfrastructureError } from "@/lib/infrastructure/errors";
import { createCloudProviderAdapter } from "@/lib/infrastructure/provider-factory";
import { assertProviderRoute } from "@/lib/infrastructure/provider-routing";

export type LockedProviderSelection = ProviderSelection & {
  provider: InfrastructureProvider;
  providerApiVersion: string;
};

export async function resolveProviderSelectionDefaults(input: {
  provider: InfrastructureProvider;
  providerApiVersion: string;
  productKind: InfrastructureProductKind;
  region: string;
}): Promise<ProviderSelectionDefaults> {
  assertProviderRoute({
    productKind: input.productKind,
    provider: input.provider,
    apiVersion: input.providerApiVersion,
  });
  return createCloudProviderAdapter(
    input.provider,
    input.providerApiVersion,
  ).resolveSelectionDefaults(input.region);
}

export async function revalidateLockedSelection(
  input: LockedProviderSelection,
  adapterOverride?: CloudProviderAdapter,
): Promise<ProviderPriceSnapshot> {
  assertProviderRoute({
    productKind: input.productKind,
    provider: input.provider,
    apiVersion: input.providerApiVersion,
  });
  const adapter =
    adapterOverride ??
    createCloudProviderAdapter(
      input.provider,
      input.providerApiVersion,
    );
  if (
    adapter.provider !== input.provider ||
    adapter.apiVersion !== input.providerApiVersion
  ) {
    throw new InfrastructureError(
      "provider_route_mismatch",
      "Provider revalidation must use the locked route",
    );
  }
  const validation = await adapter.validateSelection(input);
  if (!validation.valid) {
    throw new InfrastructureError(
      "provider_selection_invalid",
      `Provider selection is not sellable: ${validation.code}`,
    );
  }
  const price = await adapter.refreshPrice(input);
  if (
    !price.available ||
    price.monthlyPriceIrr <= 0n ||
    (input.productKind === "CLOUD_SERVER" &&
      (price.hourlyPriceIrr == null || price.hourlyPriceIrr <= 0n)) ||
    price.currency !== "IRR"
  ) {
    throw new InfrastructureError(
      "provider_price_invalid",
      "Provider price is unavailable",
    );
  }
  return price;
}
