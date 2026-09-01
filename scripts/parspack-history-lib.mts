import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

export const DROP_PARSPACK_MIGRATION =
  "20260822090000_drop_parspack_provider";

export const ARCHIVE_MIGRATION = "20260901230000_parspack_history_archive";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export type ParsPackCountMap = Record<string, number>;

export type ParsPackAudit = {
  schema: string;
  databaseVersion: string | null;
  dropApplied: boolean;
  parspackEnumPresent: boolean;
  counts: ParsPackCountMap;
  commercialRowCount: number;
  liveChecksum: string;
};

export type ParsPackGateResult =
  | { ok: true; reason: string; audit: ParsPackAudit }
  | { ok: false; reason: string; audit: ParsPackAudit };

type ProviderSelect = {
  table: string;
  providerColumn?: "provider" | "service";
  planLink?: boolean;
  catalogLink?: boolean;
};

const PROVIDER_TABLES: ProviderSelect[] = [
  { table: "ServiceOrder", providerColumn: "provider" },
  { table: "RecommendationQuote", providerColumn: "provider" },
  { table: "ServiceRenewalQuote", providerColumn: "provider" },
  { table: "OperationalIncident", providerColumn: "provider" },
  { table: "InfrastructurePlan", providerColumn: "provider" },
  { table: "InfrastructureOrder", providerColumn: "provider" },
  { table: "ProviderFundingConfirmation", providerColumn: "provider" },
  { table: "CloudInstance", providerColumn: "provider" },
  { table: "ProviderOperationLog", providerColumn: "provider" },
  { table: "ProviderCatalogState", providerColumn: "provider" },
  { table: "ProviderBillingContractVersion", providerColumn: "provider" },
  { table: "ResourceVersion", providerColumn: "provider" },
  { table: "RateCardVersion", providerColumn: "provider" },
  { table: "BillingReconciliation", providerColumn: "provider" },
  { table: "ProviderCatalogItem", providerColumn: "provider" },
  { table: "PreprovisionedInventoryItem", providerColumn: "provider" },
  { table: "ProviderRegionConfig", providerColumn: "provider" },
  { table: "ProviderPricingConfig", providerColumn: "provider" },
  { table: "ProductPricingConfig", providerColumn: "provider" },
  { table: "ProviderCatalogAsset", providerColumn: "provider" },
  { table: "ProviderCatalogRegionState", providerColumn: "provider" },
  { table: "ProviderCatalogSyncRun", providerColumn: "provider" },
  { table: "ServiceConnectionCheck", providerColumn: "service" },
  { table: "BillingPolicyVersion", planLink: true },
  { table: "StorefrontAssortmentSlot", catalogLink: true },
  { table: "ResourceChangeRequest", planLink: true },
  { table: "ActivationRequest", planLink: true },
  { table: "ServiceSubscription", planLink: true },
];

function quoteIdent(name: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`invalid_identifier:${name}`);
  }
  return `"${name}"`;
}

async function tableExists(db: PrismaClient, table: string) {
  const rows = await db.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = ${table}
    ) AS exists
  `;
  return rows[0]?.exists === true;
}

function whereSql(spec: ProviderSelect) {
  if (spec.providerColumn) {
    return `${quoteIdent(spec.providerColumn)}::text = 'PARSPACK'`;
  }
  if (spec.planLink) {
    return `${quoteIdent("planId")} IN (SELECT ${quoteIdent("id")} FROM ${quoteIdent("InfrastructurePlan")} WHERE ${quoteIdent("provider")}::text = 'PARSPACK')`;
  }
  if (spec.catalogLink) {
    return `${quoteIdent("catalogItemId")} IN (SELECT ${quoteIdent("id")} FROM ${quoteIdent("ProviderCatalogItem")} WHERE ${quoteIdent("provider")}::text = 'PARSPACK')`;
  }
  throw new Error(`unsupported_spec:${spec.table}`);
}

export async function parspackEnumPresent(db: PrismaClient) {
  const rows = await db.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_enum
      JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
      JOIN pg_namespace ON pg_namespace.oid = pg_type.typnamespace
      WHERE pg_namespace.nspname = current_schema()
        AND pg_type.typname = 'InfrastructureProvider'
        AND pg_enum.enumlabel = 'PARSPACK'
    ) AS exists
  `;
  return rows[0]?.exists === true;
}

export async function dropMigrationApplied(db: PrismaClient) {
  if (!(await tableExists(db, "_prisma_migrations"))) return false;
  const rows = await db.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS n
    FROM "_prisma_migrations"
    WHERE migration_name = ${DROP_PARSPACK_MIGRATION}
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  `;
  return Number(rows[0]?.n ?? 0) > 0;
}

async function countTable(db: PrismaClient, spec: ProviderSelect) {
  if (!(await tableExists(db, spec.table))) return 0;
  if (!(await parspackEnumPresent(db)) && (spec.providerColumn || spec.planLink || spec.catalogLink)) {
    if (spec.providerColumn) return 0;
    if (!(await tableExists(db, "InfrastructurePlan")) && spec.planLink) return 0;
    if (!(await tableExists(db, "ProviderCatalogItem")) && spec.catalogLink) return 0;
    if (!(await parspackEnumPresent(db))) return 0;
  }
  if (!(await parspackEnumPresent(db))) return 0;
  const sql = `SELECT COUNT(*)::bigint AS n FROM ${quoteIdent(spec.table)} WHERE ${whereSql(spec)}`;
  const rows = await db.$queryRawUnsafe<Array<{ n: bigint }>>(sql);
  return Number(rows[0]?.n ?? 0);
}

function parsPackWalletLedgerWhere(alias = "t") {
  return `${alias}."walletId" IN (
      SELECT w.id FROM ${quoteIdent("Wallet")} w
      WHERE w."userId" IN (
        SELECT "userId" FROM ${quoteIdent("ServiceOrder")} WHERE "provider"::text = 'PARSPACK'
        UNION
        SELECT "userId" FROM ${quoteIdent("InfrastructureOrder")} WHERE "provider"::text = 'PARSPACK'
      )
    )
    OR ${alias}."referenceId" IN (SELECT id FROM ${quoteIdent("ServiceOrder")} WHERE "provider"::text = 'PARSPACK')
    OR ${alias}."referenceId" IN (SELECT id FROM ${quoteIdent("InfrastructureOrder")} WHERE "provider"::text = 'PARSPACK')`;
}

async function relatedLedgerCount(db: PrismaClient) {
  if (
    !(await tableExists(db, "WalletLedgerEntry")) ||
    !(await tableExists(db, "Wallet")) ||
    !(await tableExists(db, "ServiceOrder"))
  ) {
    return 0;
  }
  if (!(await parspackEnumPresent(db))) return 0;
  const sql = `SELECT COUNT(*)::bigint AS n FROM ${quoteIdent("WalletLedgerEntry")} t WHERE ${parsPackWalletLedgerWhere("t")}`;
  const rows = await db.$queryRawUnsafe<Array<{ n: bigint }>>(sql);
  return Number(rows[0]?.n ?? 0);
}

async function relatedAuditCount(db: PrismaClient) {
  if (!(await tableExists(db, "AuditLog")) || !(await tableExists(db, "ServiceOrder"))) {
    return 0;
  }
  if (!(await parspackEnumPresent(db))) return 0;
  const rows = await db.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS n
    FROM "AuditLog" audit
    WHERE audit."entityId" IN (
      SELECT id FROM "ServiceOrder" WHERE "provider"::text = 'PARSPACK'
    )
       OR audit."entityId" IN (
      SELECT id FROM "InfrastructureOrder" WHERE "provider"::text = 'PARSPACK'
    )
       OR audit."entityId" IN (
      SELECT id FROM "CloudInstance" WHERE "provider"::text = 'PARSPACK'
    )
  `;
  return Number(rows[0]?.n ?? 0);
}

async function relatedApprovalCount(db: PrismaClient) {
  if (!(await tableExists(db, "AdminCommandReceipt"))) return 0;
  if (!(await parspackEnumPresent(db))) return 0;
  const rows = await db.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS n
    FROM "AdminCommandReceipt" receipt
    WHERE receipt."serviceOrderId" IN (
      SELECT id FROM "ServiceOrder" WHERE "provider"::text = 'PARSPACK'
    )
       OR receipt."infrastructureOrderId" IN (
      SELECT id FROM "InfrastructureOrder" WHERE "provider"::text = 'PARSPACK'
    )
  `;
  return Number(rows[0]?.n ?? 0);
}

export async function auditParsPackHistory(db: PrismaClient): Promise<ParsPackAudit> {
  const schemaRows = await db.$queryRaw<Array<{ schema: string }>>`
    SELECT current_schema() AS schema
  `;
  const versionRows = await db.$queryRaw<Array<{ v: string }>>`
    SELECT current_setting('server_version') AS v
  `;
  const dropApplied = await dropMigrationApplied(db);
  const enumPresent = await parspackEnumPresent(db);
  const counts: ParsPackCountMap = {};
  if (enumPresent) {
    for (const spec of PROVIDER_TABLES) {
      counts[spec.table] = await countTable(db, spec);
    }
    counts.WalletLedgerEntry = await relatedLedgerCount(db);
    counts.AuditLog = await relatedAuditCount(db);
    counts.AdminCommandReceipt = await relatedApprovalCount(db);
  } else {
    for (const spec of PROVIDER_TABLES) counts[spec.table] = 0;
    counts.WalletLedgerEntry = 0;
    counts.AuditLog = 0;
    counts.AdminCommandReceipt = 0;
  }
  const commercialRowCount = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const liveChecksum = createHash("sha256")
    .update(JSON.stringify(counts), "utf8")
    .digest("hex");
  return {
    schema: schemaRows[0]?.schema ?? "public",
    databaseVersion: versionRows[0]?.v ?? null,
    dropApplied,
    parspackEnumPresent: enumPresent,
    counts,
    commercialRowCount,
    liveChecksum,
  };
}

function sqlStatements(sql: string) {
  const withoutComments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return withoutComments
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

export async function ensureArchiveTables(db: PrismaClient) {
  const sql = await readFile(
    join(root, "prisma/migrations", ARCHIVE_MIGRATION, "migration.sql"),
    "utf8",
  );
  for (const statement of sqlStatements(sql)) {
    await db.$executeRawUnsafe(statement);
  }
}

async function copyQuery(db: PrismaClient, table: string, whereSqlText: string) {
  if (!(await tableExists(db, table))) return 0;
  const sql = `SELECT to_jsonb(t) AS payload FROM ${quoteIdent(table)} t WHERE ${whereSqlText}`;
  let rows: Array<{ payload: Record<string, unknown> }>;
  try {
    rows = await db.$queryRawUnsafe<Array<{ payload: Record<string, unknown> }>>(sql);
  } catch (error) {
    throw new Error(
      `parspack_archive_copy_failed:${table}: ${error instanceof Error ? error.message : String(error)}\n${sql}`,
    );
  }
  for (const row of rows) {
    const sourceId = row.payload?.id;
    if (typeof sourceId !== "string" || sourceId.length === 0) {
      throw new Error(`parspack_archive_row_missing_id:${table}`);
    }
    const payloadJson = JSON.stringify(row.payload);
    const sha = createHash("sha256").update(payloadJson).digest("hex");
    const archiveId = `pparch_${table}_${sourceId}`;
    await db.$executeRawUnsafe(
      `INSERT INTO "ParsPackArchivedRow" (
         "id", "sourceTable", "sourceId", "archivedAt", payload, "payloadSha256"
       ) VALUES ($1, $2, $3, NOW(), $4::jsonb, $5)
       ON CONFLICT ("sourceTable", "sourceId") DO UPDATE SET
         payload = EXCLUDED.payload,
         "payloadSha256" = EXCLUDED."payloadSha256",
         "archivedAt" = EXCLUDED."archivedAt"`,
      archiveId,
      table,
      sourceId,
      payloadJson,
      sha,
    );
  }
  return rows.length;
}

async function copySpec(db: PrismaClient, spec: ProviderSelect) {
  return copyQuery(db, spec.table, whereSql(spec));
}

export async function archiveParsPackHistory(db: PrismaClient) {
  if (!(await parspackEnumPresent(db))) {
    throw new Error(
      "parspack_archive_unavailable: InfrastructureProvider no longer contains PARSPACK; live rows cannot be copied. Restore from a backup taken before 20260822090000_drop_parspack_provider if history is required.",
    );
  }
  await ensureArchiveTables(db);
  const before = await auditParsPackHistory(db);
  if (before.commercialRowCount === 0) {
    throw new Error("parspack_archive_empty: no ParsPack commercial rows to archive");
  }
  for (const spec of PROVIDER_TABLES) {
    await copySpec(db, spec);
  }
  await copyQuery(db, "WalletLedgerEntry", parsPackWalletLedgerWhere("t"));
  await copyQuery(
    db,
    "AuditLog",
    `t."entityId" IN (SELECT id FROM "ServiceOrder" WHERE "provider"::text = 'PARSPACK')
      OR t."entityId" IN (SELECT id FROM "InfrastructureOrder" WHERE "provider"::text = 'PARSPACK')
      OR t."entityId" IN (SELECT id FROM "CloudInstance" WHERE "provider"::text = 'PARSPACK')`,
  );
  await copyQuery(
    db,
    "AdminCommandReceipt",
    `t."serviceOrderId" IN (SELECT id FROM "ServiceOrder" WHERE "provider"::text = 'PARSPACK')
      OR t."infrastructureOrderId" IN (SELECT id FROM "InfrastructureOrder" WHERE "provider"::text = 'PARSPACK')`,
  );

  const archived = await db.$queryRaw<Array<{ sourceTable: string; n: bigint }>>`
    SELECT "sourceTable", COUNT(*)::bigint AS n
    FROM "ParsPackArchivedRow"
    GROUP BY "sourceTable"
  `;
  const afterArchiveCounts: ParsPackCountMap = { ...before.counts };
  for (const row of archived) {
    afterArchiveCounts[`archived:${row.sourceTable}`] = Number(row.n);
  }
  const hashRows = await db.$queryRaw<Array<{ payloadSha256: string }>>`
    SELECT "payloadSha256"
    FROM "ParsPackArchivedRow"
    ORDER BY "sourceTable" ASC, "sourceId" ASC
  `;
  const afterChecksum = createHash("sha256")
    .update(hashRows.map((row) => row.payloadSha256).join(""), "utf8")
    .digest("hex");
  let verification: "PASS" | "FAIL" =
    afterChecksum.length === 64 && before.commercialRowCount > 0 ? "PASS" : "FAIL";
  for (const [table, count] of Object.entries(before.counts)) {
    const archivedCount = afterArchiveCounts[`archived:${table}`] ?? 0;
    if (archivedCount !== count) {
      verification = "FAIL";
    }
  }
  const receiptId = `ppreceipt_${randomBytes(8).toString("hex")}`;
  await db.$executeRaw`
    INSERT INTO "ParsPackArchiveReceipt" (
      "id", "createdAt", "dropMigrationName", "dropAlreadyApplied",
      "beforeCounts", "afterArchiveCounts", "beforeChecksum", "afterChecksum",
      "databaseVersion", "verificationResult", notes
    ) VALUES (
      ${receiptId},
      NOW(),
      ${DROP_PARSPACK_MIGRATION},
      false,
      ${JSON.stringify(before.counts)}::jsonb,
      ${JSON.stringify(afterArchiveCounts)}::jsonb,
      ${before.liveChecksum},
      ${afterChecksum},
      ${before.databaseVersion ?? "unknown"},
      ${verification},
      ${"Archived live ParsPack rows. Physical enum drop may proceed only after PASS."}
    )
  `;
  if (verification !== "PASS") {
    throw new Error("parspack_archive_verification_failed");
  }
  return {
    receiptId,
    before,
    afterChecksum,
    afterArchiveCounts,
  };
}

async function latestPassingReceipt(db: PrismaClient, expectedChecksum: string) {
  if (!(await tableExists(db, "ParsPackArchiveReceipt"))) return null;
  const rows = await db.$queryRaw<
    Array<{
      id: string;
      beforeChecksum: string;
      verificationResult: string;
    }>
  >`
    SELECT id, "beforeChecksum", "verificationResult"
    FROM "ParsPackArchiveReceipt"
    WHERE "verificationResult" = 'PASS'
    ORDER BY "createdAt" DESC
    LIMIT 1
  `;
  const receipt = rows[0];
  if (!receipt) return null;
  if (receipt.beforeChecksum !== expectedChecksum) return null;
  return receipt;
}

export async function assertParsPackDropGate(
  db: PrismaClient,
): Promise<ParsPackGateResult> {
  if (!(await tableExists(db, "_prisma_migrations"))) {
    const empty = await auditParsPackHistory(db);
    return {
      ok: true,
      reason: "fresh_database_no_migrations",
      audit: empty,
    };
  }
  const audit = await auditParsPackHistory(db);
  if (audit.dropApplied) {
    return {
      ok: true,
      reason: "drop_already_applied",
      audit,
    };
  }
  if (!audit.parspackEnumPresent) {
    return {
      ok: false,
      reason: "parspack_enum_missing_but_drop_not_recorded",
      audit,
    };
  }
  if (audit.commercialRowCount === 0) {
    return {
      ok: true,
      reason: "no_parspack_commercial_rows",
      audit,
    };
  }
  await ensureArchiveTables(db);
  const receipt = await latestPassingReceipt(db, audit.liveChecksum);
  if (!receipt) {
    return {
      ok: false,
      reason:
        "parspack_history_unarchived: financial/commercial ParsPack rows exist; run node --experimental-strip-types scripts/parspack-archive.mts before migrate deploy",
      audit,
    };
  }
  return {
    ok: true,
    reason: `archive_receipt:${receipt.id}`,
    audit,
  };
}

export function formatAudit(audit: ParsPackAudit) {
  return JSON.stringify(audit, null, 2);
}
