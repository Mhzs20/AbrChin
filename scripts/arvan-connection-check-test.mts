import assert from "node:assert/strict";
import test from "node:test";

import { checkArvanAuthenticatedConnection } from "../lib/infrastructure/arvan/connection-check.ts";

const input = {
  apiKey: "test-only-arvan-key",
  baseUrl: "https://napi.arvancloud.ir/ecc/v1",
  timeoutMs: 25,
};

function response(body: unknown, status = 200) {
  return new Response(
    typeof body === "string" ? body : JSON.stringify(body),
    {
      status,
      headers: {
        "content-type": "application/json",
        "x-request-id": "controlled-request",
      },
    },
  );
}

test("authenticated read-only Arvan connection succeeds with a valid region payload", async () => {
  let request: { url: string; init?: RequestInit } | null = null;
  const result = await checkArvanAuthenticatedConnection({
    ...input,
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return response({ data: [{ id: "ir-thr-ba1" }] });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "healthy");
  assert.equal(result.providerRequestId, "controlled-request");
  assert.equal(request?.url, "https://napi.arvancloud.ir/ecc/v1/regions");
  assert.equal(request?.init?.method, "GET");
  assert.equal(request?.init?.body, undefined);
  assert.equal(
    new Headers(request?.init?.headers).get("authorization"),
    "Apikey test-only-arvan-key",
  );
});

test("invalid Arvan API key cannot become healthy", async () => {
  const result = await checkArvanAuthenticatedConnection({
    ...input,
    fetchImpl: async () => response({ message: "secret provider text" }, 401),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_api_key");
  assert.equal(JSON.stringify(result).includes("secret provider text"), false);
});

test("forbidden Arvan response is distinct from an invalid API key", async () => {
  const result = await checkArvanAuthenticatedConnection({
    ...input,
    fetchImpl: async () => response({}, 403),
  });
  assert.equal(result.code, "forbidden");
});

test("Arvan timeout is classified without a live provider request", async () => {
  const result = await checkArvanAuthenticatedConnection({
    ...input,
    timeoutMs: 2,
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      });
    }),
  });
  assert.equal(result.code, "timeout");
});

test("Arvan rate limit remains distinguishable and retryable by the operator", async () => {
  const result = await checkArvanAuthenticatedConnection({
    ...input,
    fetchImpl: async () => response({}, 429),
  });
  assert.equal(result.code, "rate_limited");
});

test("invalid Arvan payload is not treated as proof of connection health", async () => {
  const result = await checkArvanAuthenticatedConnection({
    ...input,
    fetchImpl: async () => response({ data: [{ unexpected: true }] }),
  });
  assert.equal(result.code, "invalid_payload");
});

test("network errors are safe and the API key never leaks", async () => {
  const result = await checkArvanAuthenticatedConnection({
    ...input,
    fetchImpl: async () => {
      throw new Error(`network failed for ${input.apiKey}`);
    },
  });
  assert.equal(result.code, "network_error");
  assert.equal(JSON.stringify(result).includes(input.apiKey), false);
});
