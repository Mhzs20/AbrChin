import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";

import { UserAccountStatus, WalletStatus } from "@prisma/client";

import { prisma } from "../lib/db.ts";
import {
  customerViewContainsForbiddenSecret,
  getCustomerAiSurface,
  handoffCustomerProviderCredential,
} from "../lib/messagego/customer/surface.ts";
import { reserveWalletAuthority } from "../lib/messagego/settlement/authority.ts";

if (!process.env.DATABASE_URL || process.env.ABRCHIN_ISOLATED_TEST !== "1") {
  throw new Error("MessageGo V2 customer UX tests require isolated PostgreSQL");
}

after(async () => {
  await prisma.$disconnect();
});

test("customer surface shows AbrChin financial state and never returns raw provider secrets", async () => {
  const suffix = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const user = await prisma.user.create({
    data: {
      mobile: `09${randomBytes(6).readUIntBE(0, 6).toString().padStart(11, "0").slice(0, 9)}`,
      accountStatus: UserAccountStatus.ACTIVE,
    },
  });
  await prisma.wallet.create({
    data: {
      userId: user.id,
      availableBalance: 5_000n,
      status: WalletStatus.ACTIVE,
    },
  });

  const reserved = await reserveWalletAuthority({
    operationId: `op_ux_${suffix}`,
    accountId: user.id,
    productId: "prod_ux",
    workspaceId: "ws_ux",
    runId: `run_ux_${suffix}`,
    usageReservationId: `ures_ux_${suffix}`,
    callerServiceId: "messagego-test",
    holdAmount: "1200",
    pricingFingerprint: "cd".repeat(32),
    pricingVersion: "price.v2.test",
  });
  assert.equal(reserved.status, "reserved");

  process.env.MESSAGEGO_BASE_URL = "";
  process.env.MESSAGEGO_CLIENT_ID = "";
  process.env.MESSAGEGO_CLIENT_SECRET = "";
  const closed = await getCustomerAiSurface(user.id);
  assert.equal(closed.control_plane.fail_closed, true);
  assert.equal(closed.control_plane.inference_proxy, false);
  assert.equal(closed.control_plane.wallet_owner, "abrchin");
  assert.equal(closed.wallet.reserved_ai_rial, "1200");
  assert.equal(closed.reservations.length, 1);

  const secret = `sk_test_FAKE_${suffix}`;
  const failedHandoff = await handoffCustomerProviderCredential({
    userId: user.id,
    productId: "prod_ux",
    workspaceId: "ws_ux",
    alias: "default",
    ownershipMode: "ACCOUNT_BYOK",
    familyAlias: "openai-compatible",
    credential: secret,
  });
  assert.equal(failedHandoff.ok, false);
  assert.equal(failedHandoff.connection.secret_retained, false);
  assert.equal(customerViewContainsForbiddenSecret(failedHandoff, [secret]), false);

  process.env.MESSAGEGO_BASE_URL = "http://127.0.0.1:9";
  process.env.MESSAGEGO_CLIENT_ID = "abrchin-test";
  process.env.MESSAGEGO_CLIENT_SECRET = "x".repeat(32);
  process.env.MESSAGEGO_TENANT_ID = "abrchin";
  process.env.MESSAGEGO_WORKSPACE_ID = "test";
  process.env.MESSAGEGO_SECRET_HANDOFF_MODE = "memory_test";

  const handed = await handoffCustomerProviderCredential({
    userId: user.id,
    productId: "prod_ux",
    workspaceId: "ws_ux",
    alias: "default",
    ownershipMode: "ACCOUNT_BYOK",
    familyAlias: "openai-compatible",
    credential: secret,
  });
  assert.equal(handed.ok, true);
  assert.equal(handed.connection.status, "CONNECTED");
  assert.equal(customerViewContainsForbiddenSecret(handed, [secret]), false);
  assert.equal("secretRef" in handed.connection, false);

  const stored = await prisma.messageGoCustomerConnection.findFirstOrThrow({
    where: { userId: user.id, alias: "default" },
  });
  assert.ok(stored.secretRef);
  assert.equal(stored.secretRef.includes("sk_test_FAKE"), false);
  assert.notEqual(stored.secretRef, secret);

  const surface = await getCustomerAiSurface(user.id);
  assert.equal(surface.control_plane.available, true);
  assert.equal(customerViewContainsForbiddenSecret(surface, [secret, stored.secretRef ?? ""]), false);
  assert.equal(surface.connections[0]?.raw_key_readable, false);
});
