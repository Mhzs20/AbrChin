import {
  InfrastructureOfferSource,
  InfrastructureProductKind,
  InfrastructureProvider,
} from "@prisma/client";

import { getEnv } from "@/lib/env";
import { InfrastructureError } from "@/lib/infrastructure/errors";
import { WalletError } from "@/lib/wallet/errors";

type SaleRoute = {
  provider: InfrastructureProvider | "ARVAN";
  offerSource:
    | InfrastructureOfferSource
    | "API_CATALOG"
    | "MANUAL_API_BACKED"
    | "PREPROVISIONED_INVENTORY";
  productKind?: InfrastructureProductKind | "READY_INSTANT_SERVER" | "CLOUD_SERVER";
};

export type PublicSaleDecision = {
  allowed: boolean;
  code:
    | "sale_enabled"
    | "public_sale_disabled"
    | "provider_sale_disabled";
};

export function getPublicSaleDecision(route: SaleRoute): PublicSaleDecision {
  const env = getEnv();
  if (!env.publicSaleEnabled) {
    return { allowed: false, code: "public_sale_disabled" };
  }
  if (route.offerSource === InfrastructureOfferSource.PREPROVISIONED_INVENTORY) {
    // A verified AbrChin-owned resource does not require a provider mutation.
    // It may be sold for either catalog product kind, but remains separately
    // launch-gated and is never the default launch dependency.
    return env.manualReadyPublicSaleEnabled
      ? { allowed: true, code: "sale_enabled" }
      : { allowed: false, code: "provider_sale_disabled" };
  }
  if (route.offerSource === InfrastructureOfferSource.MANUAL_ADMIN) {
    return route.productKind === InfrastructureProductKind.READY_INSTANT_SERVER &&
      env.manualReadyPublicSaleEnabled
      ? { allowed: true, code: "sale_enabled" }
      : { allowed: false, code: "provider_sale_disabled" };
  }
  if (route.provider === InfrastructureProvider.ARVAN) {
    if (!env.arvanPublicSaleEnabled) {
      return { allowed: false, code: "provider_sale_disabled" };
    }
    const productGate =
      route.productKind === InfrastructureProductKind.READY_INSTANT_SERVER
        ? env.arvanReadyPublicSaleEnabled
        : env.arvanCloudPublicSaleEnabled;
    if (!productGate) {
      return { allowed: false, code: "provider_sale_disabled" };
    }
    return { allowed: true, code: "sale_enabled" };
  }
  return { allowed: false, code: "provider_sale_disabled" };
}

export function isPublicSaleEnabled(route: SaleRoute) {
  return getPublicSaleDecision(route).allowed;
}

export function assertPublicSaleEnabled(route: SaleRoute) {
  const decision = getPublicSaleDecision(route);
  if (decision.allowed) return;
  throw new WalletError(
    decision.code,
    decision.code === "public_sale_disabled"
      ? "فروش عمومی ابرچین هنوز فعال نشده است؛ مبلغی برداشت نشد."
      : route.offerSource === InfrastructureOfferSource.MANUAL_ADMIN ||
      route.offerSource === InfrastructureOfferSource.PREPROVISIONED_INVENTORY
      ? "فروش عمومی موجودی آمادهٔ ابرچین موقتاً غیرفعال است؛ مبلغی برداشت نشد."
      : "فروش عمومی این راهکار موقتاً غیرفعال است؛ مبلغی برداشت نشد.",
  );
}

export function customerErrorForProviderFailure(error: unknown): WalletError | null {
  if (
    error instanceof InfrastructureError &&
    (error.code === "provider_disabled" ||
      error.code === "provider_version_disabled")
  ) {
    return new WalletError(
      "provider_sale_disabled",
      "فروش عمومی این راهکار موقتاً غیرفعال است؛ مبلغی برداشت نشد.",
    );
  }
  return null;
}

export function rethrowProviderFailureForCustomer(error: unknown): never {
  throw customerErrorForProviderFailure(error) ?? error;
}
