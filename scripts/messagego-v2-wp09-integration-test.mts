import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  FailClosedControlPlanePort,
  setControlPlanePortForTests,
} from "../lib/messagego/customer/control-plane.ts";
import { FailClosedSecretHandoffPort } from "../lib/messagego/customer/handoff.ts";
import { customerViewContainsForbiddenSecret } from "../lib/messagego/customer/view.ts";
import {
  readPinnedSettlementLock,
  SETTLEMENT_CONTRACT_PIN,
  sha256File,
  siblingCanonicalContractPath,
} from "../lib/messagego/settlement/contract-pin.ts";
import { parseWalletAmount } from "../lib/messagego/settlement/amount.ts";

const CANARY = "WP09_SECRET_CANARY_DO_NOT_LEAK";
const PHASE1_HASH = "9bb2311d7dc7a01d87b31c664ec65c1cb346efaa";
const SETTLEMENT_DIGEST = "b943e627a5486fd4ae6ae5e062cc7b220ccb945808cebb4757ef42262f882f33";

test("AbrChin pin matches canonical MessageGo settlement digest", () => {
  const lock = readPinnedSettlementLock();
  assert.equal(lock.json_sha256, SETTLEMENT_DIGEST);
  assert.equal(SETTLEMENT_CONTRACT_PIN.json_sha256, SETTLEMENT_DIGEST);
  const sibling = siblingCanonicalContractPath();
  assert.equal(existsSync(sibling), true);
  assert.equal(sha256File(sibling), SETTLEMENT_DIGEST);
});

test("Phase 1 product contract hash is unchanged", () => {
  const hashed = spawnSync("git", ["hash-object", "docs/phase-1-product-contract.md"], {
    encoding: "utf8",
  });
  assert.equal(hashed.status, 0, hashed.stderr);
  assert.equal(hashed.stdout.trim(), PHASE1_HASH);
});

test("money roundtrip fixtures stay integer rials and distinct concepts", () => {
  const fixturePath = "../MessageGo/internal/v2integration/testdata/money-roundtrip.json";
  const fixture = existsSync(fixturePath)
    ? (JSON.parse(readFileSync(fixturePath, "utf8")) as {
        valid_amounts: string[];
        invalid_amounts: string[];
        distinct_concepts: {
          provider_cost: string;
          customer_billable_amount: string;
          abrchin_wallet_amount: string;
        };
      })
    : {
        valid_amounts: ["0", "1", "250", "200", "999999999999999999"],
        invalid_amounts: ["01", "10.5", "1e2", "-1", "", "1.0"],
        distinct_concepts: {
          provider_cost: "999999",
          customer_billable_amount: "200",
          abrchin_wallet_amount: "200",
        },
      };
  for (const amount of fixture.valid_amounts) {
    parseWalletAmount(amount);
  }
  for (const amount of fixture.invalid_amounts) {
    assert.throws(() => parseWalletAmount(amount));
  }
  assert.notEqual(
    fixture.distinct_concepts.provider_cost,
    fixture.distinct_concepts.customer_billable_amount,
  );
});

test("AbrChin is not an inference proxy and callbacks stay off AI", () => {
  assert.equal(existsSync("app/api/inference"), false);
  assert.equal(existsSync("app/api/openai"), false);
  assert.equal(existsSync("app/api/internal/messagego/v2/inference"), false);
  const settlement = readFileSync("lib/messagego/settlement/authority.ts", "utf8");
  assert.match(settlement, /inference_proxy: false/);
  assert.equal(settlement.includes("/v1/chat/completions"), false);
  const callback = readFileSync("lib/payments/callback-handler.ts", "utf8");
  assert.equal(callback.includes("reserveWalletAuthority"), false);
  assert.equal(callback.includes("handleSettlementHttp"), false);
  const topup = readFileSync("lib/wallet/topup.ts", "utf8");
  assert.equal(topup.includes("reserveWalletAuthority"), false);
  const page = readFileSync("app/account/ai/page.tsx", "utf8");
  assert.equal(page.includes(CANARY), false);
  assert.equal(page.includes("secretRef"), false);
});

test("customer UX fail-closed probes do not leak canaries", async () => {
  for (const reason of ["timeout", "unauthorized", "malformed", "unavailable"] as const) {
    setControlPlanePortForTests(new FailClosedControlPlanePort(reason));
    const probe = await new FailClosedControlPlanePort(reason).probe();
    assert.equal(probe.available, false);
    assert.equal(probe.fail_closed, true);
    assert.equal(JSON.stringify(probe).includes(CANARY), false);
  }
  setControlPlanePortForTests(null);
  await assert.rejects(() =>
    new FailClosedSecretHandoffPort().handoff({
      accountId: "acct",
      productId: "prod",
      workspaceId: "ws",
      ownershipMode: "ACCOUNT_BYOK",
      familyAlias: "openai",
      plaintext: CANARY,
    }),
  );
  assert.equal(customerViewContainsForbiddenSecret({ ok: true }, [CANARY]), false);
});

test("WP09 sidecar is test-only and settlement production path stays fail-closed", () => {
  const sidecar = readFileSync("scripts/messagego-v2-wp09-settlement-sidecar.mts", "utf8");
  assert.match(sidecar, /ABRCHIN_ISOLATED_TEST/);
  assert.equal(sidecar.includes(CANARY), false);
  const auth = readFileSync("lib/messagego/settlement/service-auth.ts", "utf8");
  assert.match(auth, /production_denied/);
  assert.match(auth, /browser_forbidden/);
});
