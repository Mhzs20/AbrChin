import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { PrismaClient } from "@prisma/client";

import { calculateQuotePricing } from "../lib/pricing/quote-line-items.ts";

const execFileAsync = promisify(execFile);
const baseUrl = process.env.POSTGRES_TEST_DATABASE_URL;
if (!baseUrl) {
  throw new Error(
    "POSTGRES_TEST_DATABASE_URL is required; the real PostgreSQL migration test was not run",
  );
}

const schemaName = `abrchin_migration_${Date.now().toString(36)}`;
const databaseUrl = new URL(baseUrl);
databaseUrl.searchParams.set("schema", schemaName);
const isolatedUrl = databaseUrl.toString();
const tempRoot = await mkdtemp(join(tmpdir(), "abrchin-pg-migration-"));
const tempPrisma = join(tempRoot, "prisma");
const tempMigrations = join(tempPrisma, "migrations");
await mkdir(tempMigrations, { recursive: true });
await cp("prisma/schema.prisma", join(tempPrisma, "schema.prisma"));

const migrationNames = (await readdir("prisma/migrations"))
  .filter((name) => /^\d/.test(name))
  .sort();
const multiProvider = "20260730160000_multi_provider_routing";
const hardening = "20260730190000_provider_review_hardening";

async function copyThrough(lastName: string) {
  for (const name of migrationNames.filter((entry) => entry <= lastName)) {
    await cp(
      join("prisma/migrations", name),
      join(tempMigrations, name),
      { recursive: true },
    );
  }
}

async function deploy() {
  await execFileAsync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    [
      "prisma",
      "migrate",
      "deploy",
      "--schema",
      join(tempPrisma, "schema.prisma"),
    ],
    {
      env: { ...process.env, DATABASE_URL: isolatedUrl },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
}

await copyThrough(
  migrationNames.filter((name) => name < multiProvider).at(-1)!,
);
await deploy();

const db = new PrismaClient({
  datasources: { db: { url: isolatedUrl } },
});
try {
  await db.$executeRawUnsafe(`
    UPDATE "ProviderPricingConfig"
    SET "markupBasisPoints" = 2500
    WHERE "provider" = 'PARSPACK'
  `);

  await copyThrough(multiProvider);
  await deploy();
  const pricing = await db.$queryRawUnsafe<
    Array<{ providerMarkup: number; productMarkup: number }>
  >(`
    SELECT p."markupBasisPoints" AS "providerMarkup",
           k."markupBasisPoints" AS "productMarkup"
    FROM "ProviderPricingConfig" p
    JOIN "ProductPricingConfig" k
      ON k."provider" = p."provider"
    WHERE p."provider" = 'PARSPACK'
      AND k."productKind" = 'READY_INSTANT_SERVER'
  `);
  assert.deepEqual(pricing, [
    { providerMarkup: 2500, productMarkup: 0 },
  ]);
  const calculated = calculateQuotePricing({
    providerMonthlyPriceIrr: 5_000_000n,
    providerMarkupBps: pricing[0]!.providerMarkup,
    productMarkupBps: pricing[0]!.productMarkup,
    parchinLevel: "PARCHIN_START",
    parchinPriceIrr: 0n,
    taxBps: 0,
  });
  assert.equal(calculated.markupAmountIrr, 1_250_000n);

  await db.$executeRawUnsafe(`
    INSERT INTO "RecommendationSession" (
      "id", "status", "answers", "answerSources", "productFlowState",
      "expiresAt", "createdAt", "updatedAt"
    ) VALUES (
      'legacy-quoted-without-delivery', 'QUOTED', '{}', '{}', 'QUOTED',
      CURRENT_TIMESTAMP + INTERVAL '1 hour',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `);

  await copyThrough(hardening);
  await deploy();
  const mapped = await db.$queryRawUnsafe<
    Array<{ productFlowState: string }>
  >(`
    SELECT "productFlowState"
    FROM "RecommendationSession"
    WHERE "id" = 'legacy-quoted-without-delivery'
  `);
  assert.equal(mapped[0]?.productFlowState, "RECOMMENDED");

  await db.recommendationSession.create({
    data: {
      id: "conversation-concurrency",
      status: "PROFILING",
      answers: {},
      answerSources: {},
      productFlowState: "DRAFT",
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const concurrent = await Promise.all([
    db.recommendationSession.updateMany({
      where: { id: "conversation-concurrency", revision: 0 },
      data: {
        answers: { project: "api" },
        revision: { increment: 1 },
      },
    }),
    db.recommendationSession.updateMany({
      where: { id: "conversation-concurrency", revision: 0 },
      data: {
        answers: { project: "commerce" },
        revision: { increment: 1 },
      },
    }),
  ]);
  assert.deepEqual(
    concurrent.map(({ count }) => count).sort(),
    [0, 1],
  );
  const conversation =
    await db.recommendationSession.findUniqueOrThrow({
      where: { id: "conversation-concurrency" },
      select: { revision: true, answers: true },
    });
  assert.equal(conversation.revision, 1);
  assert.equal(
    ["api", "commerce"].includes(
      String(
        (conversation.answers as Record<string, unknown>).project,
      ),
    ),
    true,
  );
  console.log(
    "PostgreSQL migration integration passed: ParsPack 2500+0 bps, safe legacy state mapping, and optimistic conversation concurrency",
  );
} finally {
  await db.$executeRawUnsafe(
    `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`,
  );
  await db.$disconnect();
}
