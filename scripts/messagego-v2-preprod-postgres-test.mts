import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SettlementError } from "../lib/messagego/settlement/amount.ts";
import { authenticateSettlementRequest } from "../lib/messagego/settlement/service-auth.ts";
import { handleSettlementHttp } from "../lib/messagego/settlement/http.ts";
import { claimS2SReplay } from "../lib/messagego/s2s/replay.ts";
import {
  DIRECTION_MESSAGEGO_TO_ABRCHIN,
  parseKeyringJSON,
  signRequest,
} from "../lib/messagego/s2s/hmac.ts";
import { prisma } from "../lib/db.ts";
import { UserAccountStatus, WalletStatus } from "@prisma/client";
import { randomBytes } from "node:crypto";

const SETTLEMENT_PATH = "/api/internal/messagego/v2/settlement";

function writeVerifyKeyring() {
  const dir = mkdtempSync(join(tmpdir(), "abrchin-preprod-key-"));
  const path = join(dir, "verify.json");
  const json = JSON.stringify({
    protocol: "MESSAGEGO-S2S-HMAC-V1",
    keys: [
      {
        key_id: "k_mg_ac_1",
        secret_hex: "11".repeat(32),
        direction: "messagego_to_abrchin",
        status: "active",
      },
    ],
  });
  writeFileSync(path, json, { mode: 0o600 });
  chmodSync(path, 0o600);
  return { path, json };
}

test("concurrent replay claims accept exactly one nonce", async () => {
  const nonce = "aa".repeat(16);
  const expiresAt = new Date(Date.now() + 300_000);
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      claimS2SReplay({
        serviceId: "messagego-runtime",
        keyId: "k1",
        nonce,
        expiresAt,
      }),
    ),
  );
  const accepted = results.filter((item) => item.status === "fulfilled").length;
  const denied = results.filter((item) => item.status === "rejected").length;
  assert.equal(accepted, 1);
  assert.equal(denied, 7);
});

test("production settlement remains denied when the PREPROD gate is off", async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    enabled: process.env.MESSAGEGO_V2_SETTLEMENT_ENABLED,
  };
  try {
    process.env.NODE_ENV = "production";
    delete process.env.MESSAGEGO_V2_SETTLEMENT_ENABLED;
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
  } finally {
    process.env.NODE_ENV = previous.NODE_ENV;
    if (previous.enabled === undefined) delete process.env.MESSAGEGO_V2_SETTLEMENT_ENABLED;
    else process.env.MESSAGEGO_V2_SETTLEMENT_ENABLED = previous.enabled;
  }
});

test("HMAC signed reserve/settle mutates AbrChin wallet once; replay and tamper do not", async () => {
  const keyring = writeVerifyKeyring();
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    enabled: process.env.MESSAGEGO_V2_SETTLEMENT_ENABLED,
    keyring: process.env.MESSAGEGO_V2_S2S_KEYRING_FILE,
    allowed: process.env.MESSAGEGO_V2_S2S_ALLOWED_SERVICE_IDS,
  };
  process.env.NODE_ENV = "test";
  process.env.MESSAGEGO_V2_SETTLEMENT_ENABLED = "true";
  process.env.MESSAGEGO_V2_S2S_KEYRING_FILE = keyring.path;
  process.env.MESSAGEGO_V2_S2S_ALLOWED_SERVICE_IDS = "messagego-runtime";

  const mobile = `09${randomBytes(5).toString("hex").slice(0, 9)}`;
  const user = await prisma.user.create({
    data: { mobile, accountStatus: UserAccountStatus.ACTIVE },
  });
  const wallet = await prisma.wallet.create({
    data: {
      userId: user.id,
      availableBalance: 1000n,
      status: WalletStatus.ACTIVE,
    },
  });

  const ring = parseKeyringJSON(keyring.json);
  const suffix = randomBytes(4).toString("hex");
  const reserveBody = Buffer.from(
    JSON.stringify({
      operation: "reserve",
      contract_id: "MESSAGEGO-V2-ABRCHIN-SETTLEMENT",
      contract_version: "2.0.0",
      operation_id: `op_r_${suffix}`,
      account_id: user.id,
      product_id: "prod_a",
      workspace_id: "ws_a",
      run_id: `run_${suffix}`,
      usage_reservation_id: `ures_${suffix}`,
      caller_service_id: "messagego-runtime",
      hold_amount: "250",
      pricing_fingerprint: "ab".repeat(32),
      pricing_version: "price.v2.test",
    }),
  );

  const signedRequest = (body: Buffer) => {
    const headers = new Headers({ "content-type": "application/json" });
    signRequest(
      headers,
      ring,
      DIRECTION_MESSAGEGO_TO_ABRCHIN,
      "messagego-runtime",
      "POST",
      SETTLEMENT_PATH,
      "",
      body,
      "MESSAGEGO-V2-ABRCHIN-SETTLEMENT",
      "2.0.0",
    );
    return new Request(`http://127.0.0.1${SETTLEMENT_PATH}`, {
      method: "POST",
      headers,
      body,
    });
  };

  try {
    const reserved = await handleSettlementHttp(signedRequest(reserveBody));
    const reservedPayload = await reserved.json() as {
      outcome?: { authority_reservation_id?: string };
      error?: string;
    };
    assert.equal(reserved.status, 200, JSON.stringify(reservedPayload));
    const authorityReservationId = reservedPayload.outcome?.authority_reservation_id ?? "";
    assert.ok(authorityReservationId);
    const afterReserve = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    assert.equal(afterReserve.availableBalance, 750n);

    const tamperedHeaders = new Headers({ "content-type": "application/json" });
    signRequest(
      tamperedHeaders,
      ring,
      DIRECTION_MESSAGEGO_TO_ABRCHIN,
      "messagego-runtime",
      "POST",
      SETTLEMENT_PATH,
      "",
      reserveBody,
      "MESSAGEGO-V2-ABRCHIN-SETTLEMENT",
      "2.0.0",
    );
    tamperedHeaders.set("X-MessageGo-S2S-Signature", "ff".repeat(32));
    const tampered = await handleSettlementHttp(
      new Request(`http://127.0.0.1${SETTLEMENT_PATH}`, {
        method: "POST",
        headers: tamperedHeaders,
        body: reserveBody,
      }),
    );
    assert.equal(tampered.status, 401);
    const afterTamper = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    assert.equal(afterTamper.availableBalance, 750n);

    const settleBody = Buffer.from(
      JSON.stringify({
        operation: "settle",
        contract_id: "MESSAGEGO-V2-ABRCHIN-SETTLEMENT",
        contract_version: "2.0.0",
        operation_id: `op_s_${suffix}`,
        account_id: user.id,
        product_id: "prod_a",
        workspace_id: "ws_a",
        run_id: `run_${suffix}`,
        usage_reservation_id: `ures_${suffix}`,
        authority_reservation_id: authorityReservationId,
        caller_service_id: "messagego-runtime",
        customer_billable_amount: "200",
        provider_cost: "1",
        provider_usage: { input_text_tokens: 1, output_text_tokens: 1 },
        pricing_fingerprint: "ab".repeat(32),
        pricing_version: "price.v2.test",
      }),
    );
    const settleHeaders = new Headers({ "content-type": "application/json" });
    signRequest(
      settleHeaders,
      ring,
      DIRECTION_MESSAGEGO_TO_ABRCHIN,
      "messagego-runtime",
      "POST",
      SETTLEMENT_PATH,
      "",
      settleBody,
      "MESSAGEGO-V2-ABRCHIN-SETTLEMENT",
      "2.0.0",
    );
    const settled = await handleSettlementHttp(
      new Request(`http://127.0.0.1${SETTLEMENT_PATH}`, {
        method: "POST",
        headers: settleHeaders,
        body: settleBody,
      }),
    );
    assert.equal(settled.status, 200, await settled.text());
    const afterSettle = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    assert.equal(afterSettle.availableBalance, 800n);

    const hmacReplay = await handleSettlementHttp(
      new Request(`http://127.0.0.1${SETTLEMENT_PATH}`, {
        method: "POST",
        headers: settleHeaders,
        body: settleBody,
      }),
    );
    assert.equal(hmacReplay.status, 401);
    const afterHmacReplay = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    assert.equal(afterHmacReplay.availableBalance, 800n);

    const idempotentSettle = await handleSettlementHttp(signedRequest(settleBody));
    assert.equal(idempotentSettle.status, 200, await idempotentSettle.text());
    const afterIdempotent = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    assert.equal(afterIdempotent.availableBalance, 800n);
  } finally {
    process.env.NODE_ENV = previous.NODE_ENV;
    if (previous.enabled === undefined) delete process.env.MESSAGEGO_V2_SETTLEMENT_ENABLED;
    else process.env.MESSAGEGO_V2_SETTLEMENT_ENABLED = previous.enabled;
    if (previous.keyring === undefined) delete process.env.MESSAGEGO_V2_S2S_KEYRING_FILE;
    else process.env.MESSAGEGO_V2_S2S_KEYRING_FILE = previous.keyring;
    if (previous.allowed === undefined) delete process.env.MESSAGEGO_V2_S2S_ALLOWED_SERVICE_IDS;
    else process.env.MESSAGEGO_V2_S2S_ALLOWED_SERVICE_IDS = previous.allowed;
  }
});

test("production + settlement enabled + valid HMAC is technically available on real postgres", async () => {
  const keyring = writeVerifyKeyring();
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    enabled: process.env.MESSAGEGO_V2_SETTLEMENT_ENABLED,
    keyring: process.env.MESSAGEGO_V2_S2S_KEYRING_FILE,
    allowed: process.env.MESSAGEGO_V2_S2S_ALLOWED_SERVICE_IDS,
  };
  process.env.NODE_ENV = "production";
  process.env.MESSAGEGO_V2_SETTLEMENT_ENABLED = "true";
  process.env.MESSAGEGO_V2_S2S_KEYRING_FILE = keyring.path;
  process.env.MESSAGEGO_V2_S2S_ALLOWED_SERVICE_IDS = "messagego-runtime";
  try {
    const body = Buffer.from("{}");
    const headers = new Headers({ "content-type": "application/json" });
    signRequest(
      headers,
      parseKeyringJSON(keyring.json),
      DIRECTION_MESSAGEGO_TO_ABRCHIN,
      "messagego-runtime",
      "POST",
      SETTLEMENT_PATH,
      "",
      body,
      "MESSAGEGO-V2-ABRCHIN-SETTLEMENT",
      "2.0.0",
    );
    const caller = await authenticateSettlementRequest(
      new Request(`http://127.0.0.1${SETTLEMENT_PATH}`, { method: "POST", headers, body }),
      body,
    );
    assert.equal(caller.callerServiceId, "messagego-runtime");
  } finally {
    process.env.NODE_ENV = previous.NODE_ENV;
    if (previous.enabled === undefined) delete process.env.MESSAGEGO_V2_SETTLEMENT_ENABLED;
    else process.env.MESSAGEGO_V2_SETTLEMENT_ENABLED = previous.enabled;
    if (previous.keyring === undefined) delete process.env.MESSAGEGO_V2_S2S_KEYRING_FILE;
    else process.env.MESSAGEGO_V2_S2S_KEYRING_FILE = previous.keyring;
    if (previous.allowed === undefined) delete process.env.MESSAGEGO_V2_S2S_ALLOWED_SERVICE_IDS;
    else process.env.MESSAGEGO_V2_S2S_ALLOWED_SERVICE_IDS = previous.allowed;
  }
});

