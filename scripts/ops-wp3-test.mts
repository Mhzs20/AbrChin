import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { derivePlatformReadinessStatus } from "../lib/monitoring/readiness.ts";

test("production freeze stays fail-closed in compose, env examples, and deploy", async () => {
  const compose = await readFile("compose.production.yaml", "utf8");
  const example = await readFile(".env.production.example", "utf8");
  const deploy = await readFile("ops/deploy.sh", "utf8");
  for (const source of [compose, example, deploy]) {
    assert.equal(source.includes("MESSAGEGO_CUSTOMER_AI_ENABLED=true"), false);
    assert.equal(source.includes("MESSAGEGO_SETTLEMENT_ENABLED=true"), false);
    assert.equal(source.includes("MESSAGEGO_SECRET_HANDOFF_ENABLED=true"), false);
    assert.equal(source.includes("ARVAN_MUTATIONS_ENABLED=true"), false);
    assert.equal(source.includes("CRX_PROVIDER_TRAFFIC_ENABLED=true"), false);
  }
  assert.match(compose, /MESSAGEGO_CUSTOMER_AI_ENABLED: \$\{MESSAGEGO_CUSTOMER_AI_ENABLED:-false\}/);
  assert.match(compose, /ABRCHIN_REQUIRE_FILE_SECRETS: \$\{ABRCHIN_REQUIRE_FILE_SECRETS:-true\}/);
  assert.equal(compose.includes("DATABASE_URL: ${DATABASE_URL:?"), false);
  assert.equal(existsSync(".github/workflows"), false);
});

test("disabled optional features do not fail readiness", () => {
  assert.equal(
    derivePlatformReadinessStatus("healthy", "healthy", "healthy", "disabled", {
      messageGoS2S: "disabled",
      catalogProvider: "disabled",
      migrations: "healthy",
    }),
    "operational",
  );
  assert.equal(
    derivePlatformReadinessStatus("healthy", "down"),
    "outage",
  );
});

test("backup preflight fails when destination is the data location", async () => {
  const dir = await mkdtemp(join(tmpdir(), "abrchin-wp3-backup-"));
  try {
    const key = join(dir, "backup.key");
    await writeFile(key, "x".repeat(32), { mode: 0o600 });
    const data = join(dir, "data");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(data);
    const result = spawnSync(
      "bash",
      ["ops/backup-postgres.sh"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          APP_DIR: process.cwd(),
          ENV_FILE: ".env.production.example",
          COMPOSE_FILE: "compose.production.yaml",
          BACKUP_KEY_FILE: key,
          DATA_ROOT: data,
          BACKUP_DIR: data,
          BACKUP_MODE: "direct",
        },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /must not be the data location/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("deploy and backup scripts are syntactically valid and never print SUCCESS after handle_failure", async () => {
  for (const script of [
    "ops/deploy.sh",
    "ops/backup-postgres.sh",
    "ops/restore-verify.sh",
    "ops/backup-common.sh",
  ]) {
    const syntax = spawnSync("bash", ["-n", script], { encoding: "utf8" });
    assert.equal(syntax.status, 0, `${script}: ${syntax.stderr}`);
  }
  const deploy = await readFile("ops/deploy.sh", "utf8");
  const successIdx = deploy.indexOf("[deploy] SUCCESS");
  const lastFailureIdx = deploy.lastIndexOf("handle_failure");
  assert.ok(successIdx > lastFailureIdx);
  assert.match(deploy, /FAILED at gate:/);
});
