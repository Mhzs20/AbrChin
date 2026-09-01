import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const PHASE1_HASH = "9bb2311d7dc7a01d87b31c664ec65c1cb346efaa";
const SETTLEMENT_DIGEST = "43392f82b465ba2462621ea09b092bd7977994d5b22ea15f616ffbc12601f242";

test("WP10 release readiness keeps production settlement denied by default", () => {
  const auth = readFileSync("lib/messagego/settlement/service-auth.ts", "utf8");
  assert.match(auth, /production_denied/);
  assert.match(auth, /MessageGo settlement runtime is denied in production/);
  assert.match(auth, /browser_forbidden/);
  assert.match(auth, /settlementRuntimeAllowed/);
  assert.match(auth, /messageGoSettlementEnabled/);
  assert.match(
    auth,
    /if \(env\.isProduction && !env\.messageGoSettlementEnabled\) return false/,
  );

  const compose = readFileSync("compose.production.yaml", "utf8");
  assert.equal(compose.includes("MESSAGEGO_SETTLEMENT_SERVICE_CREDENTIAL"), false);
  assert.match(compose, /NODE_ENV:\s*production/);
  assert.match(compose, /MESSAGEGO_SETTLEMENT_ENABLED: \$\{MESSAGEGO_SETTLEMENT_ENABLED:-false\}/);

  const pointer = readFileSync("docs/program/messagego-v2-pointer.md", "utf8");
  assert.match(pointer, /WP10/);
  assert.match(pointer, /NOT production authorization|production remains denied|PRODUCTION = DENIED/i);

  const handoff = readFileSync("docs/program/v2-wp10-release-handoff-pointer.md", "utf8");
  assert.match(handoff, /WP10/);
  assert.match(handoff, /not(\*\*)? production authorization/i);
  assert.match(handoff, /PRODUCTION = DENIED/);
  assert.match(handoff, /wp10_production_authorization = false/);

  assert.equal(
    existsSync("prisma/migrations/20260826100000_messagego_v2_wallet_authority/migration.sql"),
    true,
  );
});

test("WP10 does not add an AbrChin inference proxy", () => {
  assert.equal(existsSync("app/api/inference"), false);
  assert.equal(existsSync("app/api/openai"), false);
  assert.equal(existsSync("app/api/internal/messagego/v2/inference"), false);
  const settlement = readFileSync("lib/messagego/settlement/authority.ts", "utf8");
  assert.match(settlement, /inference_proxy: false/);
});

test("WP10 keeps Phase 1 contract and settlement pin unchanged", () => {
  const hashed = spawnSync("git", ["hash-object", "docs/phase-1-product-contract.md"], {
    encoding: "utf8",
  });
  assert.equal(hashed.status, 0, hashed.stderr);
  assert.equal(hashed.stdout.trim(), PHASE1_HASH);
  const lock = JSON.parse(readFileSync("docs/program/messagego-v2-abrchin-settlement.lock.json", "utf8"));
  assert.equal(lock.json_sha256, SETTLEMENT_DIGEST);
});

test("production deploy script is not invoked by WP10 readiness", () => {
  const deploy = readFileSync("ops/deploy.sh", "utf8");
  assert.match(deploy, /APP_DIR=/);
  const syntax = spawnSync("bash", ["-n", "ops/deploy.sh"], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
});
