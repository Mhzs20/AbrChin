import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import test, { after } from "node:test";

import { PrismaClient, ServiceOrderStatus, WalletStatus } from "@prisma/client";

import { prisma } from "../lib/db.ts";
import { payOrderWithWallet, createServiceOrderFromQuote } from "../lib/orders/service.ts";
import { getActiveReadyServerPlanById } from "../lib/orders/plans.ts";
import { createReadyServerQuote } from "../lib/recommendation/quote-service.ts";
import { creditWallet } from "../lib/wallet/ledger.ts";
import { LedgerType } from "@prisma/client";
import { WalletError } from "../lib/wallet/errors.ts";

import {
  applyWp5TestEnv,
  createCustomerAndAdmin,
  createPublishedManualArvanPlan,
  enableMockGateway,
  idempotencyKey,
  wp5Suffix,
} from "./wp5-lib.mts";

if (!process.env.DATABASE_URL || process.env.ABRCHIN_ISOLATED_TEST !== "1") {
  throw new Error("WP5 runtime tests require isolated PostgreSQL");
}

applyWp5TestEnv();
process.env.WORKER_POLL_MS = "400";
process.env.BILLING_WORKER_INTERVAL_MS = "600000";

const children: ChildProcess[] = [];

after(async () => {
  for (const child of children) {
    if (child.pid) {
      try {
        process.kill(child.pid, "SIGTERM");
      } catch {
        /* already exited */
      }
    }
  }
  await prisma.$disconnect();
});

function freePort() {
  return new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("port"));
        return;
      }
      const port = address.port;
      server.close(() => resolvePort(port));
    });
    server.on("error", reject);
  });
}

function spawnTracked(command: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  return child;
}

async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`${label} timed out${last ? `: ${last}` : ""}`);
}

test("AbrChin worker restart continues heartbeat without duplicate jobs", async () => {
  const bundle = resolve("dist/worker/provisioning-worker.js");
  assert.equal(existsSync(bundle), true, "worker bundle must exist");
  await enableMockGateway(prisma);
  const startWorker = () =>
    spawnTracked("node", [bundle], {
      WORKER_ID: "wp5-runtime-worker",
    });
  let worker = startWorker();
  await waitFor(async () => {
    const row = await prisma.workerHeartbeat.findUnique({
      where: { id: "provisioning" },
    });
    return Boolean(row?.lastSeenAt);
  }, 20_000, "worker heartbeat");
  const first = await prisma.workerHeartbeat.findUniqueOrThrow({
    where: { id: "provisioning" },
  });
  worker.kill("SIGTERM");
  await waitFor(async () => worker.exitCode !== null || worker.killed, 8_000, "worker stop");
  worker = startWorker();
  await waitFor(async () => {
    const row = await prisma.workerHeartbeat.findUnique({
      where: { id: "provisioning" },
    });
    return Boolean(row && row.lastSeenAt.getTime() > first.lastSeenAt.getTime());
  }, 20_000, "worker heartbeat after restart");
  assert.equal(
    await prisma.provisioningJob.count({
      where: { workerId: "wp5-runtime-worker" },
    }),
    0,
  );
});

test("AbrChin web restart keeps /api/health", async () => {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const startWeb = () =>
    spawnTracked(
      "npx",
      ["next", "dev", "-H", "127.0.0.1", "-p", String(port)],
      {
        PORT: String(port),
        NEXT_TELEMETRY_DISABLED: "1",
      },
    );
  let web = startWeb();
  await waitFor(async () => {
    const response = await fetch(`${origin}/api/health`);
    if (!response.ok) return false;
    const body = (await response.json()) as { status?: string; service?: string };
    return body.status === "ok" && body.service === "abrchin-web";
  }, 180_000, "abrchin web health");
  web.kill("SIGTERM");
  await waitFor(async () => web.exitCode !== null || web.killed, 10_000, "abrchin web stop");
  web = startWeb();
  await waitFor(async () => {
    const response = await fetch(`${origin}/api/health`);
    if (!response.ok) return false;
    const body = (await response.json()) as { status?: string };
    return body.status === "ok";
  }, 180_000, "abrchin web health after restart");
});

test("PostgreSQL interruption does not double-debit a wallet order", async () => {
  await enableMockGateway(prisma);
  const suffix = wp5Suffix("pgint");
  const { plan } = await createPublishedManualArvanPlan(prisma, suffix);
  const { customer } = await createCustomerAndAdmin(prisma, suffix);
  const priced = await getActiveReadyServerPlanById(plan.id, { termMonths: 1 });
  assert.ok(priced);
  await creditWallet({
    userId: customer.id,
    amountRial: priced.pricing.finalPriceRial,
    type: LedgerType.TOP_UP,
    idempotencyKey: idempotencyKey(`wp5pgint${suffix}`),
    referenceType: "wp5_runtime",
  });
  const quoted = await createReadyServerQuote({
    planId: plan.id,
    userId: customer.id,
    idempotencyKey: idempotencyKey(`wp5pgq${suffix}`),
    termMonths: 1,
    delivery: {
      imageAssetId: `manual:${plan.id}`,
      accessMethod: "ONE_TIME_PASSWORD",
      serverName: "wp5pgint",
    },
  });
  const order = await createServiceOrderFromQuote(customer.id, quoted.quote.id);
  const admin = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });
  try {
    const pay = payOrderWithWallet(customer.id, order.id);
    const interrupt = (async () => {
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      await admin.$executeRawUnsafe(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND state = 'active'
          AND query ILIKE '%ServiceOrder%'
      `);
    })();
    const settled = await Promise.allSettled([pay, interrupt]);
    void settled;
    let paid;
    try {
      paid = await payOrderWithWallet(customer.id, order.id);
    } catch (error) {
      if (!(error instanceof WalletError)) throw error;
      paid = await payOrderWithWallet(customer.id, order.id);
    }
    assert.equal(paid.order.status, ServiceOrderStatus.PAID);
    assert.equal(
      await prisma.walletLedgerEntry.count({
        where: { referenceType: "order", referenceId: order.id },
      }),
      1,
    );
    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: customer.id },
    });
    assert.equal(wallet.status, WalletStatus.ACTIVE);
    assert.ok(wallet.availableBalance >= 0n);
  } finally {
    await admin.$disconnect();
  }
});
