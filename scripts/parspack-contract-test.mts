import assert from "node:assert/strict";
import test from "node:test";

import { mapProviderHttpError, parseVmList, sanitizeProviderResponse } from "../lib/infrastructure/parspack/mapper.ts";

const vmListFixture = {
  data: [
    {
      id: 101,
      name: "abrchin-testvm01",
      region: "tehran11",
      size: "irLinuxVPS4",
      image: "ubuntu24-cloudinit-qcow2",
      status: "active",
      ipv4: "185.1.1.1",
    },
  ],
};

test("parses vm list fixture", () => {
  const list = parseVmList(vmListFixture);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.name, "abrchin-testvm01");
});

test("maps provider http errors without treating all 403 as balance", () => {
  assert.equal(mapProviderHttpError(401), "provider_auth_failed");
  assert.equal(mapProviderHttpError(402), "provider_insufficient_balance");
  assert.equal(mapProviderHttpError(403), "provider_auth_failed");
  assert.equal(mapProviderHttpError(404), "provider_not_found");
  assert.equal(mapProviderHttpError(422), "provider_invalid_response");
  assert.equal(mapProviderHttpError(429), "provider_unavailable");
  assert.equal(mapProviderHttpError(503), "provider_unavailable");
});

test("sanitized provider response excludes secrets", () => {
  const safe = sanitizeProviderResponse({
    id: "1",
    name: "vm",
    token: "secret-token",
    password: "secret",
    status: "active",
  });
  assert.equal("token" in safe, false);
  assert.equal("password" in safe, false);
  assert.equal(safe.id, "1");
});
