import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";

import { LedgerType, UserAccountStatus, WalletStatus } from "@prisma/client";

import { prisma } from "../lib/db.ts";
import {
  FailClosedControlPlanePort,
  setControlPlanePortForTests,
} from "../lib/messagego/customer/control-plane.ts";
import {
  getCustomerAiSurface,
  handoffCustomerProviderCredential,
} from "../lib/messagego/customer/surface.ts";
import { customerViewContainsForbiddenSecret } from "../lib/messagego/customer/view.ts";
import { reserveWalletAuthority } from "../lib/messagego/settlement/authority.ts";
import { creditWallet } from "../lib/wallet/ledger.ts";

if (!process.env.DATABASE_URL || process.env.ABRCHIN_ISOLATED_TEST !== "1") {
  throw new Error("WP09 integration postgres tests require isolated PostgreSQL");
}

const CANARY = "WP09_SECRET_CANARY_DO_NOT_LEAK";

after(async () => {
  setControlPlanePortForTests(null);
  await prisma.$disconnect();
});

async function fundedAccount() {
  const mobile = `09${randomBytes(5).toString("hex").slice(0, 9)}`;
  const user = await prisma.user.create({
    data: { mobile, accountStatus: UserAccountStatus.ACTIVE },
  });
  const wallet = await prisma.wallet.create({
    data: { userId: user.id, availableBalance: 500n, status: WalletStatus.ACTIVE },
  });
  return { user, wallet };
}

test("wallet top-up primitive still works beside MessageGo settlement", async () => {
  const fx = await fundedAccount();
  const topup = await creditWallet({
    userId: fx.user.id,
    amountRial: 200n,
    type: LedgerType.TOP_UP,
    idempotencyKey: `wp09-topup-${fx.user.id}`,
    referenceType: "wp09_regression",
  });
  assert.equal(topup.type, LedgerType.TOP_UP);
  const reserved = await reserveWalletAuthority({
    operationId: `op_${fx.user.id}`,
    accountId: fx.user.id,
    productId: "prod_a",
    workspaceId: "ws_a",
    runId: `run_${fx.user.id}`,
    usageReservationId: `ures_${fx.user.id}`,
    callerServiceId: "messagego-test",
    holdAmount: "100",
    pricingFingerprint: "ab".repeat(32),
    pricingVersion: "price.v2.test",
  });
  assert.equal(reserved.status, "reserved");
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: fx.wallet.id } });
  assert.equal(wallet.availableBalance, 600n);
  const ledger = await prisma.walletLedgerEntry.findMany({ where: { walletId: fx.wallet.id } });
  assert.equal(ledger.some((row) => row.type === LedgerType.TOP_UP), true);
  assert.equal(ledger.some((row) => row.type === LedgerType.MESSAGEGO_RESERVE_HOLD), true);
  assert.equal(ledger.filter((row) => row.id === topup.id).length, 1);
});

test("customer surface fail-closed on control-plane timeout and omits canary", async () => {
  const fx = await fundedAccount();
  setControlPlanePortForTests(new FailClosedControlPlanePort("timeout"));
  const handed = await handoffCustomerProviderCredential({
    userId: fx.user.id,
    productId: "prod_a",
    workspaceId: "ws_a",
    alias: "default",
    ownershipMode: "ACCOUNT_BYOK",
    familyAlias: "openai",
    credential: CANARY,
  });
  assert.equal(handed.ok, false);
  assert.equal(handed.code, "control_plane_unavailable");
  assert.equal("secretRef" in handed.connection, false);
  const surface = await getCustomerAiSurface(fx.user.id);
  assert.equal(surface.control_plane.fail_closed, true);
  assert.equal(surface.control_plane.available, false);
  assert.equal(surface.control_plane.inference_proxy, false);
  assert.equal(customerViewContainsForbiddenSecret(surface, [CANARY]), false);
  assert.equal(JSON.stringify(surface).includes("secretRef"), false);
});
