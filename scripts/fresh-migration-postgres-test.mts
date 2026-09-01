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
    assert.ok(
      migrations.some(
        (migration) =>
          migration.migration_name === "20260803200000_billing_runtime_safety",
      ),
      "fresh schema must include the Billing Runtime Safety migration",
    );
    for (const required of [
      "20260806200000_commercial_pricing_v3",
      "20260806210000_storefront_dominance_parchin_v3",
      "20260807010000_profit_curve_operational_accounting",
      "20260807020000_operating_expense_draft_idempotency",
      "20260807150000_customer_identity_email_verification",
      "20260901230000_parspack_history_archive",
    ]) {
      assert.ok(
        migrations.some((migration) => migration.migration_name === required),
        `fresh schema must include ${required}`,
      );
    }
    const curve = await db.profitCurveConfiguration.findUnique({
      where: { id: "default" },
      include: { bands: { orderBy: { sortOrder: "asc" } } },
    });
    assert.ok(curve?.enabled, "default profit curve must be seeded enabled");
    assert.equal(curve?.bands.length, 5);
    assert.equal(curve?.bands[0]?.targetGrossMarginBps, 7000);
    assert.equal(curve?.bands[4]?.targetGrossMarginBps, 3000);
    assert.equal(
      await db.providerBillingContractVersion.count({
        where: {
          productKind: "CLOUD_SERVER",
          status: "UNVERIFIED",
        },
      }),
      1,
    );
    assert.equal(
      await db.providerBillingContractVersion.count({
        where: { provider: "ARVAN", productKind: "CLOUD_SERVER" },
      }),
      1,
    );
    const leftoverParsPack = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n
      FROM "ProviderBillingContractVersion"
      WHERE "provider"::text = 'PARSPACK'
    `;
    assert.equal(Number(leftoverParsPack[0]?.n ?? 0), 0);
    const contractStatuses = await db.$queryRaw<Array<{ enumlabel: string }>>`
      SELECT enumlabel
      FROM pg_enum
      JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
      JOIN pg_namespace ON pg_namespace.oid = pg_type.typnamespace
      WHERE pg_type.typname = 'ProviderBillingContractStatus'
        AND pg_namespace.nspname = current_schema()
      ORDER BY enumsortorder ASC
    `;
    assert.deepEqual(
      contractStatuses.map((status) => status.enumlabel),
      ["VERIFIED", "UNVERIFIED", "REVOKED", "INVALID"],
    );
  } finally {
    await db.$disconnect();
  }
});

console.log("[fresh-migration] isolated fresh migration passed");
