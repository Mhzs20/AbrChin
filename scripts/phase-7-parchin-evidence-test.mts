import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  InfrastructureOfferSource,
  InfrastructureProductKind,
  InfrastructureProvider,
  ParchinLevel,
  SupportRequestKind,
} from "@prisma/client";

import { getPublicSaleDecision } from "../lib/infrastructure/public-sale-policy.ts";
import {
  addParchinBusinessMinutes,
  endOfParchinWorkingDay,
  parchinFirstResponseDueAt,
  parchinRoutineLimit,
} from "../lib/parchin/operations.ts";
import { DEFAULT_PARCHIN_SERVICE_CONTRACTS } from "../lib/parchin/service-contract.ts";

const root = new URL("../", import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

test("Parchin v3 locks all three sellable contracts and measurable promises", () => {
  const start = DEFAULT_PARCHIN_SERVICE_CONTRACTS.PARCHIN_START;
  const active = DEFAULT_PARCHIN_SERVICE_CONTRACTS.PARCHIN_ACTIVE;
  const stable = DEFAULT_PARCHIN_SERVICE_CONTRACTS.PARCHIN_STABLE;

  for (const contract of [start, active, stable]) {
    assert.equal(contract.version, 3);
    assert.ok(contract.title.startsWith("پرچین "));
    assert.ok(contract.includedServices.length >= 8);
    assert.ok(contract.excludedServices.length >= 3);
    assert.ok(contract.definitions.firstResponse);
    assert.ok(contract.definitions.applicationBoundary);
  }
  assert.equal(start.operationalPolicy.routineRequestLimit, 1);
  assert.equal(active.operationalPolicy.routineRequestLimit, 2);
  assert.equal(stable.operationalPolicy.routineRequestLimit, 4);
  assert.equal(active.operationalPolicy.monitoringIntervalMinutes, 5);
  assert.equal(active.operationalPolicy.backupRetentionCopies, 7);
  assert.equal(stable.operationalPolicy.backupRetentionCopies, 14);
  assert.equal(stable.operationalPolicy.p1ResponseMinutes, 30);
  assert.equal(stable.operationalPolicy.restoreCadence, "monthly_test");
  assert.deepEqual(stable.operationalPolicy.capacityThresholds, {
    cpuPercent: 80,
    ramPercent: 85,
    diskPercent: 80,
  });
});

test("Parchin SLA clock follows Tehran business windows and 24/7 P1", () => {
  // Saturday 2026-08-08 10:00 Tehran.
  const saturdayMorning = new Date("2026-08-08T06:30:00.000Z");
  assert.equal(
    addParchinBusinessMinutes(saturdayMorning, 240).toISOString(),
    "2026-08-08T10:30:00.000Z",
  );
  assert.equal(
    endOfParchinWorkingDay(saturdayMorning).toISOString(),
    "2026-08-08T14:30:00.000Z",
  );
  // Thursday has a shorter 09:00–14:00 window; the remainder continues Saturday.
  const thursdayNoon = new Date("2026-08-13T08:30:00.000Z");
  assert.equal(
    addParchinBusinessMinutes(thursdayNoon, 240).toISOString(),
    "2026-08-15T07:30:00.000Z",
  );
  const friday = new Date("2026-08-14T20:00:00.000Z");
  assert.equal(
    parchinFirstResponseDueAt({
      level: ParchinLevel.PARCHIN_STABLE,
      kind: SupportRequestKind.P1_INCIDENT,
      createdAt: friday,
    }).toISOString(),
    "2026-08-14T20:30:00.000Z",
  );
  assert.equal(parchinRoutineLimit(ParchinLevel.PARCHIN_START), 1);
  assert.equal(parchinRoutineLimit(ParchinLevel.PARCHIN_ACTIVE), 2);
  assert.equal(parchinRoutineLimit(ParchinLevel.PARCHIN_STABLE), 4);
});

test("secure delivery activates Parchin enrollment and operational queue", async () => {
  const [delivery, operations, migration] = await Promise.all([
    source("lib/infrastructure/health-check-service.ts"),
    source("lib/parchin/operations.ts"),
    source("prisma/migrations/20260810220000_parchin_operations_v3/migration.sql"),
  ]);
  assert.match(delivery, /activateParchinEnrollmentTx/);
  for (const promise of [
    "INITIAL_HARDENING",
    "UPTIME_MONITORING",
    "DAILY_BACKUP",
    "RESTORE_TEST",
    "SECURITY_REVIEW",
    "CAPACITY_REPORT",
  ]) {
    assert.match(operations, new RegExp(promise));
    assert.match(migration, new RegExp(promise));
  }
  assert.match(operations, /idempotencyKey/);
  assert.match(operations, /nextParchinTaskDueAt/);
});

test("customer support enforces quota and the Galaxy-only P1 lane", async () => {
  const [support, accountApi, customerPage, adminPage] = await Promise.all([
    source("lib/support/service.ts"),
    source("app/api/account/support-requests/route.ts"),
    source("app/account/parchin/[id]/page.tsx"),
    source("app/admin/parchin/[id]/page.tsx"),
  ]);
  assert.match(support, /routineRequestsUsed/);
  assert.match(support, /PARCHIN_STABLE/);
  assert.match(support, /firstResponseDueAt/);
  assert.match(support, /createP1IncidentTaskTx/);
  assert.match(accountApi, /kind/);
  assert.match(customerPage, /گزارش‌های پرچین/);
  assert.match(customerPage, /اعلام رخداد P1/);
  assert.match(adminPage, /صف کار/);
  assert.match(adminPage, /ParchinReportForm/);
});

test("Parchin has no global evidence flag and relies on contract-scoped operations", async () => {
  const [development, production, compose, policy, assortment] = await Promise.all([
    source(".env.example"),
    source(".env.production.example"),
    source("compose.production.yaml"),
    source("lib/infrastructure/public-sale-policy.ts"),
    source("lib/storefront/assortment-service.ts"),
  ]);
  for (const text of [development, production, compose, policy, assortment]) {
    assert.doesNotMatch(text, /PARCHIN_OPERATIONAL_EVIDENCE_APPROVED/);
    assert.doesNotMatch(text, /parchin_evidence_incomplete/);
  }

  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    PUBLIC_SALE_ENABLED: process.env.PUBLIC_SALE_ENABLED,
    PARSPACK_PUBLIC_SALE_ENABLED: process.env.PARSPACK_PUBLIC_SALE_ENABLED,
  };
  try {
    process.env.NODE_ENV = "production";
    process.env.PUBLIC_SALE_ENABLED = "true";
    process.env.PARSPACK_PUBLIC_SALE_ENABLED = "true";
    assert.deepEqual(
      getPublicSaleDecision({
        provider: InfrastructureProvider.PARSPACK,
        offerSource: InfrastructureOfferSource.API_CATALOG,
        productKind: InfrastructureProductKind.READY_INSTANT_SERVER,
      }),
      { allowed: true, code: "sale_enabled" },
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
