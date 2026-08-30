import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { getEnv } from "../lib/env.ts";

const PHASE1_HASH = "9bb2311d7dc7a01d87b31c664ec65c1cb346efaa";

test("MessageGo 1.0.0 production config names are canonical and default-off", () => {
  const envSource = readFileSync("lib/env.ts", "utf8");
  assert.match(envSource, /readBool\("MESSAGEGO_SETTLEMENT_ENABLED", false\)/);
  assert.match(envSource, /readBool\("MESSAGEGO_CUSTOMER_AI_ENABLED", false\)/);
  assert.match(envSource, /readBool\("MESSAGEGO_SECRET_HANDOFF_ENABLED", false\)/);
  assert.match(envSource, /MESSAGEGO_HANDOFF_BASE_URL/);
  assert.match(envSource, /MESSAGEGO_HANDOFF_PATH \?\? "\/internal\/v2\/handoff"/);
  assert.match(envSource, /rejectDeprecatedMessageGoEnv/);
  assert.equal(envSource.includes('readBool("MESSAGEGO_V2_SETTLEMENT_ENABLED"'), false);

  const compose = readFileSync("compose.production.yaml", "utf8");
  assert.match(compose, /MESSAGEGO_SETTLEMENT_ENABLED: \$\{MESSAGEGO_SETTLEMENT_ENABLED:-false\}/);
  assert.match(compose, /MESSAGEGO_CUSTOMER_AI_ENABLED: \$\{MESSAGEGO_CUSTOMER_AI_ENABLED:-false\}/);
  assert.match(compose, /MESSAGEGO_SECRET_HANDOFF_ENABLED: \$\{MESSAGEGO_SECRET_HANDOFF_ENABLED:-false\}/);
  assert.match(compose, /MESSAGEGO_HANDOFF_PATH: \$\{MESSAGEGO_HANDOFF_PATH:-\/internal\/v2\/handoff\}/);
  assert.equal(compose.includes("MESSAGEGO_V2_SETTLEMENT_ENABLED"), false);
  assert.equal(compose.includes("MESSAGEGO_SETTLEMENT_SERVICE_CREDENTIAL"), false);

  const auth = readFileSync("lib/messagego/settlement/service-auth.ts", "utf8");
  assert.match(auth, /MessageGo settlement runtime is denied in production/);
  assert.equal(auth.includes("MessageGo V2 settlement"), false);
  assert.match(auth, /HMAC S2S authentication is required when MessageGo settlement is enabled in production/);
});

test("deprecated MESSAGEGO_V2_* names fail closed", () => {
  const previous = process.env.MESSAGEGO_V2_SETTLEMENT_ENABLED;
  process.env.MESSAGEGO_V2_SETTLEMENT_ENABLED = "true";
  try {
    assert.throws(
      () => getEnv(),
      (error: unknown) =>
        error instanceof Error && error.message.includes("MESSAGEGO_V2_SETTLEMENT_ENABLED is not accepted"),
    );
  } finally {
    if (previous === undefined) delete process.env.MESSAGEGO_V2_SETTLEMENT_ENABLED;
    else process.env.MESSAGEGO_V2_SETTLEMENT_ENABLED = previous;
  }
});

test("customer and schema language is MessageGo / MessageGo AI, not MessageGo V2", () => {
  const page = readFileSync("app/account/ai/page.tsx", "utf8");
  assert.equal(page.includes("MessageGo V2"), false);
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  assert.match(schema, /AbrChin-authoritative MessageGo reservation/);
  assert.equal(schema.includes("MessageGo V2 reservation"), false);
});

test("public customer API has no /v2 routes; private settlement path may remain", () => {
  assert.equal(existsSync("app/api/v2"), false);
  assert.equal(existsSync("app/api/internal/messagego/v2/settlement/route.ts"), true);
  assert.equal(existsSync("app/api/inference"), false);
});

test("Phase 1 contract and published wallet-authority migration remain unchanged", () => {
  const hashed = spawnSync("git", ["hash-object", "docs/phase-1-product-contract.md"], {
    encoding: "utf8",
  });
  assert.equal(hashed.status, 0, hashed.stderr);
  assert.equal(hashed.stdout.trim(), PHASE1_HASH);
  assert.equal(
    existsSync("prisma/migrations/20260826100000_messagego_v2_wallet_authority/migration.sql"),
    true,
  );
  assert.equal(
    existsSync("prisma/migrations/20260827120000_messagego_v2_s2s_replay/migration.sql"),
    true,
  );
});
