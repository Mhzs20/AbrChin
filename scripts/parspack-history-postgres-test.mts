/**
 * Fresh + upgrade coverage for ParsPack history preservation.
 * Does not rewrite 20260822090000_drop_parspack_provider.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { PrismaClient } from "@prisma/client";

import {
  ARCHIVE_MIGRATION,
  DROP_PARSPACK_MIGRATION,
  archiveParsPackHistory,
  assertParsPackDropGate,
  auditParsPackHistory,
} from "./parspack-history-lib.mts";

const execFileAsync = promisify(execFile);

const baseUrl =
  process.env.POSTGRES_TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!baseUrl) {
  throw new Error("DATABASE_URL or POSTGRES_TEST_DATABASE_URL required");
}

const PRE_DROP_HEAD = "20260810220000_parchin_operations_v3";

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
  const tmp = await mkdtemp(join(tmpdir(), "abrchin-parspack-"));
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
    "scripts/fixtures/parspack-financial-history.sql",
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

async function archivedAmount(prisma: PrismaClient, table: string, field: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ total: bigint | null }>>(
    `SELECT COALESCE(SUM((payload->>'${field}')::bigint), 0)::bigint AS total
     FROM "ParsPackArchivedRow"
     WHERE "sourceTable" = '${table}'`,
  );
  return Number(rows[0]?.total ?? 0);
}

console.log("[parspack-history] fresh migrate deploy…");
await withSchema("ppfresh", async (databaseUrl, prisma) => {
  const gateBefore = await assertParsPackDropGate(prisma);
  assert.equal(gateBefore.ok, true);
  await migrateDeploy(databaseUrl);
  const migrations = await prisma.$queryRaw<Array<{ migration_name: string }>>`
    SELECT migration_name FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL
  `;
  assert.ok(migrations.some((row) => row.migration_name === DROP_PARSPACK_MIGRATION));
  assert.ok(migrations.some((row) => row.migration_name === ARCHIVE_MIGRATION));
  const audit = await auditParsPackHistory(prisma);
  assert.equal(audit.dropApplied, true);
  assert.equal(audit.parspackEnumPresent, false);
  assert.equal(audit.commercialRowCount, 0);
  const archiveCount = await prisma.parsPackArchivedRow.count();
  assert.equal(archiveCount, 0);
  const evidenceColumn = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'ParchinPricingConfig'
      AND column_name = 'operationalEvidenceApprovedAt'
  `;
  assert.equal(evidenceColumn.length, 1);
});
console.log("[parspack-history] fresh PASS");

console.log("[parspack-history] upgrade with ParsPack financial fixture…");
await withSchema("ppupgrade", async (databaseUrl, prisma) => {
  const cut = await buildCutPrismaProject(PRE_DROP_HEAD);
  try {
    await migrateDeploy(databaseUrl, cut.schemaFile);
    const beforeDrop = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL
    `;
    assert.ok(beforeDrop.some((row) => row.migration_name === PRE_DROP_HEAD));
    assert.ok(!beforeDrop.some((row) => row.migration_name === DROP_PARSPACK_MIGRATION));

    await applyFixture(prisma);
    const preAudit = await auditParsPackHistory(prisma);
    assert.ok(preAudit.parspackEnumPresent);
    assert.ok(preAudit.counts.ServiceOrder >= 1);
    assert.ok(preAudit.counts.InfrastructureOrder >= 1);
    assert.ok(preAudit.counts.CloudInstance >= 1);
    assert.ok(preAudit.counts.ServiceSubscription >= 1);
    assert.ok(preAudit.counts.RecommendationQuote >= 1);
    assert.ok(preAudit.counts.WalletLedgerEntry >= 2);
    assert.ok(preAudit.counts.AuditLog >= 1);
    assert.ok(preAudit.counts.AdminCommandReceipt >= 1);
    assert.ok(preAudit.counts.BillingReconciliation >= 1);
    assert.equal(preAudit.commercialRowCount > 0, true);

    const blocked = await assertParsPackDropGate(prisma);
    assert.equal(blocked.ok, false);
    assert.match(blocked.reason, /parspack_history_unarchived/);

    const archived = await archiveParsPackHistory(prisma);
    assert.equal(archived.before.commercialRowCount, preAudit.commercialRowCount);
    const allowed = await assertParsPackDropGate(prisma);
    assert.equal(allowed.ok, true);

    await migrateDeploy(databaseUrl);
    const after = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL
    `;
    assert.ok(after.some((row) => row.migration_name === DROP_PARSPACK_MIGRATION));
    assert.ok(after.some((row) => row.migration_name === ARCHIVE_MIGRATION));

    const liveOrders = await prisma.serviceOrder.findMany({
      where: { id: "parspack-hist-order" },
    });
    assert.equal(liveOrders.length, 1);
    assert.equal(liveOrders[0]?.provider, null);
    assert.equal(Number(liveOrders[0]?.amount ?? 0), 12_500_000);

    const liveLedger = await prisma.walletLedgerEntry.findMany({
      where: { walletId: "parspack-hist-wallet" },
      orderBy: { createdAt: "asc" },
    });
    const ledgerTotal = liveLedger.reduce(
      (sum, row) =>
        sum + (row.direction === "CREDIT" ? Number(row.amount) : -Number(row.amount)),
      0,
    );
    assert.equal(ledgerTotal, 2_500_000);

    const archivedOrderAmount = await archivedAmount(
      prisma,
      "ServiceOrder",
      "amount",
    );
    assert.equal(archivedOrderAmount, 12_500_000);
    const archivedInfraFunding = await archivedAmount(
      prisma,
      "InfrastructureOrder",
      "requiredFundingRial",
    );
    assert.equal(archivedInfraFunding, 8_000_000);
    const archivedDebit = await prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COALESCE(SUM((payload->>'amount')::bigint), 0)::bigint AS total
      FROM "ParsPackArchivedRow"
      WHERE "sourceTable" = 'WalletLedgerEntry'
        AND payload->>'type' = 'SERVICE_PURCHASE'
    `;
    assert.equal(Number(archivedDebit[0]?.total ?? 0), 12_500_000);

    const archivedAudit = await prisma.parsPackArchivedRow.findFirst({
      where: { sourceTable: "AuditLog", sourceId: "parspack-hist-audit" },
    });
    assert.ok(archivedAudit);
    const auditPayload = archivedAudit?.payload as { entityId?: string };
    assert.equal(auditPayload.entityId, "parspack-hist-order");

    const archivedInstance = await prisma.parsPackArchivedRow.findFirst({
      where: { sourceTable: "CloudInstance", sourceId: "parspack-hist-instance" },
    });
    assert.ok(archivedInstance);
    const liveInstance = await prisma.cloudInstance.findUnique({
      where: { id: "parspack-hist-instance" },
    });
    assert.equal(liveInstance, null);

    const archivedQuote = await prisma.parsPackArchivedRow.findFirst({
      where: { sourceTable: "RecommendationQuote", sourceId: "parspack-hist-quote" },
    });
    assert.ok(archivedQuote);
    const quotePayload = archivedQuote?.payload as { amountRial?: number | string };
    assert.equal(Number(quotePayload.amountRial), 12_500_000);

    const archivedSub = await prisma.parsPackArchivedRow.findFirst({
      where: {
        sourceTable: "ServiceSubscription",
        sourceId: "parspack-hist-sub",
      },
    });
    assert.ok(archivedSub);

    const receipt = await prisma.parsPackArchiveReceipt.findFirst({
      orderBy: { createdAt: "desc" },
    });
    assert.equal(receipt?.verificationResult, "PASS");
    assert.equal(receipt?.beforeChecksum, preAudit.liveChecksum);

    const postAudit = await auditParsPackHistory(prisma);
    assert.equal(postAudit.dropApplied, true);
    assert.equal(postAudit.parspackEnumPresent, false);
  } finally {
    await cut.cleanup();
  }
});
console.log("[parspack-history] upgrade PASS");
