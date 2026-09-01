import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient, UserRole } from "@prisma/client";

import { WalletError } from "../lib/wallet/errors.ts";
import { ensureStorefrontSaleReady } from "../lib/storefront/ensure-sale-plans.ts";
import { replaceStorefrontTierSlots } from "../lib/storefront/assortment-service.ts";

const databaseUrl = process.env.DATABASE_URL;
const runIsolated = process.env.ABRCHIN_ISOLATED_TEST === "1";
const prisma =
  databaseUrl && runIsolated
    ? new PrismaClient({
        transactionOptions: { maxWait: 10_000, timeout: 30_000 },
      })
    : null;

test("customers and guests cannot publish storefront sale configuration", async (t) => {
  if (!prisma) {
    t.skip("requires ABRCHIN_ISOLATED_TEST=1 and DATABASE_URL");
    return;
  }

  const suffix = Date.now().toString(36);
  const customer = await prisma.user.create({
    data: {
      mobile: `091${suffix.slice(-8).padStart(8, "0")}`,
      role: UserRole.CUSTOMER,
    },
  });

  await assert.rejects(
    () => ensureStorefrontSaleReady({ actorUserId: customer.id }),
    (error: unknown) =>
      error instanceof WalletError && error.code === "forbidden",
  );
  await assert.rejects(
    () =>
      replaceStorefrontTierSlots({
        tier: "NO",
        slots: [],
        actorUserId: customer.id,
      }),
    (error: unknown) =>
      error instanceof WalletError && error.code === "forbidden",
  );

  const guestId = "guest-actor-not-a-user";
  await assert.rejects(
    () => ensureStorefrontSaleReady({ actorUserId: guestId }),
    (error: unknown) =>
      error instanceof WalletError && error.code === "forbidden",
  );
});
