/**
 * Release gate: verify customer-identity migration on a fresh schema and as an
 * upgrade from current main (ending at 20260807140000_support_requests).
 * Uses isolated Postgres schemas — never prisma migrate reset.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
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

const MAIN_HEAD_MIGRATION = "20260807140000_support_requests";
const IDENTITY_MIGRATION =
  "20260807150000_customer_identity_email_verification";

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
  const url = new URL(baseUrl);
  url.searchParams.set("schema", schema);
  const databaseUrl = url.toString();
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    return await fn(databaseUrl, prisma);
  } finally {
    await prisma
      .$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      .catch(() => undefined);
    await prisma.$disconnect();
  }
}

async function assertIdentityColumns(prisma: PrismaClient) {
  const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'User'
      AND column_name IN (
        'firstName', 'lastName', 'email', 'emailVerifiedAt', 'registrationCompletedAt'
      )
    ORDER BY column_name ASC
  `;
  assert.deepEqual(
    cols.map((c) => c.column_name).sort(),
    [
      "email",
      "emailVerifiedAt",
      "firstName",
      "lastName",
      "registrationCompletedAt",
    ].sort(),
  );
  const challenge = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = 'EmailVerificationChallenge'
    ) AS exists
  `;
  assert.equal(challenge[0]?.exists, true);
}

async function buildMainHeadPrismaProject() {
  const tmp = await mkdtemp(join(tmpdir(), "abrchin-mig-"));
  const prismaDir = join(tmp, "prisma");
  const migrationsDir = join(prismaDir, "migrations");
  await mkdir(migrationsDir, { recursive: true });
  const schemaSrc = await readFile("prisma/schema.prisma", "utf8");
  await writeFile(join(prismaDir, "schema.prisma"), schemaSrc);
  await cp(
    "prisma/migrations/migration_lock.toml",
    join(migrationsDir, "migration_lock.toml"),
  );
  const entries = await readdir("prisma/migrations", { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name > MAIN_HEAD_MIGRATION) continue;
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

console.log("[identity-migration] fresh empty DB migrate deploy…");
await withSchema("idfresh", async (databaseUrl, prisma) => {
  await migrateDeploy(databaseUrl);
  const migrations = await prisma.$queryRaw<Array<{ migration_name: string }>>`
    SELECT migration_name FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL
    ORDER BY migration_name ASC
  `;
  assert.ok(
    migrations.some((m) => m.migration_name === IDENTITY_MIGRATION),
    "fresh deploy must include identity migration",
  );
  await assertIdentityColumns(prisma);

  const mobile = `0912${randomBytes(4).toString("hex").slice(0, 7)}`;
  const created = await prisma.user.create({
    data: {
      mobile,
      role: "CUSTOMER",
      accountStatus: "ACTIVE",
      mobileVerifiedAt: new Date(),
    },
  });
  assert.equal(created.registrationCompletedAt, null);
  assert.equal(created.email, null);
});
console.log("[identity-migration] fresh PASS");

console.log("[identity-migration] upgrade from main head schema…");
await withSchema("idupgrade", async (databaseUrl, prisma) => {
  const mainHead = await buildMainHeadPrismaProject();
  try {
    await migrateDeploy(databaseUrl, mainHead.schemaFile);

    const before = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL
      ORDER BY migration_name ASC
    `;
    assert.ok(
      before.some((m) => m.migration_name === MAIN_HEAD_MIGRATION),
      "main-head migrations must be applied",
    );
    assert.ok(
      !before.some((m) => m.migration_name === IDENTITY_MIGRATION),
      "identity migration must not exist yet",
    );

    const historicalMobile = `0913${randomBytes(4).toString("hex").slice(0, 7)}`;
    const historicalId = `hist_${randomBytes(6).toString("hex")}`;
    const createdAt = new Date("2026-01-15T12:00:00.000Z");
    await prisma.$executeRawUnsafe(
      `INSERT INTO "User" (id, mobile, role, "accountStatus", "mobileVerifiedAt", "createdAt", "updatedAt")
       VALUES ($1, $2, 'CUSTOMER', 'ACTIVE', $3::timestamp, $4::timestamp, $4::timestamp)`,
      historicalId,
      historicalMobile,
      createdAt.toISOString(),
      createdAt.toISOString(),
    );

    // Apply remaining migrations from the real repo (identity + any later).
    await migrateDeploy(databaseUrl);

    const after = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL
      ORDER BY migration_name ASC
    `;
    assert.ok(
      after.some((m) => m.migration_name === IDENTITY_MIGRATION),
      "upgrade must apply identity migration",
    );
    await assertIdentityColumns(prisma);

    const historical = await prisma.user.findUniqueOrThrow({
      where: { mobile: historicalMobile },
    });
    assert.ok(historical.registrationCompletedAt);
    assert.equal(
      historical.registrationCompletedAt.toISOString(),
      createdAt.toISOString(),
    );
    assert.equal(historical.email, null);
    assert.equal(historical.firstName, null);

    await prisma.user.create({
      data: {
        mobile: `0914${randomBytes(4).toString("hex").slice(0, 7)}`,
        role: "CUSTOMER",
        accountStatus: "ACTIVE",
        email: "unique-upgrade@example.com",
        registrationCompletedAt: new Date(),
      },
    });
    await assert.rejects(
      () =>
        prisma.user.create({
          data: {
            mobile: `0915${randomBytes(4).toString("hex").slice(0, 7)}`,
            role: "CUSTOMER",
            accountStatus: "ACTIVE",
            email: "unique-upgrade@example.com",
            registrationCompletedAt: new Date(),
          },
        }),
      (err: unknown) =>
        err instanceof Error &&
        (/Unique constraint|P2002/i.test(err.message) ||
          (err as { code?: string }).code === "P2002"),
    );
  } finally {
    await mainHead.cleanup();
  }
});
console.log("[identity-migration] upgrade from main PASS");
console.log("[identity-migration] all gates passed");
