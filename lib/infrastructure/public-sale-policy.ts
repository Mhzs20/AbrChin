import {
  InfrastructureOfferSource,
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
};

export type PublicSaleDecision = {
  allowed: boolean;
  code: "sale_enabled" | "provider_sale_disabled" | "provider_provisioning_not_enabled";
};

export function getPublicSaleDecision(route: SaleRoute): PublicSaleDecision {
  if (route.provider !== InfrastructureProvider.ARVAN) {
    return { allowed: true, code: "sale_enabled" };
  }
  const env = getEnv();
  if (!env.arvanPublicSaleEnabled) {
    return { allowed: false, code: "provider_sale_disabled" };
  }
  if (
    route.offerSource !==
      InfrastructureOfferSource.PREPROVISIONED_INVENTORY &&
    !env.arvanMutationsEnabled
  ) {
    return {
      allowed: false,
      code: "provider_provisioning_not_enabled",
    };
  }
  return { allowed: true, code: "sale_enabled" };
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
      "فروش عمومی سرورهای ابری موقتاً غیرفعال است؛ مبلغی برداشت نشد.",
    );
  }
  throw new WalletError(
    decision.code,
    "ساخت این سرور هنوز برای پرداخت فعال نشده است؛ مبلغی برداشت نشد.",
  );
}
