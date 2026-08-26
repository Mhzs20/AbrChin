import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { FailClosedSecretHandoffPort, isStableFamilyAlias, MemorySecretHandoffPort } from "../lib/messagego/customer/handoff.ts";
import {
  customerViewContainsForbiddenSecret,
  toCustomerConnectionView,
} from "../lib/messagego/customer/view.ts";

test("customer AI APIs do not expose secrets, provider keys, or inference", () => {
  const billing = readFileSync("app/api/account/ai-billing/route.ts", "utf8");
  const connection = readFileSync("app/api/account/ai-connection/route.ts", "utf8");
  const page = readFileSync("app/account/ai/page.tsx", "utf8");
  const surface = readFileSync("lib/messagego/customer/surface.ts", "utf8");
  assert.equal(billing.includes("secretRef"), false);
  assert.match(connection, /customerViewContainsForbiddenSecret/);
  assert.equal(page.includes("api_key"), false);
  const selectMatch = surface.match(
    /const CONNECTION_SELECT = \{[\s\S]*?\} as const/,
  );
  assert.ok(selectMatch);
  assert.equal(selectMatch[0].includes("secretRef"), false);
  assert.equal(surface.includes("/v1/chat/completions"), false);
  assert.equal(
    customerViewContainsForbiddenSecret({ hello: "world" }, ["sk_live_secret"]),
    false,
  );
  assert.equal(
    customerViewContainsForbiddenSecret({ leak: "sk_live_secret" }, ["sk_live_secret"]),
    true,
  );
});

test("default handoff port remains fail-closed outside the test memory adapter", async () => {
  const previous = process.env.MESSAGEGO_SECRET_HANDOFF_MODE;
  delete process.env.MESSAGEGO_SECRET_HANDOFF_MODE;
  const port = new FailClosedSecretHandoffPort();
  await assert.rejects(port.handoff({
    accountId: "acct",
    productId: "prod",
    workspaceId: "ws",
    ownershipMode: "ACCOUNT_BYOK",
    familyAlias: "anthropic",
    plaintext: "secret-material",
  }));
  if (previous === undefined) delete process.env.MESSAGEGO_SECRET_HANDOFF_MODE;
  else process.env.MESSAGEGO_SECRET_HANDOFF_MODE = previous;
});

test("memory handoff returns an opaque ref and customer views omit secrets", async () => {
  const memory = new MemorySecretHandoffPort();
  const handed = await memory.handoff({
    accountId: "acct",
    productId: "prod",
    workspaceId: "ws",
    ownershipMode: "ACCOUNT_BYOK",
    familyAlias: "openai",
    plaintext: "sk_test_FAKE_PROVIDER_KEY",
  });
  assert.match(handed.secretRef, /^sec_test_/);
  assert.equal(isStableFamilyAlias("gpt-4o"), false);
  assert.equal(isStableFamilyAlias("openai-compatible"), true);
  const view = toCustomerConnectionView({
    id: "conn_1",
    userId: "acct",
    productId: "prod",
    workspaceId: "ws",
    alias: "default",
    ownershipMode: "ACCOUNT_BYOK",
    familyAlias: "openai",
    status: "CONNECTED",
    lastHandoffAt: null,
    lastErrorCode: null,
  });
  assert.equal(view.secret_retained, false);
  assert.equal(view.raw_key_readable, false);
  assert.equal(
    customerViewContainsForbiddenSecret(view, ["sk_test_FAKE_PROVIDER_KEY"]),
    false,
  );
  assert.equal("secretRef" in view, false);
});

test("customer AI navigation is present without locking a new auth protocol", () => {
  const shell = readFileSync("components/product/customer-shell.tsx", "utf8");
  assert.match(shell, /href: "\/account\/ai"/);
  const form = readFileSync("components/account/ai-connection-form.tsx", "utf8");
  assert.match(form, /type="password"/);
  assert.equal(form.includes("sk-"), false);
});

