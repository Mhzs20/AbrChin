/**
 * WP6 release-truth orchestrator.
 * Re-runs complete AbrChin and MessageGo release gates.
 * Required skip = NO-GO. Does not set owner acceptance or production auth.
 */
import { spawn, spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MESSAGEGO = resolve(ROOT, "../MessageGo");
const PG_BIN = "/usr/lib/postgresql/16/bin";
const EVIDENCE_DIR = join(ROOT, "docs/launch/evidence/wp6");
const RECEIPT_JSON = join(EVIDENCE_DIR, "receipt.json");
const RECEIPT_MD = join(EVIDENCE_DIR, "receipt.md");
const LAUNCH_MD = join(ROOT, "docs/launch/wp6-release-truth.md");
const POINTER_MD = join(MESSAGEGO, "docs/program/wp6-release-truth-pointer.md");

process.env.PATH = `${PG_BIN}:/usr/sbin:/usr/bin:/home/ubuntu/go/bin:${process.env.PATH ?? ""}`;
process.env.CRX_TEST_REDIS_ADDRESS =
  process.env.CRX_TEST_REDIS_ADDRESS || "127.0.0.1:6379";
process.env.CRX_TEST_NATS_URL =
  process.env.CRX_TEST_NATS_URL || "nats://127.0.0.1:4222";
process.env.POSTGRES_TEST_DATABASE_URL =
  process.env.POSTGRES_TEST_DATABASE_URL ||
  "postgresql://abrchin:abrchin@127.0.0.1:5432/abrchin";
process.env.CRX_TEST_DATABASE_URL =
  process.env.CRX_TEST_DATABASE_URL ||
  "postgresql://abrchin:abrchin@127.0.0.1:5432/messagego_wp6";
const MESSAGEGO_M6_DATABASE_URL =
  process.env.CRX_M6_TEST_DATABASE_URL ||
  "postgresql://abrchin:abrchin@127.0.0.1:5432/messagego_m6_wp6";
process.env.CRX_PROVIDER_TRAFFIC_ENABLED = "false";
process.env.ARVAN_ENABLED = process.env.ARVAN_ENABLED || "false";
process.env.ARVAN_MUTATIONS_ENABLED = "false";
process.env.MESSAGEGO_SETTLEMENT_ENABLED =
  process.env.MESSAGEGO_SETTLEMENT_ENABLED || "false";
process.env.MESSAGEGO_CUSTOMER_AI_ENABLED =
  process.env.MESSAGEGO_CUSTOMER_AI_ENABLED || "false";
process.env.MESSAGEGO_SECRET_HANDOFF_ENABLED =
  process.env.MESSAGEGO_SECRET_HANDOFF_ENABLED || "false";
process.env.SMS_PROVIDER = process.env.SMS_PROVIDER || "console";
process.env.EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || "console";
process.env.NODE_ENV =
  process.env.NODE_ENV === "production" ? "test" : process.env.NODE_ENV || "test";
process.env.WP5_REQUIRE_SERVICES = "1";

type Counts = { pass: number; fail: number; skip: number; tests: number };
type GateResult = {
  id: string;
  repo: "abrchin" | "messagego";
  required: boolean;
  command: string;
  startedAt: string;
  endedAt: string;
  elapsedMs: number;
  exitCode: number;
  counts: Counts;
  status: "pass" | "fail" | "skip";
  logTail: string;
};

type GateSpec = {
  id: string;
  repo: "abrchin" | "messagego";
  kind: "node-test" | "go-json" | "command" | "ops-backup";
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
};

function emptyCounts(): Counts {
  return { pass: 0, fail: 0, skip: 0, tests: 0 };
}

function gitSha(cwd: string) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function capture(command: string, args: string[], cwd = ROOT) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
  return (result.stdout || result.stderr || "").trim();
}

function psql(database: string, sql: string) {
  const result = spawnSync(
    join(PG_BIN, "psql"),
    [
      "-h",
      "127.0.0.1",
      "-U",
      "abrchin",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, PGPASSWORD: "abrchin" },
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `psql ${database} failed: ${sanitize(result.stderr || result.stdout || "unknown")}`,
    );
  }
}

function recreateOwnedDatabase(name: string) {
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new Error(`refusing to recreate unexpected database name ${name}`);
  }
  psql(
    "postgres",
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
  );
  psql("postgres", `DROP DATABASE IF EXISTS ${name}`);
  psql("postgres", `CREATE DATABASE ${name} OWNER abrchin`);
}

function waitPort(host: string, port: number, timeoutMs: number) {
  return new Promise<boolean>((resolveWait) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolveWait(false);
    }, timeoutMs);
    socket.on("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolveWait(true);
    });
    socket.on("error", () => {
      clearTimeout(timer);
      resolveWait(false);
    });
  });
}

function sanitize(text: string) {
  return text
    .replace(/postgresql:\/\/[^:\s/]+:[^@\s]+@/gi, "postgresql://user:redacted@")
    .replace(/postgres:\/\/[^:\s/]+:[^@\s]+@/gi, "postgres://user:redacted@")
    .replace(/\b09\d{9}\b/g, "09XXXXXXXXX")
    .replace(/otp=\d+/gi, "otp=REDACTED")
    .replace(/secret_b64"\s*:\s*"[^"]+"/gi, 'secret_b64":"[redacted]"')
    .replace(/CREDENTIAL_ENCRYPTION_KEY=\S+/g, "CREDENTIAL_ENCRYPTION_KEY=[redacted]")
    .replace(/SESSION_SECRET=\S+/g, "SESSION_SECRET=[redacted]")
    .replace(/SMTP_PASSWORD=\S+/g, "SMTP_PASSWORD=[redacted]")
    .replace(/POSTGRES_PASSWORD=\S+/g, "POSTGRES_PASSWORD=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]");
}

function parseNodeCounts(output: string): Counts {
  const skipped = Number(/# skipped\s+(\d+)/.exec(output)?.[1] ?? NaN);
  const pass = Number(/# pass\s+(\d+)/.exec(output)?.[1] ?? NaN);
  const fail = Number(/# fail\s+(\d+)/.exec(output)?.[1] ?? NaN);
  const tests = Number(/# tests\s+(\d+)/.exec(output)?.[1] ?? NaN);
  if (Number.isFinite(pass) || Number.isFinite(fail) || Number.isFinite(skipped)) {
    const passN = Number.isFinite(pass) ? pass : 0;
    const failN = Number.isFinite(fail) ? fail : 0;
    const skipN = Number.isFinite(skipped) ? skipped : 0;
    return {
      pass: passN,
      fail: failN,
      skip: skipN,
      tests: Number.isFinite(tests) ? tests : passN + failN + skipN,
    };
  }
  return emptyCounts();
}

function parseGoJSON(output: string): Counts {
  const counts = emptyCounts();
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const event = JSON.parse(trimmed) as { Action?: string; Test?: string };
      if (!event.Test) continue;
      if (event.Action === "pass") counts.pass += 1;
      if (event.Action === "fail") counts.fail += 1;
      if (event.Action === "skip") counts.skip += 1;
    } catch {
      /* ignore */
    }
  }
  counts.tests = counts.pass + counts.fail + counts.skip;
  return counts;
}

function parseOpsBackup(output: string): Counts {
  if (/SKIP isolated restore/i.test(output)) {
    return { pass: 0, fail: 0, skip: 1, tests: 1 };
  }
  if (/\[wp3-backup-test\] PASS/.test(output) || /restore receipt ok/.test(output)) {
    return { pass: 1, fail: 0, skip: 0, tests: 1 };
  }
  return emptyCounts();
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number },
) {
  return new Promise<{ code: number; output: string }>((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let output = "";
    let finished = false;
    const append = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      output += text;
      process.stdout.write(text);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const killTree = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          /* already exited */
        }
      }
    };
    const finish = (code: number | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolveRun({ code: code ?? 1, output });
    };
    const timer = setTimeout(() => {
      killTree("SIGTERM");
      setTimeout(() => {
        killTree("SIGKILL");
        finish(1);
      }, 5_000);
    }, options.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      finish(code);
    });
  });
}

function abrchinComposeEnvFile() {
  const path = join(tmpdir(), `wp6-abrchin-compose-${randomBytes(4).toString("hex")}.env`);
  writeFileSync(
    path,
    [
      "ABRCHIN_IMAGE=abrchin:wp6-compose-fixture",
      "POSTGRES_DB=abrchin",
      "POSTGRES_USER=abrchin",
      "POSTGRES_PASSWORD=placeholder_not_real",
      "DATABASE_URL=postgresql://abrchin:placeholder_not_real@db:5432/abrchin?schema=public",
      "SESSION_SECRET=placeholder_session_secret_16",
      "CREDENTIAL_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      "SMS_PROVIDER=kavenegar",
      "KAVENEGAR_API_KEY=",
      "PAYMENT_CALLBACK_BASE_URL=https://abrchin.ir",
      "PAYMENT_BOOTSTRAP_DEFAULT_PROVIDER=zibal",
      "ADMIN_MOBILES=",
      "EMAIL_PROVIDER=smtp",
      "EMAIL_FROM=noreply@example.com",
      "SMTP_HOST=smtp.example.com",
      "SMTP_PORT=587",
      "SMTP_SECURE=false",
      "SMTP_USER=smtp-user",
      "SMTP_PASSWORD=smtp-placeholder",
      "SMTP_TIMEOUT_MS=10000",
      "EMAIL_VERIFICATION_TTL_SECONDS=600",
      "WORKER_ID=provisioning-worker",
      "ABRCHIN_RUN_MIGRATE_ON_START=false",
      "",
    ].join("\n"),
  );
  return path;
}

async function collectTopology() {
  const dockerInfo = spawnSync("docker", ["info"], { encoding: "utf8" });
  const composeVersion = capture("docker", ["compose", "version"]);
  const migrations = (await readdir(join(ROOT, "prisma/migrations")))
    .filter((name) => name !== "migration_lock.toml")
    .sort();
  const messagegoMigrations = (await readdir(join(MESSAGEGO, "migrations")))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const redisUp = await waitPort("127.0.0.1", 6379, 500);
  const natsUp = await waitPort("127.0.0.1", 4222, 500);
  const pgUp = await waitPort("127.0.0.1", 5432, 500);
  if (!redisUp) {
    spawnSync(
      "redis-server",
      ["--daemonize", "yes", "--bind", "127.0.0.1", "--port", "6379", "--save", ""],
      { encoding: "utf8" },
    );
  }
  if (!natsUp) {
    spawnSync(
      "nats-server",
      ["-js", "-a", "127.0.0.1", "-p", "4222", "-sd", "/tmp/wp6-nats", "-D"],
      { encoding: "utf8" },
    );
  }
  if (!pgUp) {
    spawnSync("sudo", ["pg_ctlcluster", "16", "main", "start"], { encoding: "utf8" });
  }
  return {
    postgres: {
      implementation: "postgresql",
      version: capture(join(PG_BIN, "postgres"), ["-V"]) || capture("psql", ["--version"]),
      host: "127.0.0.1:5432",
      databases: ["abrchin", "messagego_wp6", "messagego_m6_wp6"],
      listening: await waitPort("127.0.0.1", 5432, 2_000),
    },
    redis: {
      implementation: "redis-server",
      version: capture("redis-server", ["--version"]),
      address: "127.0.0.1:6379",
      listening: await waitPort("127.0.0.1", 6379, 2_000),
    },
    nats: {
      implementation: "nats-server",
      version: capture("nats-server", ["-v"]),
      url: "nats://127.0.0.1:4222",
      jetstream: true,
      listening: await waitPort("127.0.0.1", 4222, 2_000),
    },
    node: capture("node", ["-v"]),
    go: capture("go", ["version"], MESSAGEGO),
    docker_daemon: dockerInfo.status === 0 ? "up" : "down",
    docker_compose: composeVersion,
    abrchin_package_version: "1.0.0",
    messagego_product_version: "1.0.0",
    abrchin_migrations: migrations,
    messagego_migrations: messagegoMigrations,
    adapters: {
      payment_gateway: "MOCK",
      sms: "console",
      smtp: "console",
      arvan_mutations: false,
      provider_traffic: false,
    },
  };
}

function gates(abrchinComposeEnv: string): GateSpec[] {
  const npm = "npm";
  const npx = "npx";
  const goTest = (
    id: string,
    args: string[],
    timeoutMs: number,
    env?: NodeJS.ProcessEnv,
  ): GateSpec => ({
    id,
    repo: "messagego",
    kind: "go-json",
    command: "go",
    args: ["test", "-json", "-count=1", ...args],
    cwd: MESSAGEGO,
    env,
    timeoutMs,
  });
  const abrchinNpm = (
    id: string,
    script: string,
    timeoutMs: number,
    kind: GateSpec["kind"] = "node-test",
  ): GateSpec => ({
    id,
    repo: "abrchin",
    kind,
    command: npm,
    args: ["run", script],
    cwd: ROOT,
    timeoutMs,
  });
  return [
    {
      id: "abrchin-install",
      repo: "abrchin",
      kind: "command",
      command: "node",
      args: [
        "-e",
        "require('fs').accessSync('node_modules/next'); require('fs').accessSync('node_modules/@prisma/client'); console.log('install-ok')",
      ],
      cwd: ROOT,
      timeoutMs: 30_000,
    },
    {
      id: "abrchin-prisma-generate",
      repo: "abrchin",
      kind: "command",
      command: npx,
      args: ["prisma", "generate"],
      cwd: ROOT,
      timeoutMs: 120_000,
    },
    abrchinNpm("abrchin-lint", "lint", 10 * 60_000, "command"),
    abrchinNpm("abrchin-typecheck", "typecheck", 10 * 60_000, "command"),
    abrchinNpm("abrchin-unit-auth", "test:auth", 10 * 60_000),
    abrchinNpm("abrchin-unit-wallet", "test:wallet", 5 * 60_000),
    abrchinNpm("abrchin-unit-billing-policy", "test:billing-policy", 5 * 60_000),
    abrchinNpm("abrchin-unit-customer-navigation", "test:customer-navigation", 10 * 60_000),
    abrchinNpm("abrchin-unit-connection-check", "test:connection-check", 5 * 60_000),
    abrchinNpm("abrchin-unit-payments", "test:payments", 5 * 60_000),
    abrchinNpm("abrchin-unit-account-admin", "test:account-admin", 5 * 60_000),
    abrchinNpm("abrchin-unit-providers", "test:providers", 10 * 60_000),
    abrchinNpm("abrchin-profit-curve", "test:profit-curve", 10 * 60_000),
    abrchinNpm("abrchin-accounting", "test:accounting", 10 * 60_000),
    abrchinNpm("abrchin-recommendation", "test:recommendation", 15 * 60_000),
    abrchinNpm("abrchin-launch-gates", "test:launch-gates", 3 * 60_000),
    abrchinNpm("abrchin-phase1-discovery", "test:phase1-discovery", 5 * 60_000),
    abrchinNpm("abrchin-phase2-guest-auth", "test:phase2-guest-auth", 5 * 60_000),
    abrchinNpm("abrchin-phase3-contract", "test:phase3-contract", 5 * 60_000),
    abrchinNpm("abrchin-phase4-tracking", "test:phase4-tracking", 5 * 60_000),
    abrchinNpm("abrchin-phase5-contract", "test:phase5-contract", 5 * 60_000),
    abrchinNpm("abrchin-phase6-contract", "test:phase6-contract", 5 * 60_000),
    abrchinNpm("abrchin-phase7-parchin", "test:phase7-parchin", 5 * 60_000),
    abrchinNpm("abrchin-phase8-contract", "test:phase8-contract", 5 * 60_000),
    abrchinNpm("abrchin-phase9-readiness", "test:phase9-readiness", 3 * 60_000),
    abrchinNpm("abrchin-legal-content", "test:legal-content", 3 * 60_000),
    abrchinNpm("abrchin-infrastructure", "test:infrastructure", 20 * 60_000),
    abrchinNpm("abrchin-migration-safety", "test:migration-safety", 5 * 60_000),
    {
      id: "abrchin-production-build",
      repo: "abrchin",
      kind: "command",
      command: npm,
      args: ["run", "build"],
      cwd: ROOT,
      timeoutMs: 25 * 60_000,
    },
    abrchinNpm("abrchin-worker-runtime", "test:worker-runtime", 5 * 60_000),
    abrchinNpm("abrchin-panel-role-e2e", "test:panel-role-e2e-isolated", 20 * 60_000),
    abrchinNpm("abrchin-smoke", "test:smoke", 5 * 60_000),
    {
      id: "abrchin-git-diff-check",
      repo: "abrchin",
      kind: "command",
      command: "git",
      args: ["diff", "--check"],
      cwd: ROOT,
      timeoutMs: 30_000,
    },
    abrchinNpm("abrchin-postgres-migration", "test:postgres", 20 * 60_000, "command"),
    abrchinNpm("abrchin-fresh-migration", "test:fresh-migration", 15 * 60_000, "command"),
    abrchinNpm("abrchin-migration-upgrade", "test:migration-upgrade", 45 * 60_000, "command"),
    abrchinNpm("abrchin-identity-migration", "test:identity-migration", 15 * 60_000, "command"),
    abrchinNpm("abrchin-parspack-history", "test:parspack-history", 15 * 60_000, "command"),
    abrchinNpm("abrchin-settlement-history", "test:wp5-settlement-history", 15 * 60_000, "command"),
    abrchinNpm("abrchin-phase3-postgres", "test:wp5-phase3-postgres", 20 * 60_000),
    abrchinNpm("abrchin-phase5-postgres", "test:wp5-phase5-postgres", 20 * 60_000),
    abrchinNpm("abrchin-phase6-postgres", "test:phase6-postgres", 15 * 60_000),
    abrchinNpm("abrchin-phase7-postgres", "test:phase7-postgres", 15 * 60_000),
    abrchinNpm("abrchin-financial-postgres", "test:financial-postgres", 15 * 60_000, "command"),
    abrchinNpm("abrchin-accounting-postgres", "test:accounting-isolated", 15 * 60_000),
    abrchinNpm("abrchin-messagego-integration", "test:messagego-v2-release-readiness", 40 * 60_000),
    {
      id: "abrchin-backup-restore",
      repo: "abrchin",
      kind: "ops-backup",
      command: npm,
      args: ["run", "test:ops-wp3"],
      cwd: ROOT,
      timeoutMs: 10 * 60_000,
    },
    abrchinNpm("abrchin-secret-scan", "test:secret-scan", 5 * 60_000, "command"),
    {
      id: "abrchin-npm-audit",
      repo: "abrchin",
      kind: "command",
      command: npm,
      args: ["audit", "--omit=dev", "--audit-level=low"],
      cwd: ROOT,
      timeoutMs: 180_000,
    },
    {
      id: "abrchin-compose-validate",
      repo: "abrchin",
      kind: "command",
      command: "docker",
      args: [
        "compose",
        "--env-file",
        abrchinComposeEnv,
        "-f",
        "compose.production.yaml",
        "config",
        "--quiet",
      ],
      cwd: ROOT,
      timeoutMs: 60_000,
    },
    {
      id: "messagego-fmt-check",
      repo: "messagego",
      kind: "command",
      command: "make",
      args: ["fmt-check"],
      cwd: MESSAGEGO,
      timeoutMs: 60_000,
    },
    {
      id: "messagego-vet",
      repo: "messagego",
      kind: "command",
      command: "make",
      args: ["vet"],
      cwd: MESSAGEGO,
      timeoutMs: 180_000,
    },
    goTest("messagego-unit", ["./..."], 25 * 60_000),
    goTest("messagego-race", ["-race", "./..."], 40 * 60_000),
    goTest(
      "messagego-postgres-integration",
      ["-tags=integration", "-timeout", "10m", "./internal/adapters/postgres"],
      15 * 60_000,
      {
        CRX_TEST_DATABASE_URL:
          process.env.CRX_TEST_DATABASE_URL ||
          "postgresql://abrchin:abrchin@127.0.0.1:5432/messagego_wp6",
      },
    ),
    goTest(
      "messagego-m6-postgres-integration",
      ["-tags=integration", "-timeout", "10m", "./internal/m6bootstrap"],
      10 * 60_000,
      {
        CRX_TEST_DATABASE_URL: MESSAGEGO_M6_DATABASE_URL,
      },
    ),
    goTest(
      "messagego-redis-up",
      [
        "-tags=integration",
        "-timeout",
        "60s",
        "-run",
        "^TestRedisLimiterIsAtomicAndProductIsolated$",
        "./internal/adapters/redislimit",
      ],
      60_000,
      { WP5_REQUIRE_SERVICES: "1", CRX_TEST_REDIS_ADDRESS: "127.0.0.1:6379" },
    ),
    goTest(
      "messagego-redis-down",
      [
        "-tags=integration",
        "-timeout",
        "30s",
        "-run",
        "^TestRedisUnavailableFailsClosed$",
        "./internal/adapters/redislimit",
      ],
      30_000,
      {
        WP5_REDIS_EXPECT_DOWN: "1",
        CRX_TEST_REDIS_ADDRESS: "127.0.0.1:1",
      },
    ),
    goTest(
      "messagego-nats-up",
      [
        "-tags=integration",
        "-timeout",
        "60s",
        "-run",
        "^TestJetStreamDeduplicatesStableEventID$",
        "./internal/adapters/natsjs",
      ],
      60_000,
      { WP5_REQUIRE_SERVICES: "1", CRX_TEST_NATS_URL: "nats://127.0.0.1:4222" },
    ),
    goTest(
      "messagego-nats-down",
      [
        "-tags=integration",
        "-timeout",
        "30s",
        "-run",
        "^TestNATSUnavailableFailsClosed$",
        "./internal/adapters/natsjs",
      ],
      30_000,
      {
        WP5_NATS_EXPECT_DOWN: "1",
        CRX_TEST_NATS_URL: "nats://127.0.0.1:1",
      },
    ),
    {
      id: "messagego-contracts",
      repo: "messagego",
      kind: "command",
      command: "make",
      args: ["contract-test"],
      cwd: MESSAGEGO,
      timeoutMs: 10 * 60_000,
    },
    {
      id: "messagego-clients",
      repo: "messagego",
      kind: "command",
      command: "make",
      args: ["client-test"],
      cwd: MESSAGEGO,
      timeoutMs: 15 * 60_000,
    },
    {
      id: "messagego-release-check",
      repo: "messagego",
      kind: "command",
      command: "make",
      args: ["release-check"],
      cwd: MESSAGEGO,
      timeoutMs: 15 * 60_000,
    },
    {
      id: "messagego-settlement-contract",
      repo: "messagego",
      kind: "command",
      command: "make",
      args: ["v2-settlement-contract-check"],
      cwd: MESSAGEGO,
      timeoutMs: 3 * 60_000,
    },
    {
      id: "messagego-provider-registry",
      repo: "messagego",
      kind: "command",
      command: "make",
      args: ["v2-provider-registry-check"],
      cwd: MESSAGEGO,
      timeoutMs: 3 * 60_000,
    },
    {
      id: "messagego-policy-selector",
      repo: "messagego",
      kind: "command",
      command: "make",
      args: ["v2-policy-selector-check"],
      cwd: MESSAGEGO,
      timeoutMs: 3 * 60_000,
    },
    goTest(
      "messagego-v2-packages",
      [
        "./internal/adapters/v2settlement",
        "./internal/v2billing",
        "./internal/v2integration",
        "./internal/v2providers",
        "./internal/v2s2s",
        "./internal/v2secrets",
      ],
      10 * 60_000,
    ),
    {
      id: "messagego-govulncheck",
      repo: "messagego",
      kind: "command",
      command: "govulncheck",
      args: ["./..."],
      cwd: MESSAGEGO,
      env: {
        GOTOOLCHAIN: "go1.25.13",
      },
      timeoutMs: 15 * 60_000,
    },
    {
      id: "messagego-compose-validate",
      repo: "messagego",
      kind: "command",
      command: "docker",
      args: ["compose", "-f", "deployments/single-server/docker-compose.yml", "config", "--quiet"],
      cwd: MESSAGEGO,
      env: {
        POSTGRES_PASSWORD: "postgres-test-password",
        CRX_JWT_SECRET: "jwt-test-secret-0123456789abcdef0123456789abcdef",
        CRX_ASSET_SIGNING_SECRET: "asset-test-secret-fedcba9876543210fedcba9876543210",
        MESSAGEGO_CLIENT_CREDENTIAL_PEPPER: "pepper-test-secret-0123456789abcdef0123456789abcdef",
        REDIS_PASSWORD: "redis-test-password",
      },
      timeoutMs: 60_000,
    },
    {
      id: "messagego-backup-restore",
      repo: "messagego",
      kind: "ops-backup",
      command: "bash",
      args: ["ops/wp3-backup-test.sh"],
      cwd: MESSAGEGO,
      timeoutMs: 10 * 60_000,
    },
  ];
}

async function runGate(spec: GateSpec): Promise<GateResult> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  console.log(`\n[wp6] GATE ${spec.id}: ${spec.command} ${spec.args.join(" ")}`);
  const { code, output } = await runCommand(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    timeoutMs: spec.timeoutMs,
  });
  let counts = emptyCounts();
  if (spec.kind === "node-test") counts = parseNodeCounts(output);
  if (spec.kind === "go-json") counts = parseGoJSON(output);
  if (spec.kind === "ops-backup") {
    const node = parseNodeCounts(output);
    const backup = parseOpsBackup(output);
    counts = {
      pass: node.pass + backup.pass,
      fail: node.fail + backup.fail,
      skip: node.skip + backup.skip,
      tests: node.tests + backup.tests,
    };
  }
  if (spec.kind === "command") {
    counts = {
      pass: code === 0 ? 1 : 0,
      fail: code === 0 ? 0 : 1,
      skip: 0,
      tests: 1,
    };
  }
  if (spec.kind === "node-test" && counts.tests === 0) {
    counts = {
      pass: code === 0 ? 1 : 0,
      fail: code === 0 ? 0 : 1,
      skip: 0,
      tests: 1,
    };
  }
  if (/SKIP isolated restore/i.test(output) && spec.kind === "ops-backup") {
    counts = { pass: 0, fail: 0, skip: 1, tests: 1 };
  }
  let status: GateResult["status"] = "pass";
  if (code !== 0 || counts.fail > 0) status = "fail";
  else if (counts.skip > 0) status = "skip";
  return {
    id: spec.id,
    repo: spec.repo,
    required: true,
    command: `${spec.command} ${spec.args.join(" ")}`.trim(),
    startedAt,
    endedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    exitCode: code,
    counts,
    status,
    logTail: sanitize(output.split("\n").slice(-80).join("\n")),
  };
}

function markdownReceipt(input: {
  verdict: string;
  abrchinSha: string;
  messagegoSha: string;
  startedAt: string;
  endedAt: string;
  topology: Awaited<ReturnType<typeof collectTopology>>;
  results: GateResult[];
  totals: Counts;
  restore: Record<string, unknown>;
  warnings: string[];
}) {
  const gateRows = input.results
    .map(
      (gate) =>
        `| \`${gate.id}\` | \`${gate.repo}\` | \`${gate.status}\` | ${gate.counts.pass}/${gate.counts.fail}/${gate.counts.skip} | \`${gate.command}\` |`,
    )
    .join("\n");
  return `# WP6 release-truth receipt

Tied SHAs:

- AbrChin: \`${input.abrchinSha}\`
- MessageGo: \`${input.messagegoSha}\`

\`\`\`text
verdict = ${input.verdict}
owner_acceptance = false
owner_accepted = false
production_authorized = false
provider_traffic_authorized = false
READY_FOR_FIRST_PRODUCTION_DEPLOYMENT = NO
PRODUCTION NOT AUTHORIZED
LIVE PROVIDER TRAFFIC NOT AUTHORIZED
\`\`\`

Started: \`${input.startedAt}\`
Ended: \`${input.endedAt}\`

## Environment topology

- PostgreSQL: \`${input.topology.postgres.version}\` at \`${input.topology.postgres.host}\` listening=${input.topology.postgres.listening}
- Redis: \`${input.topology.redis.version}\` at \`${input.topology.redis.address}\` listening=${input.topology.redis.listening}
- NATS: \`${input.topology.nats.version}\` at \`${input.topology.nats.url}\` listening=${input.topology.nats.listening}
- Node: \`${input.topology.node}\`
- Go: \`${input.topology.go}\`
- Docker daemon: \`${input.topology.docker_daemon}\`
- Docker Compose: \`${input.topology.docker_compose}\`
- Payment/SMS/SMTP adapters: MOCK / console / console
- Live Arvan mutations: false
- Live provider traffic: false

## AbrChin Prisma migrations (${input.topology.abrchin_migrations.length})

${input.topology.abrchin_migrations.map((name) => `- \`${name}\``).join("\n")}

## MessageGo SQL migrations (${input.topology.messagego_migrations.length})

${input.topology.messagego_migrations.map((name) => `- \`${name}\``).join("\n")}

## Gate results

| Gate | Repo | Status | pass/fail/skip | Command |
| --- | --- | --- | --- | --- |
${gateRows}

Totals: pass=${input.totals.pass} fail=${input.totals.fail} skip=${input.totals.skip}

## Restore verification

\`\`\`json
${JSON.stringify(input.restore, null, 2)}
\`\`\`

## Remaining warnings

${input.warnings.length === 0 ? "- none recorded" : input.warnings.map((w) => `- ${w}`).join("\n")}

A skipped required test is \`NO-GO\`. This receipt does not set owner
acceptance or production authorization.
`;
}

function pointerMarkdown(abrchinSha: string, messagegoSha: string, verdict: string) {
  return `# WP6 release-truth pointer

Canonical sanitized receipts:

- AbrChin \`docs/launch/wp6-release-truth.md\`
- AbrChin \`docs/launch/evidence/wp6/receipt.json\`
- AbrChin \`docs/launch/evidence/wp6/receipt.md\`
- Owner checklist (unsigned): AbrChin \`docs/launch/wp6-owner-acceptance-checklist.md\`
- Cross-repo report: AbrChin \`docs/launch/wp6-cross-repo-release-report.md\`

\`\`\`text
PRODUCTION DEPLOYMENT = NOT AUTHORIZED
LIVE PROVIDER TRAFFIC = NOT AUTHORIZED
OWNER ACCEPTANCE = NOT SET
owner_accepted = false
ready_for_first_production_deployment = false
verdict = ${verdict}
\`\`\`

## Pins from this receipt run

- AbrChin SHA: \`${abrchinSha}\`
- MessageGo SHA: \`${messagegoSha}\`
`;
}

async function main() {
  const startedAt = new Date().toISOString();
  const abrchinSha = gitSha(ROOT);
  const messagegoSha = gitSha(MESSAGEGO);
  const topology = await collectTopology();
  if (!topology.postgres.listening || !topology.redis.listening || !topology.nats.listening) {
    throw new Error(
      `required local services are down postgres=${topology.postgres.listening} redis=${topology.redis.listening} nats=${topology.nats.listening}`,
    );
  }
  if (!existsSync(join(PG_BIN, "initdb"))) {
    throw new Error("initdb missing; backup/restore would skip and WP6 is NO-GO");
  }
  recreateOwnedDatabase("messagego_wp6");
  recreateOwnedDatabase("messagego_m6_wp6");
  const composeEnv = abrchinComposeEnvFile();
  const results: GateResult[] = [];
  for (const spec of gates(composeEnv)) {
    results.push(await runGate(spec));
  }

  const totals = results.reduce(
    (sum, gate) => ({
      pass: sum.pass + gate.counts.pass,
      fail: sum.fail + gate.counts.fail,
      skip: sum.skip + gate.counts.skip,
      tests: sum.tests + gate.counts.tests,
    }),
    emptyCounts(),
  );

  const requiredSkip = results.some((gate) => gate.status === "skip");
  const requiredFail = results.some((gate) => gate.status === "fail");
  const verdict =
    !requiredSkip && !requiredFail ? "READY_FOR_OWNER_TEST" : "NO-GO";

  const backupGate = results.find((gate) => gate.id === "messagego-backup-restore");
  const infraGate = results.find((gate) => gate.id === "abrchin-infrastructure");
  const restore = {
    messagego_wp3_backup: backupGate?.status ?? "missing",
    abrchin_ops_wp3_in_infrastructure: infraGate?.status ?? "missing",
    production_restore: false,
    isolated_restore_required: true,
    skipped: backupGate?.status === "skip",
  };
  const warnings: string[] = [];
  if (topology.docker_daemon === "down") {
    warnings.push(
      "Docker daemon was down. Compose validation used `docker compose config` without starting containers.",
    );
  }
  if (verdict === "READY_FOR_OWNER_TEST") {
    warnings.push("Owner acceptance is still unsigned. Production remains unauthorized.");
  }

  const endedAt = new Date().toISOString();
  const receipt = {
    work_package: "WP6",
    product: "MessageGo",
    product_version: "1.0.0",
    public_api: "/v1",
    verdict,
    owner_acceptance: false,
    owner_accepted: false,
    production_authorized: false,
    provider_traffic_authorized: false,
    ready_for_first_production_deployment: false,
    abrchin_sha: abrchinSha,
    messagego_sha: messagegoSha,
    started_at: startedAt,
    ended_at: endedAt,
    environment_topology: topology,
    totals,
    gates: results.map((gate) => ({
      ...gate,
      logTail: gate.status === "pass" ? undefined : gate.logTail,
    })),
    restore_verification: restore,
    remaining_warnings: warnings,
    required_skip_means: "NO-GO",
  };

  await mkdir(EVIDENCE_DIR, { recursive: true });
  const md = markdownReceipt({
    verdict,
    abrchinSha,
    messagegoSha,
    startedAt,
    endedAt,
    topology,
    results,
    totals,
    restore,
    warnings,
  });
  await writeFile(RECEIPT_JSON, `${JSON.stringify(receipt, null, 2)}\n`);
  await writeFile(RECEIPT_MD, md);
  await writeFile(LAUNCH_MD, md);
  await writeFile(POINTER_MD, pointerMarkdown(abrchinSha, messagegoSha, verdict));

  console.log(`\n[wp6] verdict=${verdict} pass=${totals.pass} fail=${totals.fail} skip=${totals.skip}`);
  console.log(`[wp6] abrchin=${abrchinSha}`);
  console.log(`[wp6] messagego=${messagegoSha}`);
  if (verdict !== "READY_FOR_OWNER_TEST") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
