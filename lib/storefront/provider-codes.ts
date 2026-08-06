import type { InfrastructureProvider } from "@prisma/client";

/**
 * Internal SKU code fragment only (e.g. SF_AV_…).
 * Never render these codes (or supplier brand names) on customer surfaces.
 */
export type StorefrontProviderCode = "AV" | "PP";

export function storefrontProviderCode(
  provider: InfrastructureProvider | "ARVAN" | "PARSPACK",
): StorefrontProviderCode {
  return provider === "PARSPACK" ? "PP" : "AV";
}

/** Admin-only full provider names. Never use on customer UI. */
export function adminProviderLabel(
  provider: InfrastructureProvider | "ARVAN" | "PARSPACK" | string,
) {
  if (provider === "PARSPACK" || provider === "PP") return "ParsPack";
  if (provider === "ARVAN" || provider === "AV") return "Arvan";
  return provider;
}
