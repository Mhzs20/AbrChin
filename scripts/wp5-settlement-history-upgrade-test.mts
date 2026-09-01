/**
 * Upgrade fixture: wallet, payment, quote, order, and MessageGo settlement
 * history must survive migrate deploy from the customer-pricing head to HEAD.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { PrismaClient } from "@prisma/client";

const execFileAsync = promisify(execFile);

const baseUrl =
  process.env.POSTGRES_TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!baseUrl) {
  throw new Error("DATABASE_URL or POSTGRES_TEST_DATABASE_URL required");
}

const SETTLEMENT_HEAD = "20260901120000_messagego_customer_pricing";
const ARCHIVE_MIGRATION = "20260901230000_parspack_history_archive";

async function migrateDeploy(databaseUrl: string, schemaFile?: string) {
  const args = ["prisma", "migrate", "deploy"];
  if (schemaFile) args.push("--schema", schemaFile);
  await execFileAsync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    args,
    {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
}

async function withSchema<T>(
  label: string,
  fn: (url: string, prisma: PrismaClient) => Promise<T>,
) {
  const schema = `abrchin_${label}_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
  const adminUrl = new URL(baseUrl);
  adminUrl.searchParams.delete("schema");
  const url = new URL(baseUrl);
  url.searchParams.set("schema", schema);
  const databaseUrl = url.toString();
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl.toString() } },
  });
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    return await fn(databaseUrl, prisma);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
    await admin
      .$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      .catch(() => undefined);
    await admin.$disconnect().catch(() => undefined);
  }
}

async function buildCutPrismaProject(lastMigration: string) {
  const tmp = await mkdtemp(join(tmpdir(), "abrchin-wp5-settle-"));
  const prismaDir = join(tmp, "prisma");
  const migrationsDir = join(prismaDir, "migrations");
  await mkdir(migrationsDir, { recursive: true });
  await writeFile(
    join(prismaDir, "schema.prisma"),
    await readFile("prisma/schema.prisma", "utf8"),
  );
  await cp(
    "prisma/migrations/migration_lock.toml",
    join(migrationsDir, "migration_lock.toml"),
  );
  const entries = await readdir("prisma/migrations", { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name > lastMigration) continue;
    await cp(
      join("prisma/migrations", entry.name),
      join(migrationsDir, entry.name),
      { recursive: true },
    );
  }
  return {
    schemaFile: join(prismaDir, "schema.prisma"),
    cleanup: async () => rm(tmp, { recursive: true, force: true }),
  };
}

async function applyFixture(prisma: PrismaClient) {
  const sql = await readFile(
    "scripts/fixtures/wp5-wallet-settlement-history.sql",
    "utf8",
  );
  const statements = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const statement of statements) {
    try {
      await prisma.$executeRawUnsafe(statement);
    } catch (error) {
      throw new Error(
        `fixture failed: ${error instanceof Error ? error.message : String(error)}\n${statement.slice(0, 240)}`,
      );
    }
  }
}

async function assertHistory(prisma: PrismaClient) {
  const wallet = await prisma.wallet.findUniqueOrThrow({
    where: { id: "wp5-hist-wallet" },
  });
  assert.equal(wallet.availableBalance, 4_999_800n);
  const ledger = await prisma.walletLedgerEntry.findMany({
    where: { walletId: "wp5-hist-wallet" },
  });
  assert.equal(ledger.length, 4);
  const net = ledger.reduce(
    (sum, row) =>
      sum + (row.direction === "CREDIT" ? row.amount : -row.amount),
    0n,
  );
  assert.equal(net, wallet.availableBalance);
  const topUp = await prisma.walletTopUp.findUniqueOrThrow({
    where: { id: "wp5-hist-topup" },
  });
  assert.equal(topUp.status, "SUCCEEDED");
  assert.equal(topUp.amount, 10_000_000n);
  const attempt = await prisma.paymentAttempt.findUniqueOrThrow({
    where: { id: "wp5-hist-attempt" },
  });
  assert.equal(attempt.status, "SUCCEEDED");
  const quote = await prisma.recommendationQuote.findUniqueOrThrow({
    where: { id: "wp5-hist-quote" },
  });
  assert.equal(quote.termMonths, 6);
  assert.equal(quote.amountRial, 5_000_000n);
  const order = await prisma.serviceOrder.findUniqueOrThrow({
    where: { id: "wp5-hist-order" },
  });
  assert.equal(order.amount, 5_000_000n);
  assert.equal(order.status, "PAID");
  const reservation = await prisma.messageGoAuthorityReservation.findUniqueOrThrow({
    where: { id: "wp5-hist-reservation" },
  });
  assert.equal(reservation.status, "SETTLED");
  assert.equal(reservation.holdAmountRial, 250n);
  assert.equal(reservation.settledAmountRial, 200n);
  assert.equal(reservation.remainingHoldRial, 0n);
  assert.equal(await prisma.messageGoSettlementOperation.count(), 2);
  assert.equal(await prisma.messageGoReservationEvent.count(), 2);
  assert.equal(await prisma.messageGoS2SReplayNonce.count(), 1);
  assert.equal(await prisma.auditLog.count({ where: { id: "wp5-hist-audit" } }), 1);
}

console.log("[wp5-settlement-history] upgrade from customer-pricing head…");
await withSchema("wp5settle", async (databaseUrl, prisma) => {
  const cut = await buildCutPrismaProject(SETTLEMENT_HEAD);
  try {
    await migrateDeploy(databaseUrl, cut.schemaFile);
    const before = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL
    `;
    assert.ok(before.some((row) => row.migration_name === SETTLEMENT_HEAD));
    assert.equal(
      before.some((row) => row.migration_name === ARCHIVE_MIGRATION),
      false,
    );
    await applyFixture(prisma);
    await assertHistory(prisma);
    await migrateDeploy(databaseUrl);
    const after = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL
    `;
    assert.ok(after.some((row) => row.migration_name === ARCHIVE_MIGRATION));
    await assertHistory(prisma);
    const evidence = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'ParchinPricingConfig'
        AND column_name = 'operationalEvidenceApprovedAt'
    `;
    assert.equal(evidence.length, 1);
  } finally {
    await cut.cleanup();
  }
});
console.log("[wp5-settlement-history] upgrade PASS");
