import "server-only";

import { getEnv } from "@/lib/env";

export { isMessageGoConfigured } from "@/lib/messagego/config";

export type MessageGoTaskClass =
  | "fast"
  | "standard"
  | "reasoning"
  | "structured"
  | "tool"
  | "vision";

export type MessageGoConversation = {
  id: string;
  title: string;
  status: string;
};

export type MessageGoMessageResult = {
  user_message: { id: string; content?: string };
  assistant_message: {
    id: string;
    content: string;
    blocks?: unknown[];
  };
  usage?: {
    input_text_tokens?: number;
    cached_input_tokens?: number;
    cache_write_input_tokens?: number;
    output_text_tokens?: number;
  };
  replayed?: boolean;
};

type TokenExchangeResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string[];
};

type MessageGoConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  tenantId: string;
  workspaceId: string;
  timeoutMs: number;
};

const conversationScopes = [
  "conversation:read",
  "conversation:write",
  "conversation:realtime",
] as const;

function messageGoConfig(): MessageGoConfig {
  const env = getEnv();
  const config: MessageGoConfig = {
    baseUrl: env.messageGoBaseUrl.replace(/\/+$/, ""),
    clientId: env.messageGoClientId.trim(),
    clientSecret: env.messageGoClientSecret,
    tenantId: env.messageGoTenantId.trim(),
    workspaceId: env.messageGoWorkspaceId.trim(),
    timeoutMs: env.messageGoTimeoutMs,
  };

  if (
    !config.baseUrl ||
    !config.clientId ||
    !config.clientSecret ||
    !config.tenantId ||
    !config.workspaceId
  ) {
    throw new Error("messagego_not_configured");
  }

  let url: URL;
  try {
    url = new URL(config.baseUrl);
  } catch {
    throw new Error("messagego_invalid_base_url");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "") ||
    (env.isProduction
      ? url.protocol !== "https:"
      : !["http:", "https:"].includes(url.protocol))
  ) {
    throw new Error("messagego_invalid_base_url");
  }
  if (
    config.clientSecret.length < 32 ||
    config.clientSecret.includes("\n") ||
    config.clientSecret.includes("\r")
  ) {
    throw new Error("messagego_invalid_client_secret");
  }
  return config;
}

function requestHeaders(input?: HeadersInit) {
  const headers = new Headers(input);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  return headers;
}

async function requestJson<T>(
  config: MessageGoConfig,
  path: string,
  init: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      headers: requestHeaders(init.headers),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(`messagego_auth_${response.status}`);
      }
      throw new Error(`messagego_http_${response.status}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new Error("messagego_invalid_response");
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function exchangeAccessToken(subjectId: string) {
  const config = messageGoConfig();
  const subject = subjectId.trim();
  if (!subject || subject.length > 200 || /[\r\n\0]/.test(subject)) {
    throw new Error("messagego_invalid_subject");
  }

  const basic = Buffer.from(
    `${config.clientId}:${config.clientSecret}`,
    "utf8",
  ).toString("base64");
  const token = await requestJson<TokenExchangeResponse>(config, "/v1/auth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "client_credentials",
      tenant_id: config.tenantId,
      workspace_id: config.workspaceId,
      subject_id: subject,
      scope: [...conversationScopes],
    }),
  });

  if (
    token.token_type !== "Bearer" ||
    typeof token.access_token !== "string" ||
    token.access_token.length < 20 ||
    !Number.isInteger(token.expires_in) ||
    token.expires_in <= 0 ||
    token.expires_in > 900 ||
    !Array.isArray(token.scope)
  ) {
    throw new Error("messagego_invalid_token_response");
  }
  return { config, accessToken: token.access_token };
}

async function authenticatedJson<T>(
  subjectId: string,
  path: string,
  init: RequestInit = {},
) {
  const { config, accessToken } = await exchangeAccessToken(subjectId);
  const headers = requestHeaders(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  return requestJson<T>(config, path, {
    ...init,
    headers,
  });
}

export async function checkMessageGoConnection() {
  const result = await authenticatedJson<{ items?: unknown[] }>(
    "abrchin-connection-check",
    "/v1/conversations?limit=1&status=active",
  );
  if (!Array.isArray(result.items)) {
    throw new Error("messagego_invalid_response");
  }
  return { ok: true as const };
}

export async function createMessageGoConversation(
  subjectId: string,
  title: string,
): Promise<MessageGoConversation> {
  const value = title.trim();
  if (!value) throw new Error("messagego_title_required");
  return authenticatedJson<MessageGoConversation>(subjectId, "/v1/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: value }),
  });
}

export async function sendMessageGoMessage(
  subjectId: string,
  conversationId: string,
  input: {
    content: string;
    taskClass?: MessageGoTaskClass;
    requestedOutputTokens?: number;
    outputContractId?: string;
    idempotencyKey: string;
  },
): Promise<MessageGoMessageResult> {
  const conversation = conversationId.trim();
  const content = input.content.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (!conversation || !content || !idempotencyKey) {
    throw new Error("messagego_invalid_message_request");
  }
  if (
    input.requestedOutputTokens !== undefined &&
    (!Number.isInteger(input.requestedOutputTokens) ||
      input.requestedOutputTokens < 1 ||
      input.requestedOutputTokens > 128_000)
  ) {
    throw new Error("messagego_invalid_output_limit");
  }

  return authenticatedJson<MessageGoMessageResult>(
    subjectId,
    `/v1/conversations/${encodeURIComponent(conversation)}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        content,
        task_class: input.taskClass ?? "standard",
        ...(input.requestedOutputTokens !== undefined
          ? { requested_output_tokens: input.requestedOutputTokens }
          : {}),
        ...(input.outputContractId?.trim()
          ? { output_contract_id: input.outputContractId.trim() }
          : {}),
      }),
    },
  );
}
