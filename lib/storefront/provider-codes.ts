import type { InfrastructureProvider } from "@prisma/client";

/** Opaque storefront/admin codes — never expand to supplier brand names for customers. */
export type StorefrontProviderCode = "AV" | "PP";

export function storefrontProviderCode(
  provider: InfrastructureProvider | "ARVAN" | "PARSPACK",
): StorefrontProviderCode {
  return provider === "PARSPACK" ? "PP" : "AV";
}

export function storefrontProviderCodeLabel(code: StorefrontProviderCode) {
  return code;
}
