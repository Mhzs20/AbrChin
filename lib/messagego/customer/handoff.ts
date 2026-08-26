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

export type ProviderSecretHandoffRequest = {
  accountId: string;
  productId: string;
  workspaceId: string;
  ownershipMode: OwnershipMode;
  familyAlias: StableFamilyAlias;
  plaintext: string;
};

export type ProviderSecretHandoffResult = {
  secretRef: string;
};

export type ProviderSecretHandoffPort = {
  readonly name: string;
  handoff(input: ProviderSecretHandoffRequest): Promise<ProviderSecretHandoffResult>;
};

export class HandoffError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "HandoffError";
    this.code = code;
  }
}

export class FailClosedSecretHandoffPort implements ProviderSecretHandoffPort {
  readonly name = "fail_closed";

  async handoff(): Promise<ProviderSecretHandoffResult> {
    throw new HandoffError(
      "handoff_unavailable",
      "One-time provider secret handoff to MessageGo is not configured; fail closed",
    );
  }
}

export class MemorySecretHandoffPort implements ProviderSecretHandoffPort {
  readonly name = "memory_test";
  private readonly secrets = new Map<string, string>();
  private next = 0;

  async handoff(input: ProviderSecretHandoffRequest): Promise<ProviderSecretHandoffResult> {
    const plaintext = input.plaintext.trim();
    if (!plaintext || plaintext.length > 16 * 1024 || /[\r\n\0]/.test(plaintext)) {
      throw new HandoffError("invalid_secret", "Provider credential is invalid");
    }
    this.next += 1;
    const secretRef = `sec_test_${this.next}`;
    this.secrets.set(secretRef, plaintext);
    return { secretRef };
  }

  /** Test-only resolver. Ordinary AbrChin APIs must never call this. */
  resolveForTest(secretRef: string) {
    return this.secrets.get(secretRef) ?? null;
  }
}

let testMemoryPort: MemorySecretHandoffPort | null = null;

export function getProviderSecretHandoffPort(): ProviderSecretHandoffPort {
  if (process.env.NODE_ENV === "production") {
    return new FailClosedSecretHandoffPort();
  }
  if (
    process.env.ABRCHIN_ISOLATED_TEST === "1" &&
    process.env.MESSAGEGO_SECRET_HANDOFF_MODE === "memory_test"
  ) {
    testMemoryPort ??= new MemorySecretHandoffPort();
    return testMemoryPort;
  }
  return new FailClosedSecretHandoffPort();
}

export function isStableFamilyAlias(value: string): value is StableFamilyAlias {
  return (STABLE_FAMILY_ALIASES as readonly string[]).includes(value);
}
