import {
  InfrastructureOfferSource,
  InfrastructureProductKind,
  InfrastructureProvider,
} from "@prisma/client";

import { getEnv } from "@/lib/env";
import { WalletError } from "@/lib/wallet/errors";

type SaleRoute = {
  provider: InfrastructureProvider | "ARVAN" | "PARSPACK";
  offerSource:
    | InfrastructureOfferSource
    | "API_CATALOG"
    | "MANUAL_API_BACKED"
    | "PREPROVISIONED_INVENTORY";
  productKind?: InfrastructureProductKind | "READY_INSTANT_SERVER" | "CLOUD_SERVER";
};

export type PublicSaleDecision = {
  allowed: boolean;
  code: "sale_enabled" | "provider_sale_disabled" | "provider_provisioning_not_enabled";
};

export function getPublicSaleDecision(route: SaleRoute): PublicSaleDecision {
  const env = getEnv();
  if (
    route.offerSource === InfrastructureOfferSource.MANUAL_ADMIN ||
    route.offerSource === InfrastructureOfferSource.PREPROVISIONED_INVENTORY
  ) {
    return route.productKind === InfrastructureProductKind.READY_INSTANT_SERVER &&
      env.manualReadyPublicSaleEnabled
      ? { allowed: true, code: "sale_enabled" }
      : { allowed: false, code: "provider_sale_disabled" };
  }
  if (route.provider === InfrastructureProvider.PARSPACK) {
    if (!env.parspackPublicSaleEnabled) {
      return { allowed: false, code: "provider_sale_disabled" };
    }
    return env.parspackMutationsEnabled
      ? { allowed: true, code: "sale_enabled" }
      : { allowed: false, code: "provider_provisioning_not_enabled" };
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
    if (!env.arvanMutationsEnabled) {
      return {
        allowed: false,
        code: "provider_provisioning_not_enabled",
      };
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
  if (decision.code === "provider_sale_disabled") {
    throw new WalletError(
      decision.code,
      route.provider === InfrastructureProvider.PARSPACK
        ? "فروش عمومی سرورهای فوری موقتاً غیرفعال است؛ مبلغی برداشت نشد."
        : route.offerSource === InfrastructureOfferSource.MANUAL_ADMIN ||
            route.offerSource === InfrastructureOfferSource.PREPROVISIONED_INVENTORY
          ? "فروش عمومی موجودی آمادهٔ ابرچین موقتاً غیرفعال است؛ مبلغی برداشت نشد."
          : "فروش عمومی این مسیر آروان موقتاً غیرفعال است؛ مبلغی برداشت نشد.",
    );
  }
  throw new WalletError(
    decision.code,
    "ساخت این سرور هنوز برای پرداخت فعال نشده است؛ مبلغی برداشت نشد.",
  );
}
