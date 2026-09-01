export const STABLE_FAMILY_ALIASES = [
  "openai",
  "openai-compatible",
  "anthropic",
  "gemini",
  "arvan",
  "future_explicitly_approved",
] as const;

export type StableFamilyAlias = (typeof STABLE_FAMILY_ALIASES)[number];

export type OwnershipMode = "PLATFORM_MANAGED" | "ACCOUNT_BYOK" | "PROJECT_BYOK";

export function isStableFamilyAlias(value: string): value is StableFamilyAlias {
  return (STABLE_FAMILY_ALIASES as readonly string[]).includes(value);
}
