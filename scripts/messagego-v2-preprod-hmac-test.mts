import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  bodySha256,
  canonicalString,
  compareSignature,
  DIRECTION_MESSAGEGO_TO_ABRCHIN,
  loadKeyringFile,
  parseKeyringJSON,
  sign,
  S2S_PROTOCOL,
} from "../lib/messagego/s2s/hmac.ts";

const HMAC_DIGEST = "bf20696a20ab028733d53153c94f45447e4c23f25b871afe73287e5f15e11c07";
const HANDOFF_DIGEST = "1bf21efb63c6ac9b364edac9961d9ab4cbb06d3be46088f6ad56a7b3bf7989be";
const SETTLEMENT_DIGEST = "43392f82b465ba2462621ea09b092bd7977994d5b22ea15f616ffbc12601f242";
const PHASE1_HASH = "9bb2311d7dc7a01d87b31c664ec65c1cb346efaa";

test("frozen HMAC vector matches Go/MessageGo contract", () => {
  const secret = Buffer.from("11".repeat(32), "hex");
  const fields = {
    method: "POST",
    path: "/api/internal/messagego/v2/settlement",
    rawQuery: "",
    body: Buffer.from(`{"operation":"reserve"}`),
    serviceId: "messagego-runtime",
    keyId: "k_mg_ac_1",
    timestampUnix: 1700000000,
    nonce: "00112233445566778899aabbccddeeff",
    contractId: "MESSAGEGO-V2-ABRCHIN-SETTLEMENT",
    contractVersion: "2.0.0",
  };
  assert.equal(
    bodySha256(fields.body),
    "f868da8b868801a99be1dd9eee2e6073249f6943a22cf513c7386b2812d197b5",
  );
  const signature = sign(secret, fields);
  assert.equal(
    signature,
    "4afdc625f21a97909369d239baa641907e20d246befa4297be928c59703934db",
  );
  assert.equal(
    createHmac("sha256", secret).update(canonicalString(fields)).digest("hex"),
    signature,
  );
  assert.equal(compareSignature(signature, signature), true);
  assert.equal(compareSignature(signature, "aa".repeat(32)), false);
});

test("PREPROD contract pins match MessageGo siblings when present", () => {
  const hmacLock = JSON.parse(readFileSync("docs/program/messagego-s2s-hmac-v1.lock.json", "utf8"));
  const handoffLock = JSON.parse(
    readFileSync("docs/program/messagego-v2-secret-handoff.lock.json", "utf8"),
  );
  assert.equal(hmacLock.json_sha256, HMAC_DIGEST);
  assert.equal(handoffLock.json_sha256, HANDOFF_DIGEST);
  const settlement = JSON.parse(
    readFileSync("docs/program/messagego-v2-abrchin-settlement.lock.json", "utf8"),
  );
  assert.equal(settlement.json_sha256, SETTLEMENT_DIGEST);
  const siblingHmac =
    "../MessageGo/contracts/integrations/messagego-s2s-hmac-v1.json";
  if (existsSync(siblingHmac)) {
    const digest = createHash("sha256").update(readFileSync(siblingHmac)).digest("hex");
    assert.equal(digest, HMAC_DIGEST);
  }
  const siblingHandoff =
    "../MessageGo/contracts/integrations/messagego-v2-secret-handoff.json";
  if (existsSync(siblingHandoff)) {
    const digest = createHash("sha256").update(readFileSync(siblingHandoff)).digest("hex");
    assert.equal(digest, HANDOFF_DIGEST);
  }
});

test("Phase 1 contract hash is unchanged", () => {
  const hashed = spawnSync("git", ["hash-object", "docs/phase-1-product-contract.md"], {
    encoding: "utf8",
  });
  assert.equal(hashed.status, 0, hashed.stderr);
  assert.equal(hashed.stdout.trim(), PHASE1_HASH);
});

test("production compose declares default-off MessageGo AI gates and no bearer settlement secret", () => {
  const compose = readFileSync("compose.production.yaml", "utf8");
  assert.equal(compose.includes("MESSAGEGO_SETTLEMENT_SERVICE_CREDENTIAL"), false);
  assert.match(compose, /MESSAGEGO_SETTLEMENT_ENABLED: \$\{MESSAGEGO_SETTLEMENT_ENABLED:-false\}/);
  assert.match(compose, /MESSAGEGO_CUSTOMER_AI_ENABLED: \$\{MESSAGEGO_CUSTOMER_AI_ENABLED:-false\}/);
  assert.match(compose, /MESSAGEGO_SECRET_HANDOFF_ENABLED: \$\{MESSAGEGO_SECRET_HANDOFF_ENABLED:-false\}/);
  assert.match(
    compose,
    /\$\{ABRCHIN_SERVICE_SECRET_ROOT:-\/srv\/abrchin\/secrets\/service\}:\/run\/secrets\/abrchin-service:ro/,
  );
  assert.match(
    compose,
    /MESSAGEGO_S2S_KEYRING_FILE: \/run\/secrets\/abrchin-service\/messagego-to-abrchin-keyring\.json/,
  );
  assert.match(
    compose,
    /MESSAGEGO_S2S_SIGNING_KEYRING_FILE: \/run\/secrets\/abrchin-service\/abrchin-to-messagego-keyring\.json/,
  );
});

test("empty HMAC keyring is rejected", () => {
  assert.throws(() => parseKeyringJSON(`{"protocol":"${S2S_PROTOCOL}","keys":[]}`));
});

test("loadKeyringFile requires an absolute mode-0600 file", async () => {
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "abrchin-keyring-"));
  const path = join(dir, "messagego-to-abrchin-keyring.json");
  writeFileSync(
    path,
    JSON.stringify({
      protocol: S2S_PROTOCOL,
      keys: [
        {
          key_id: "k_mg_ac_1",
          secret_hex: "11".repeat(32),
          direction: DIRECTION_MESSAGEGO_TO_ABRCHIN,
          status: "active",
        },
      ],
    }),
    { mode: 0o600 },
  );
  chmodSync(path, 0o600);
  try {
    const ring = loadKeyringFile(path);
    assert.equal(ring.protocol, S2S_PROTOCOL);
    assert.equal(ring.keys.length, 1);
    assert.throws(() => loadKeyringFile("messagego-to-abrchin-keyring.json"));
    chmodSync(path, 0o644);
    assert.throws(() => loadKeyringFile(path));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("HMAC settlement auth fail-closed matrix does not require postgres", async () => {
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { authenticateSettlementRequest } = await import("../lib/messagego/settlement/service-auth.ts");
  const { SettlementError } = await import("../lib/messagego/settlement/amount.ts");
  const { signRequest, DIRECTION_MESSAGEGO_TO_ABRCHIN, parseKeyringJSON: parseRing } =
    await import("../lib/messagego/s2s/hmac.ts");

  const dir = mkdtempSync(join(tmpdir(), "abrchin-hmac-"));
  const keyringPath = join(dir, "verify.json");
  const secret = Buffer.from("11".repeat(32), "hex");
  const ringJSON = JSON.stringify({
    protocol: S2S_PROTOCOL,
    keys: [
      {
        key_id: "k_mg_ac_1",
        secret_hex: "11".repeat(32),
        direction: "messagego_to_abrchin",
        status: "active",
      },
    ],
  });
  writeFileSync(keyringPath, ringJSON, { mode: 0o600 });
  chmodSync(keyringPath, 0o600);

  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    enabled: process.env.MESSAGEGO_SETTLEMENT_ENABLED,
    keyring: process.env.MESSAGEGO_S2S_KEYRING_FILE,
    allowed: process.env.MESSAGEGO_S2S_ALLOWED_SERVICE_IDS,
  };

  const signBody = Buffer.from(`{"operation":"reserve"}`);
  const signedHeaders = () => {
    const headers = new Headers({ "content-type": "application/json" });
    signRequest(
      headers,
      parseRing(ringJSON),
      DIRECTION_MESSAGEGO_TO_ABRCHIN,
      "messagego-runtime",
      "POST",
      "/api/internal/messagego/v2/settlement",
      "",
      signBody,
      "MESSAGEGO-V2-ABRCHIN-SETTLEMENT",
      "2.1.0",
    );
    return headers;
  };

  const requestFrom = (headers: Headers, body = signBody) =>
    new Request("http://127.0.0.1/api/internal/messagego/v2/settlement", {
      method: "POST",
      headers,
      body,
    });

  try {
    process.env.NODE_ENV = "production";
    delete process.env.MESSAGEGO_SETTLEMENT_ENABLED;
    process.env.MESSAGEGO_S2S_KEYRING_FILE = keyringPath;
    await assert.rejects(
      () => authenticateSettlementRequest(requestFrom(signedHeaders()), signBody),
      (error: unknown) => error instanceof SettlementError && error.code === "production_denied",
    );

    process.env.MESSAGEGO_SETTLEMENT_ENABLED = "true";
    delete process.env.MESSAGEGO_S2S_KEYRING_FILE;
    const hmacHeaders = signedHeaders();
    await assert.rejects(
      () => authenticateSettlementRequest(requestFrom(hmacHeaders), signBody),
      (error: unknown) =>
        error instanceof SettlementError && error.code === "settlement_runtime_unavailable",
    );

    process.env.MESSAGEGO_S2S_KEYRING_FILE = keyringPath;
    process.env.MESSAGEGO_S2S_ALLOWED_SERVICE_IDS = "messagego-runtime";
    await assert.rejects(
      () =>
        authenticateSettlementRequest(
          requestFrom(
            new Headers({
              authorization: `Bearer ${"x".repeat(32)}`,
              "x-messagego-caller-service-id": "messagego-test",
            }),
          ),
          Buffer.from("{}"),
        ),
      (error: unknown) => error instanceof SettlementError && error.code === "unauthenticated",
    );

    const tampered = signedHeaders();
    tampered.set("X-MessageGo-S2S-Signature", "aa".repeat(32));
    await assert.rejects(
      () => authenticateSettlementRequest(requestFrom(tampered), signBody),
      (error: unknown) => error instanceof SettlementError && error.code === "unauthenticated",
    );

    const wrongService = signedHeaders();
    wrongService.set("X-MessageGo-S2S-Service-Id", "other");
    await assert.rejects(
      () => authenticateSettlementRequest(requestFrom(wrongService), signBody),
      (error: unknown) => error instanceof SettlementError && error.code === "unauthenticated",
    );

    const expired = signedHeaders();
    expired.set("X-MessageGo-S2S-Timestamp", "100");
    await assert.rejects(
      () => authenticateSettlementRequest(requestFrom(expired), signBody),
      (error: unknown) => error instanceof SettlementError && error.code === "unauthenticated",
    );

    const missingNonce = signedHeaders();
    missingNonce.delete("X-MessageGo-S2S-Nonce");
    await assert.rejects(
      () => authenticateSettlementRequest(requestFrom(missingNonce), signBody),
      (error: unknown) => error instanceof SettlementError && error.code === "unauthenticated",
    );

    await assert.rejects(
      () =>
        authenticateSettlementRequest(
          requestFrom(signedHeaders(), Buffer.from(`{"operation":"settle"}`)),
          Buffer.from(`{"operation":"settle"}`),
        ),
      (error: unknown) => error instanceof SettlementError && error.code === "unauthenticated",
    );

    void secret;
  } finally {
    process.env.NODE_ENV = previous.NODE_ENV;
    if (previous.enabled === undefined) delete process.env.MESSAGEGO_SETTLEMENT_ENABLED;
    else process.env.MESSAGEGO_SETTLEMENT_ENABLED = previous.enabled;
    if (previous.keyring === undefined) delete process.env.MESSAGEGO_S2S_KEYRING_FILE;
    else process.env.MESSAGEGO_S2S_KEYRING_FILE = previous.keyring;
    if (previous.allowed === undefined) delete process.env.MESSAGEGO_S2S_ALLOWED_SERVICE_IDS;
    else process.env.MESSAGEGO_S2S_ALLOWED_SERVICE_IDS = previous.allowed;
    rmSync(dir, { recursive: true, force: true });
  }
});

