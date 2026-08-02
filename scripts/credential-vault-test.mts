import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  credentialFingerprint,
  decryptCredential,
  encryptCredential,
} from "../lib/security/credential-vault.ts";

const testKey = Buffer.alloc(32, 7).toString("base64");

test("instance credentials use authenticated encryption and round-trip safely", () => {
  const encrypted = encryptCredential("temporary-secret-123", testKey);
  assert.notEqual(encrypted.ciphertext, "temporary-secret-123");
  assert.equal(decryptCredential(encrypted, testKey), "temporary-secret-123");

  assert.throws(() =>
    decryptCredential(
      {
        ...encrypted,
        ciphertext: `${encrypted.ciphertext.slice(0, -2)}aa`,
      },
      testKey,
    ),
  );
});

test("inventory credential fingerprints are keyed and deterministic", () => {
  const secret = "unique-inventory-password";
  const first = credentialFingerprint(secret, testKey);
  assert.equal(first, credentialFingerprint(secret, testKey));
  assert.notEqual(first, credentialFingerprint(`${secret}-different`, testKey));
  assert.equal(first.includes(secret), false);
});

test("credential reveal is one-time and clears encrypted material", async () => {
  const service = await readFile("lib/security/instance-credentials.ts", "utf8");
  const customerRoute = await readFile(
    "app/api/account/instances/[id]/credentials/reveal/route.ts",
    "utf8",
  );

  assert.match(service, /updateMany/);
  assert.match(service, /revealedAt: null/);
  assert.match(service, /ciphertext: null/);
  assert.match(service, /authTag: null/);
  assert.match(customerRoute, /requireCustomer/);
  assert.doesNotMatch(customerRoute, /ciphertext|authTag|iv:/);
});

test("production compose requires the credential encryption key", async () => {
  const compose = await readFile("compose.production.yaml", "utf8");
  assert.match(
    compose,
    /CREDENTIAL_ENCRYPTION_KEY: \$\{CREDENTIAL_ENCRYPTION_KEY:\?CREDENTIAL_ENCRYPTION_KEY must be set\}/,
  );
});

test("inventory credential registration is admin-only and never returns the secret", async () => {
  const route = await readFile(
    "app/api/admin/infrastructure/preprovisioned-inventory/[id]/credential/route.ts",
    "utf8",
  );
  assert.match(route, /rejectCrossOrigin/);
  assert.match(route, /requireAdminUser/);
  assert.match(route, /readIdempotencyKey/);
  assert.match(route, /requestFingerprint/);
  assert.doesNotMatch(route, /jsonOk\([^)]*secret/s);
  assert.doesNotMatch(route, /console\.(?:log|error|warn)/);
});
