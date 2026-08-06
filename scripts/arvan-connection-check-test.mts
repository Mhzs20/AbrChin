import assert from "node:assert/strict";
import test from "node:test";

import { checkArvanAuthenticatedConnection } from "../lib/infrastructure/arvan/connection-check.ts";
import {
  fetchArvanRegionsFromProvider,
  parseDiscoveredArvanRegions,
} from "../lib/infrastructure/arvan/discover-regions.ts";

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

test("Arvan region discovery parses GET /regions into storefront-safe rows", () => {
  const discovered = parseDiscoveredArvanRegions({
    data: [
      { code: "ir-thr-si1", name: "Simin" },
      { id: "eu-west1-a", title: "Frankfurt" },
      { code: "ir-thr-si1", name: "duplicate" },
      { unexpected: true },
    ],
  });
  assert.deepEqual(
    discovered.map((row) => row.regionCode),
    ["ir-thr-si1", "eu-west1-a"],
  );
  assert.equal(discovered[0]?.displayName, "سیمین، غرب تهران");
  assert.equal(discovered[1]?.displayName, "گوته، آلمان");
});

test("Arvan region discovery fetch uses read-only GET /regions", async () => {
  let request: { url: string; init?: RequestInit } | null = null;
  const previousKey = process.env.ARVAN_API_KEY;
  process.env.ARVAN_API_KEY = "test-only-arvan-key";
  try {
    const discovered = await fetchArvanRegionsFromProvider({
      apiKey: "test-only-arvan-key",
      baseUrl: "https://napi.arvancloud.ir/ecc/v1",
      fetchImpl: async (url, init) => {
        request = { url: String(url), init };
        return response({
          data: [
            { code: "ir-southwest1-a", name: "Ahvaz" },
            { code: "unknown-cloud-1", name: "Provider Label" },
          ],
        });
      },
    });
    assert.equal(request?.url, "https://napi.arvancloud.ir/ecc/v1/regions");
    assert.equal(request?.init?.method, "GET");
    assert.equal(discovered[0]?.displayName, "قیصر، اهواز");
    assert.equal(discovered[1]?.displayName, "Provider Label");
  } finally {
    if (previousKey === undefined) delete process.env.ARVAN_API_KEY;
    else process.env.ARVAN_API_KEY = previousKey;
  }
});
