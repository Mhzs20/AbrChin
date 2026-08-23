import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  BillingCatchUpFailure,
  requireSuccessfulBillingCatchUp,
} from "../lib/billing/worker.ts";

function loadEnvFile() {
  if (process.env.DATABASE_URL || !existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile();

const workerBundle = resolve("dist/worker/provisioning-worker.js");
const catalogSyncBundle = resolve("dist/catalog-sync/catalog-sync.js");
const catalogSyncSchedulerBundle = resolve(
  "dist/catalog-sync/catalog-sync-scheduler.js",
);
const entrypoint = resolve("scripts/worker-entrypoint.sh");

test("worker bundle exists after build", () => {
  assert.equal(existsSync(workerBundle), true);
  const source = readFileSync(workerBundle, "utf8");
  assert.equal(source.includes("test-resolve-hook"), false);
  assert.equal(source.includes("@/"), false);
});

test("worker entrypoint references compiled bundle", () => {
  const script = readFileSync(entrypoint, "utf8");
  assert.match(script, /dist\/worker\/provisioning-worker\.js/);
  assert.equal(script.includes("provisioning-worker.mts"), false);
  assert.equal(script.includes("experimental-strip-types"), false);
  // Migrations are one-shot via ops/deploy.sh — worker must not migrate on start.
  assert.doesNotMatch(script, /prisma migrate deploy/);
  assert.doesNotMatch(script, /migrate deploy/);
});

test("production catalog sync commands use a compiled runtime bundle", () => {
  assert.equal(existsSync(catalogSyncBundle), true);
  assert.equal(existsSync(catalogSyncSchedulerBundle), true);
  const bundle = readFileSync(catalogSyncBundle, "utf8");
  const schedulerBundle = readFileSync(catalogSyncSchedulerBundle, "utf8");
  const packageJson = readFileSync("package.json", "utf8");
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const compose = readFileSync("compose.production.yaml", "utf8");
  assert.equal(bundle.includes("test-resolve-hook"), false);
  assert.equal(bundle.includes("@/"), false);
  assert.equal(schedulerBundle.includes("test-resolve-hook"), false);
  assert.equal(schedulerBundle.includes("@/"), false);
  assert.equal(schedulerBundle.includes("runProvisioningWorkerCycle"), false);
  assert.match(
    packageJson,
    /"sync:catalog:arvan": "node dist\/catalog-sync\/catalog-sync\.js arvan"/,
  );
  assert.match(dockerfile, /\/app\/dist\/catalog-sync \.\/dist\/catalog-sync/);
  assert.match(
    compose,
    /catalog-sync:[\s\S]*command: \["node", "dist\/catalog-sync\/catalog-sync-scheduler\.js"\]/,
  );
});

test("production accounting backfill uses compiled runtime artifact", () => {
  const accountingBundle = resolve("dist/accounting/accounting-backfill.js");
  assert.equal(existsSync(accountingBundle), true);
  const source = readFileSync(accountingBundle, "utf8");
  const packageJson = readFileSync("package.json", "utf8");
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const buildScript = readFileSync("scripts/build-worker.mjs", "utf8");
  assert.equal(source.includes("test-resolve-hook"), false);
  assert.equal(source.includes("@/"), false);
  assert.equal(source.includes("--experimental-strip-types"), false);
  assert.match(
    packageJson,
    /"accounting:backfill": "node dist\/accounting\/accounting-backfill\.js"/,
  );
  assert.doesNotMatch(
    packageJson.match(/"accounting:backfill": "[^"]+"/)?.[0] ?? "",
    /test-resolve-hook/,
  );
  assert.match(dockerfile, /\/app\/dist\/accounting \.\/dist\/accounting/);
  assert.doesNotMatch(dockerfile, /COPY[\s\S]*scripts\/test-resolve-hook/);
  assert.match(buildScript, /dist\/accounting\/accounting-backfill\.js/);
  assert.match(buildScript, /scripts\/accounting-backfill\.mts/);
});

test("compiled catalog sync fails safely before network access when unconfigured", async () => {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("node", [catalogSyncBundle, "arvan"], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL:
          "postgresql://runtime:runtime@127.0.0.1:1/runtime",
        ARVAN_ENABLED: "false",
        ARVAN_API_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      try {
        assert.equal(code, 1);
        assert.equal(stdout, "");
        const jsonLine = stderr
          .trim()
          .split("\n")
          .findLast((line) => line.trim().startsWith("{"));
        assert.ok(jsonLine);
        const output = JSON.parse(jsonLine) as Record<string, unknown>;
        assert.equal(output.readOnly, true);
        assert.equal(output.ok, false);
        assert.equal(output.provider, "ARVAN");
        assert.equal(output.status, "FAILED");
        assert.deepEqual(output.safeError, {
          code: "provider_disabled",
          message:
            "ارائه‌دهنده در محیط Server به‌طور کامل تنظیم نشده است.",
        });
        assert.equal(stderr.includes("ARVAN_API_KEY"), false);
        resolvePromise();
      } catch (error) {
        reject(error);
      }
    });
  });
});

test("successful idle cycles update the healthy heartbeat before branching", () => {
  const source = readFileSync("scripts/provisioning-worker-entry.ts", "utf8");
  const cycleIndex = source.indexOf("const processed = await runProvisioningWorkerCycle()");
  const heartbeatIndex = source.indexOf("await touchWorkerHeartbeat({ cycleOk: true })");
  const branchIndex = source.indexOf("if (processed || alertsProcessed > 0)");

  assert.ok(cycleIndex >= 0);
  assert.ok(heartbeatIndex > cycleIndex);
  assert.ok(branchIndex > heartbeatIndex);
});

test("failed billing catch-up prevents a healthy worker cycle and carries retry context", () => {
  assert.throws(
    () =>
      requireSuccessfulBillingCatchUp({
        cadence: "HOURLY",
        runs: [],
        failedPeriod: {
          periodStart: "2026-08-01T01:00:00.000Z",
          periodEnd: "2026-08-01T02:00:00.000Z",
          billingRunId: "billing-run-1",
          failureCode: "simulated_failure",
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof BillingCatchUpFailure);
      assert.equal(error.cadence, "HOURLY");
      assert.equal(error.failedPeriod.billingRunId, "billing-run-1");
      return true;
    },
  );
  const source = readFileSync("scripts/provisioning-worker-entry.ts", "utf8");
  const failureCheck = source.indexOf("requireSuccessfulBillingCatchUp(hourlyCatchUp)");
  const heartbeat = source.indexOf("await touchWorkerHeartbeat({ cycleOk: true })");
  assert.ok(failureCheck >= 0);
  assert.ok(heartbeat > failureCheck);
  assert.match(source, /retryStatus: "pending_next_billing_cycle"/);
});

test("worker healthcheck rejects a fresh stale heartbeat", () => {
  const source = readFileSync("scripts/worker-healthcheck.mjs", "utf8");
  assert.match(source, /row\.status !== "healthy"/);
});

test("compiled worker starts without alias resolution error", async () => {
  const runtimeDatabaseUrl =
    process.env.DATABASE_URL ??
    "postgresql://runtime:runtime@127.0.0.1:1/runtime";

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("node", [workerBundle], {
      env: {
        ...process.env,
        DATABASE_URL: runtimeDatabaseUrl,
        WORKER_POLL_MS: "50",
        WORKER_MAX_IDLE_ROUNDS: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      if (stderr.includes("ERR_MODULE_NOT_FOUND") || stderr.includes("Cannot find module")) {
        reject(new Error(stderr));
        return;
      }
      resolvePromise();
    }, 1500);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0 && (stderr.includes("ERR_MODULE_NOT_FOUND") || stderr.includes("Cannot find module"))) {
        reject(new Error(stderr || `exit ${code}`));
        return;
      }
      resolvePromise();
    });
  });
});
