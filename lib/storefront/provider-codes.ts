import type { InfrastructureProvider } from "@prisma/client";

/**
 * Internal SKU code fragment only (e.g. SF_AV_…).
 * Never render these codes (or supplier brand names) on customer surfaces.
 */
export type StorefrontProviderCode = "AV";

export function storefrontProviderCode(
  _provider: InfrastructureProvider | "ARVAN",
): StorefrontProviderCode {
  return "AV";
}

/** Admin-only full provider names. Never use on customer UI. */
export function adminProviderLabel(
  provider: InfrastructureProvider | "ARVAN" | string,
) {
  if (provider === "ARVAN" || provider === "AV") return "Arvan";
  return provider;
}
