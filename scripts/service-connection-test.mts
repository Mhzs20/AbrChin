import assert from "node:assert/strict";
import test from "node:test";

import { isSafePaymentCallbackBaseUrl, toSafeConnectionFailure } from "../lib/admin/service-connection-safety.ts";

test("connection errors are categorized without returning raw provider text", () => {
  const failure = toSafeConnectionFailure(new Error("Bearer super-secret-token timeout"));
  assert.deepEqual(failure, { code: "timeout", message: "زمان پاسخ سرویس تمام شد." });
  assert.equal(JSON.stringify(failure).includes("super-secret-token"), false);
});

test("production payment callback configuration rejects unsafe origins", () => {
  assert.equal(isSafePaymentCallbackBaseUrl("https://abrchin.ir", true), true);
  assert.equal(isSafePaymentCallbackBaseUrl("http://abrchin.ir", true), false);
  assert.equal(isSafePaymentCallbackBaseUrl("https://user:pass@abrchin.ir", true), false);
});

test("service connection route remains admin-only", async () => {
  const source = await (await import("node:fs/promises")).readFile(
    "app/api/admin/service-connections/route.ts",
    "utf8",
  );
  assert.match(source, /await requireAdminUser\(\)/);
  assert.match(source, /rejectCrossOrigin/);
});

test("service connection migration is additive", async () => {
  const migration = await (await import("node:fs/promises")).readFile(
    "prisma/migrations/20260803100000_service_connection_checks/migration.sql",
    "utf8",
  );
  assert.match(migration, /CREATE TABLE "ServiceConnectionCheck"/);
  assert.doesNotMatch(migration, /\bDROP\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /\bDELETE\b/i);
  assert.doesNotMatch(migration, /\bUPDATE\b/i);
});
