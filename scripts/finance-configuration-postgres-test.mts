import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PrismaClient, UserRole } from "@prisma/client";

import {
  FinanceConfigurationError,
  applyFinanceConfiguration,
  readFinanceConfiguration,
  rollbackFinanceConfiguration,
  type FinanceConfigurationInput,
} from "../lib/admin/finance-configuration.ts";
import { HIGH_MARGIN_CONFIRMATION_PHRASE } from "../lib/pricing/commercial-engine.ts";
import { allowAdminMobile } from "./test-admin-allowlist.mts";

const databaseUrl = process.env.DATABASE_URL;
const db =
  process.env.ABRCHIN_ISOLATED_TEST === "1" && databaseUrl
    ? new PrismaClient()
    : null;

function baseInput(marginBps: number): FinanceConfigurationInput {
  return {
    providers: [
      { provider: "ARVAN", targetGrossMarginBps: marginBps, enabled: true },
    ],
    productMarkups: [
      {
        provider: "ARVAN",
        productKind: "CLOUD_SERVER",
        markupBasisPoints: 0,
        enabled: true,
      },
      {
        provider: "ARVAN",
        productKind: "READY_INSTANT_SERVER",
        markupBasisPoints: 0,
        enabled: true,
      },
    ],
    taxBps: 1_000,
    reminderDaysBeforeDue: 7,
    suspendGraceDaysAfterZero: 7,
    deleteDaysAfterSuspend: 7,
    compassServicePrices: {
      SITE_MIGRATION: "15000000",
      INITIAL_SETUP: "8000000",
      DOMAIN_SSL: "3000000",
      BACKUP_RESTORE: "5000000",
      ARCHITECTURE_LIGHT: "10000000",
    },
    parchin: [
      {
        level: "PARCHIN_START",
        title: "پرچین نو",
        description: null,
        priceRial: 5_000_000n,
        active: true,
      },
      {
        level: "PARCHIN_ACTIVE",
        title: "پرچین استوار",
        description: null,
        priceRial: 15_000_000n,
        active: true,
      },
      {
        level: "PARCHIN_STABLE",
        title: "پرچین کهکشان",
        description: null,
        priceRial: 50_000_000n,
        active: true,
      },
    ],
    priceDisplay: {
      showHourlyPrice: true,
      showDailyPrice: true,
      showMonthlyPrice: true,
    },
  };
}

test("finance configuration publishes atomically with a revision", async (t) => {
  if (!db) {
    t.skip("requires isolated PostgreSQL");
    return;
  }
  const suffix = Date.now().toString(36);
  const adminMobile = `0903${suffix.slice(-7).padStart(7, "0")}`;
  const restoreAllowlist = allowAdminMobile(adminMobile);
  t.after(restoreAllowlist);
  const admin = await db.user.create({
    data: {
      mobile: adminMobile,
      role: UserRole.ADMIN,
    },
  });

  const before = await readFinanceConfiguration();
  assert.ok(Array.isArray(before.revisions));

  const input = baseInput(3_000);
  input.reason = "publish A";
  const revision = await applyFinanceConfiguration({
    input,
    actorUserId: admin.id,
  });
  assert.ok(revision.id);

  const after = await readFinanceConfiguration();
  assert.equal(after.providers[0]?.markupBasisPoints, 4_286);
  assert.equal(after.providers[0]?.targetGrossMarginBps, 3_000);
  assert.equal(after.taxBps, 1_000);
  assert.equal(after.revisions[0]?.id, revision.id);
  assert.equal(after.revisions[0]?.reason, "publish A");

  // The stored snapshot is complete enough to reproduce the configuration.
  const stored = await db.financeConfigurationRevision.findUnique({
    where: { id: revision.id },
  });
  assert.ok(stored);
  const snapshot = stored.snapshot as Record<string, unknown>;
  assert.equal(Array.isArray(snapshot.providers), true);
  assert.equal(Array.isArray(snapshot.parchin), true);
});

test("a failing write inside the transaction rolls everything back", async (t) => {
  if (!db) {
    t.skip("requires isolated PostgreSQL");
    return;
  }
  const current = await readFinanceConfiguration();
  const currentMarkup = current.providers[0]?.markupBasisPoints;
  const revisionCountBefore = await db.financeConfigurationRevision.count();

  // Remove one Parchin row so the parchin update inside the transaction
  // fails AFTER provider markups were already written in the same tx.
  const removed = await db.parchinPricingConfig.findUnique({
    where: { level: "PARCHIN_STABLE" },
  });
  assert.ok(removed);
  await db.parchinPricingConfig.delete({ where: { level: "PARCHIN_STABLE" } });

  const failing = baseInput(4_000); // markup 6667 — would change providers
  await assert.rejects(
    applyFinanceConfiguration({ input: failing, actorUserId: null }),
  );

  // Atomic rollback: provider markup unchanged, no new revision.
  const after = await readFinanceConfiguration();
  assert.equal(after.providers[0]?.markupBasisPoints, currentMarkup);
  assert.equal(
    await db.financeConfigurationRevision.count(),
    revisionCountBefore,
  );

  await db.parchinPricingConfig.create({
    data: {
      level: removed.level,
      title: removed.title,
      description: removed.description,
      priceRial: removed.priceRial,
      active: removed.active,
      sortOrder: removed.sortOrder,
    },
  });
});

test("high margins require the typed confirmation phrase", async (t) => {
  if (!db) {
    t.skip("requires isolated PostgreSQL");
    return;
  }
  const highMargin = baseInput(7_500);
  await assert.rejects(
    applyFinanceConfiguration({ input: highMargin, actorUserId: null }),
    (error: unknown) =>
      error instanceof FinanceConfigurationError &&
      error.code === "margin_confirmation_required",
  );
  highMargin.highMarginConfirmation = HIGH_MARGIN_CONFIRMATION_PHRASE;
  const revision = await applyFinanceConfiguration({
    input: highMargin,
    actorUserId: null,
  });
  assert.ok(revision.id);
  const after = await readFinanceConfiguration();
  assert.equal(after.providers[0]?.targetGrossMarginBps, 7_500);

  // Margins outside [0, 100%) are rejected outright.
  await assert.rejects(
    applyFinanceConfiguration({
      input: baseInput(10_000),
      actorUserId: null,
    }),
    (error: unknown) =>
      error instanceof FinanceConfigurationError &&
      error.code === "invalid_margin",
  );
});

test("rollback re-publishes an older revision without editing history", async (t) => {
  if (!db) {
    t.skip("requires isolated PostgreSQL");
    return;
  }
  const inputA = baseInput(3_000);
  inputA.reason = "state A";
  const revisionA = await applyFinanceConfiguration({
    input: inputA,
    actorUserId: null,
  });
  const snapshotABefore = JSON.stringify(
    (
      await db.financeConfigurationRevision.findUnique({
        where: { id: revisionA.id },
      })
    )?.snapshot,
  );

  const inputB = baseInput(4_000);
  inputB.reason = "state B";
  await applyFinanceConfiguration({ input: inputB, actorUserId: null });
  const midway = await readFinanceConfiguration();
  assert.equal(midway.providers[0]?.targetGrossMarginBps, 4_000);

  const rollback = await rollbackFinanceConfiguration({
    revisionId: revisionA.id,
    actorUserId: null,
  });
  assert.equal(rollback.rollbackOfId, revisionA.id);

  const after = await readFinanceConfiguration();
  assert.equal(after.providers[0]?.targetGrossMarginBps, 3_000);
  assert.equal(after.providers[0]?.markupBasisPoints, 4_286);

  // History is append-only: revision A snapshot is byte-identical.
  const snapshotAAfter = JSON.stringify(
    (
      await db.financeConfigurationRevision.findUnique({
        where: { id: revisionA.id },
      })
    )?.snapshot,
  );
  assert.equal(snapshotAAfter, snapshotABefore);
});

test("legacy markup repair converts exactly 23333 and preserves custom rows", async (t) => {
  if (!db) {
    t.skip("requires isolated PostgreSQL");
    return;
  }
  // Fresh migrate already ran the repair; replay its UPDATE against
  // controlled rows to prove the exact-match semantics.
  const migration = await readFile(
    "prisma/migrations/20260806200000_commercial_pricing_v3/migration.sql",
    "utf8",
  );
  const updateStatement = migration
    .split(";")
    .map((statement) => statement.trim())
    .find((statement) => statement.startsWith("UPDATE \"ProviderPricingConfig\""));
  assert.ok(updateStatement, "repair UPDATE must exist in the migration");

  // A custom markup is never rewritten by the repair.
  await db.providerPricingConfig.upsert({
    where: { provider: "ARVAN" },
    update: { markupBasisPoints: 25_000 },
    create: {
      id: "arvan-v1",
      provider: "ARVAN",
      apiVersion: "v1",
      sourceMoneyUnit: "IRR",
      markupBasisPoints: 25_000,
      enabled: true,
    },
  });
  await db.$executeRawUnsafe(updateStatement);
  assert.equal(
    (
      await db.providerPricingConfig.findUnique({ where: { provider: "ARVAN" } })
    )?.markupBasisPoints,
    25_000, // custom value untouched
  );

  // Only the exact legacy auto value is repaired.
  await db.providerPricingConfig.update({
    where: { provider: "ARVAN" },
    data: { markupBasisPoints: 23_333 },
  });
  await db.$executeRawUnsafe(updateStatement);
  assert.equal(
    (
      await db.providerPricingConfig.findUnique({ where: { provider: "ARVAN" } })
    )?.markupBasisPoints,
    4_286, // legacy auto value repaired
  );

  // New rows default to the 30%-margin markup.
  await db.providerPricingConfig.delete({ where: { provider: "ARVAN" } });
  await db.$executeRawUnsafe(
    `INSERT INTO "ProviderPricingConfig" ("id", "provider", "apiVersion", "enabled", "updatedAt") VALUES ('arvan-v1', 'ARVAN', 'v1', false, NOW())`,
  );
  const fresh = await db.providerPricingConfig.findUnique({
    where: { provider: "ARVAN" },
  });
  assert.equal(fresh?.markupBasisPoints, 4_286);
});

test("price-only publish preserves Parchin services and skips version bump", async (t) => {
  if (!db) {
    t.skip("requires isolated PostgreSQL");
    return;
  }
  const suffix = Date.now().toString(36);
  const adminMobile = `0904${suffix.slice(-7).padStart(7, "0")}`;
  const restoreAllowlist = allowAdminMobile(adminMobile);
  t.after(restoreAllowlist);
  const admin = await db.user.create({
    data: {
      mobile: adminMobile,
      role: UserRole.ADMIN,
    },
  });

  const seededServices = ["ساخت سرور پس از تأیید ظرفیت", "نصب سیستم‌عامل انتخابی"];
  await db.parchinPricingConfig.update({
    where: { level: "PARCHIN_START" },
    data: {
      includedServices: seededServices,
      excludedServices: ["مانیتورینگ مستمر"],
      version: 3,
      title: "پرچین نو",
      subtitle: null,
      description: null,
      supportWindow: null,
      firstResponseTarget: null,
      priceRial: 5_000_000n,
      active: true,
    },
  });

  // Keep ACTIVE/STABLE fields aligned with baseInput so a price-only publish
  // does not look like a material contract change on those rows either.
  await db.parchinPricingConfig.update({
    where: { level: "PARCHIN_ACTIVE" },
    data: {
      title: "پرچین استوار",
      subtitle: null,
      description: null,
      supportWindow: null,
      firstResponseTarget: null,
      priceRial: 15_000_000n,
      active: true,
      includedServices: ["خدمت فعال"],
      excludedServices: ["غیر فعال"],
    },
  });
  await db.parchinPricingConfig.update({
    where: { level: "PARCHIN_STABLE" },
    data: {
      title: "پرچین کهکشان",
      subtitle: null,
      description: null,
      supportWindow: null,
      firstResponseTarget: null,
      priceRial: 50_000_000n,
      active: true,
      includedServices: ["خدمت پایدار"],
      excludedServices: ["غیر پایدار"],
    },
  });

  const before = await db.parchinPricingConfig.findUnique({
    where: { level: "PARCHIN_START" },
  });
  assert.equal(before?.version, 3);

  // Finance Center-style body: price/title only, no service lists.
  const input = baseInput(3_000);
  input.reason = "price-only";
  input.parchin = input.parchin.map((row) => ({
    level: row.level,
    title: row.title,
    description: row.description,
    priceRial: row.priceRial,
    active: row.active,
  }));
  const revision = await applyFinanceConfiguration({
    input,
    actorUserId: admin.id,
    idempotencyKey: `finance-price-only-${suffix}`,
  });
  assert.ok(revision.id);

  const after = await db.parchinPricingConfig.findUnique({
    where: { level: "PARCHIN_START" },
  });
  assert.equal(after?.version, 3, "unchanged contract must not bump version");
  assert.deepEqual(after?.includedServices, seededServices);

  const snapshot = revision.snapshot as {
    parchin: Array<{ level: string; includedServices: string[] }>;
  };
  const startSnap = snapshot.parchin.find(
    (row) => row.level === "PARCHIN_START",
  );
  assert.ok(startSnap);
  assert.deepEqual(startSnap.includedServices, seededServices);

  // Idempotent replay returns the same revision.
  const replay = await applyFinanceConfiguration({
    input,
    actorUserId: admin.id,
    idempotencyKey: `finance-price-only-${suffix}`,
  });
  assert.equal(replay.id, revision.id);

  // Rollback of a snapshot that omitted services must not wipe them.
  const wipedStyle = baseInput(3_100);
  wipedStyle.reason = "will-rollback";
  const mid = await applyFinanceConfiguration({
    input: wipedStyle,
    actorUserId: admin.id,
  });
  // Force an empty-list snapshot like the old Finance Center bug.
  await db.financeConfigurationRevision.update({
    where: { id: mid.id },
    data: {
      snapshot: {
        ...(mid.snapshot as object),
        parchin: (
          (mid.snapshot as { parchin: Array<Record<string, unknown>> }).parchin
        ).map((row) => ({
          ...row,
          includedServices: [],
          excludedServices: [],
        })),
      },
    },
  });
  await rollbackFinanceConfiguration({
    revisionId: mid.id,
    actorUserId: admin.id,
  });
  const restored = await db.parchinPricingConfig.findUnique({
    where: { level: "PARCHIN_START" },
  });
  assert.ok(Array.isArray(restored?.includedServices));
  assert.ok((restored?.includedServices as string[]).length > 0);
});
