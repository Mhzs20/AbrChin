import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

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
});

test("successful idle cycles update the healthy heartbeat before branching", () => {
  const source = readFileSync("scripts/provisioning-worker-entry.ts", "utf8");
  const cycleIndex = source.indexOf("const processed = await runProvisioningWorkerCycle()");
  const heartbeatIndex = source.indexOf("await touchWorkerHeartbeat({ cycleOk: true })");
  const branchIndex = source.indexOf("if (processed)");

  assert.ok(cycleIndex >= 0);
  assert.ok(heartbeatIndex > cycleIndex);
  assert.ok(branchIndex > heartbeatIndex);
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
