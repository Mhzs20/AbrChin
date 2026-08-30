import { getEnv } from "@/lib/env";

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

export class HmacSecretHandoffPort implements ProviderSecretHandoffPort {
  readonly name = "hmac_s2s";

  async handoff(input: ProviderSecretHandoffRequest): Promise<ProviderSecretHandoffResult> {
    const env = getEnv();
    if (!env.messageGoSecretHandoffEnabled) {
      throw new HandoffError(
        "handoff_unavailable",
        "One-time provider secret handoff to MessageGo is not configured; fail closed",
      );
    }
    const base = env.messageGoHandoffBaseUrl.replace(/\/$/, "");
    if (!base) {
      throw new HandoffError("handoff_unavailable", "MessageGo handoff base URL is not configured");
    }
    if (env.isProduction && !base.startsWith("https://")) {
      throw new HandoffError("handoff_unavailable", "MessageGo handoff URL must be HTTPS in production");
    }
    if (!env.messageGoS2SSigningKeyringFile) {
      throw new HandoffError("handoff_unavailable", "AbrChin→MessageGo signing keyring is not configured");
    }
    const plaintext = input.plaintext.trim();
    if (!plaintext || plaintext.length > 16 * 1024 || /[\r\n\0]/.test(plaintext)) {
      throw new HandoffError("invalid_secret", "Provider credential is invalid");
    }
    const bodyObject = {
      operation_id: `handoff:${input.accountId}:${input.productId}:${input.workspaceId}:${input.familyAlias}`,
      account_id: input.accountId,
      product_id: input.productId,
      workspace_id: input.workspaceId,
      ownership_mode: input.ownershipMode,
      family: familyToMessageGo(input.familyAlias),
      plaintext,
    };
    const body = Buffer.from(JSON.stringify(bodyObject));
    const { loadKeyringFile, signRequest, DIRECTION_ABRCHIN_TO_MESSAGEGO } = await import(
      "@/lib/messagego/s2s/hmac"
    );
    const ring = loadKeyringFile(env.messageGoS2SSigningKeyringFile);
    const headers = new Headers({ "content-type": "application/json" });
    const path = env.messageGoHandoffPath || "/internal/v2/handoff";
    signRequest(
      headers,
      ring,
      DIRECTION_ABRCHIN_TO_MESSAGEGO,
      env.messageGoS2SSigningServiceId,
      "POST",
      path,
      "",
      body,
      "MESSAGEGO-V2-SECRET-HANDOFF",
      "1.0.0",
    );
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers,
      body,
    });
    const json = (await response.json()) as { secret_ref?: string; error?: string };
    if (!response.ok || !json.secret_ref || typeof json.secret_ref !== "string") {
      throw new HandoffError("handoff_failed", "MessageGo rejected the provider secret handoff");
    }
    if (json.secret_ref === plaintext || JSON.stringify(json).includes(plaintext)) {
      throw new HandoffError("handoff_failed", "MessageGo response leaked credential material");
    }
    return { secretRef: json.secret_ref };
  }
}

function familyToMessageGo(alias: StableFamilyAlias) {
  switch (alias) {
    case "openai":
      return "openai_native";
    case "openai-compatible":
      return "openai_compatible_custom";
    case "anthropic":
      return "anthropic_claude_native";
    case "gemini":
      return "google_gemini_native";
    case "arvan":
      return "arvan_aiaas_native";
    default:
      return "future_explicitly_approved";
  }
}

let testMemoryPort: MemorySecretHandoffPort | null = null;

export function getProviderSecretHandoffPort(): ProviderSecretHandoffPort {
  const env = getEnv();
  if (env.isProduction && !env.messageGoSecretHandoffEnabled) {
    return new FailClosedSecretHandoffPort();
  }
  if (env.messageGoSecretHandoffEnabled && env.messageGoS2SSigningKeyringFile) {
    return new HmacSecretHandoffPort();
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
