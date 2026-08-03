import assert from "node:assert/strict";

import { PrismaClient } from "@prisma/client";

import { withIsolatedPostgres } from "./postgres-isolation.mts";

await withIsolatedPostgres("fresh", async (databaseUrl) => {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const migrations = await db.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL
      ORDER BY migration_name ASC
    `;
    assert.ok(
      migrations.some(
        (migration) =>
          migration.migration_name ===
          "20260803190000_provider_billing_contract_gate",
      ),
      "fresh schema must include the Provider Billing Contract migration",
    );
    assert.equal(
      await db.providerBillingContractVersion.count({
        where: {
          productKind: "CLOUD_SERVER",
          status: "UNVERIFIED",
        },
      }),
      2,
    );
  } finally {
    await db.$disconnect();
  }
});

console.log("[fresh-migration] isolated fresh migration passed");
