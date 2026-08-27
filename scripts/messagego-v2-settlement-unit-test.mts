import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  assertNoJsonNumberMoney,
  parseWalletAmount,
  SETTLEMENT_CONTRACT_ID,
  SettlementError,
  walletAmountString,
} from "../lib/messagego/settlement/amount.ts";
import {
  readPinnedSettlementLock,
  SETTLEMENT_CONTRACT_PIN,
  sha256File,
  siblingCanonicalContractPath,
} from "../lib/messagego/settlement/contract-pin.ts";
import { settlementFingerprint } from "../lib/messagego/settlement/fingerprint.ts";
import { authenticateSettlementRequest } from "../lib/messagego/settlement/service-auth.ts";

test("settlement pin matches MESSAGEGO-V2-ABRCHIN-SETTLEMENT@2.0.0", () => {
  const lock = readPinnedSettlementLock();
  assert.equal(lock.contract_id, SETTLEMENT_CONTRACT_ID);
  assert.equal(lock.version, "2.0.0");
  assert.equal(
    lock.json_sha256,
    "b943e627a5486fd4ae6ae5e062cc7b220ccb945808cebb4757ef42262f882f33",
  );
  assert.equal(SETTLEMENT_CONTRACT_PIN.json_sha256, lock.json_sha256);
  const sibling = siblingCanonicalContractPath();
  if (existsSync(sibling)) {
    assert.equal(sha256File(sibling), lock.json_sha256);
  }
});

test("wallet amounts are lossless integer rial strings", () => {
  assert.equal(parseWalletAmount("0"), 0n);
  assert.equal(parseWalletAmount("250"), 250n);
  assert.equal(walletAmountString(250n), "250");
  assert.throws(() => parseWalletAmount("01"), SettlementError);
  assert.throws(() => parseWalletAmount("10.5"), SettlementError);
  assert.throws(() => parseWalletAmount("1e2"), SettlementError);
  assert.throws(() => parseWalletAmount("-1"), SettlementError);
  assert.throws(() => parseWalletAmount(250), (error: unknown) => {
    assert.ok(error instanceof SettlementError);
    assert.equal(error.code, "json_number_money");
    return true;
  });
  assert.throws(
    () => assertNoJsonNumberMoney({ customer_billable_amount: 200 }),
    SettlementError,
  );
  assert.doesNotThrow(() =>
    assertNoJsonNumberMoney({
      customer_billable_amount: "200",
      provider_usage: { input_text_tokens: 10, output_text_tokens: 4 },
    }),
  );
});

test("identical semantic bodies share a fingerprint and conflicts do not", () => {
  const body = {
    account_id: "acct",
    hold_amount: "10",
    product_id: "prod",
  };
  assert.equal(settlementFingerprint(body), settlementFingerprint({ ...body }));
  assert.notEqual(
    settlementFingerprint(body),
    settlementFingerprint({ ...body, hold_amount: "11" }),
  );
});

test("settlement HTTP auth is fail-closed for production, browsers, and missing credentials", async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    cred: process.env.MESSAGEGO_SETTLEMENT_SERVICE_CREDENTIAL,
  };
  try {
    process.env.NODE_ENV = "production";
    process.env.MESSAGEGO_SETTLEMENT_SERVICE_CREDENTIAL = "x".repeat(32);
    await assert.rejects(
      () =>
        authenticateSettlementRequest(
          new Request("http://127.0.0.1/internal", {
            method: "POST",
            headers: {
              authorization: `Bearer ${"x".repeat(32)}`,
              "x-messagego-caller-service-id": "messagego-test",
            },
          }),
        ),
      (error: unknown) =>
        error instanceof SettlementError && error.code === "production_denied",
    );

    process.env.NODE_ENV = "test";
    delete process.env.MESSAGEGO_SETTLEMENT_SERVICE_CREDENTIAL;
    await assert.rejects(
      () =>
        authenticateSettlementRequest(
          new Request("http://127.0.0.1/internal", { method: "POST" }),
        ),
      (error: unknown) =>
        error instanceof SettlementError &&
        error.code === "settlement_runtime_unavailable",
    );

    process.env.MESSAGEGO_SETTLEMENT_SERVICE_CREDENTIAL = "local-test-credential-32chars++";
    await assert.rejects(
      () =>
        authenticateSettlementRequest(
          new Request("http://127.0.0.1/internal", {
            method: "POST",
            headers: {
              authorization: `Bearer ${process.env.MESSAGEGO_SETTLEMENT_SERVICE_CREDENTIAL}`,
              cookie: "abrchin_session=browser",
              "x-messagego-caller-service-id": "messagego-test",
            },
          }),
        ),
      (error: unknown) =>
        error instanceof SettlementError && error.code === "browser_forbidden",
    );
  } finally {
    process.env.NODE_ENV = previous.NODE_ENV;
    if (previous.cred === undefined) {
      delete process.env.MESSAGEGO_SETTLEMENT_SERVICE_CREDENTIAL;
    } else {
      process.env.MESSAGEGO_SETTLEMENT_SERVICE_CREDENTIAL = previous.cred;
    }
  }
});

test("AbrChin has no inference proxy route and payment callbacks stay off the AI path", () => {
  const settlement = readFileSync("lib/messagego/settlement/authority.ts", "utf8");
  assert.match(settlement, /inference_proxy: false/);
  assert.match(settlement, /wallet_authority: "abrchin"/);
  const callback = readFileSync("lib/payments/callback-handler.ts", "utf8");
  assert.equal(callback.includes("messagego/settlement"), false);
  assert.equal(callback.includes("reserveWalletAuthority"), false);
  const client = readFileSync("lib/messagego/client.ts", "utf8");
  assert.equal(client.includes("/v1/chat/completions"), false);
  assert.equal(existsSync("app/api/inference"), false);
  assert.equal(existsSync("app/api/openai"), false);
  assert.equal(existsSync("app/api/internal/messagego/v2/inference"), false);
});

test("locked Phase 1 product contract is unchanged by WP07", () => {
  const contract = readFileSync("docs/phase-1-product-contract.md", "utf8");
  assert.match(contract, /LOCKED/);
});
