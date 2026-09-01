/**
 * WP5 production-candidate orchestrator.
 * Real PostgreSQL, Redis, NATS, AbrChin, and MessageGo. No production deploy.
 * No live provider traffic. A required skip is NO-GO.
 */
import { spawn, spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MESSAGEGO = resolve(ROOT, "../MessageGo");
const PG_BIN = "/usr/lib/postgresql/16/bin";
const EVIDENCE_DIR = join(ROOT, "docs/launch/evidence/wp5");
const RECEIPT_JSON = join(EVIDENCE_DIR, "receipt.json");
const RECEIPT_MD = join(EVIDENCE_DIR, "receipt.md");
const LAUNCH_MD = join(ROOT, "docs/launch/wp5-production-candidate.md");
const POINTER_MD = join(MESSAGEGO, "docs/program/wp5-production-candidate-pointer.md");

process.env.PATH = `${PG_BIN}:/usr/sbin:${process.env.PATH ?? ""}`;
process.env.WP5_REQUIRE_SERVICES = "1";
process.env.CRX_TEST_REDIS_ADDRESS =
  process.env.CRX_TEST_REDIS_ADDRESS || "127.0.0.1:6379";
process.env.CRX_TEST_NATS_URL =
  process.env.CRX_TEST_NATS_URL || "nats://127.0.0.1:4222";
process.env.POSTGRES_TEST_DATABASE_URL =
  process.env.POSTGRES_TEST_DATABASE_URL ||
  "postgresql://abrchin:abrchin@127.0.0.1:5432/abrchin";
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
process.env.NODE_ENV = process.env.NODE_ENV === "production" ? "test" : process.env.NODE_ENV || "test";

type Counts = { pass: number; fail: number; skip: number; tests: number };
type GateResult = {
  id: string;
  repo: "abrchin" | "messagego";
  required: boolean;
  command: string;
  covers: string[];
  startedAt: string;
  endedAt: string;
  elapsedMs: number;
  exitCode: number;
  counts: Counts;
  status: "pass" | "fail" | "skip";
  logTail: string;
};

const REQUIRED_SCENARIOS = [
  "prepaid_1_month",
  "prepaid_3_months",
  "prepaid_6_months",
  "prepaid_12_months",
  "admin_publish_priced_arvan_plan",
  "customer_quote",
  "quote_price_and_expiry",
  "wallet_topup_mock_gateway",
  "idempotent_gateway_callback",
  "atomic_wallet_debit",
  "admin_approval_1",
  "manual_fulfillment",
  "admin_approval_2",
  "secure_credential_delivery",
  "financial_audit_reconcile",
  "insufficient_wallet",
  "expired_quote",
  "missing_price",
  "one_rial_placeholder",
  "zero_placeholder",
  "unpublished_plan",
  "customer_publication_attempt",
  "direct_order_payment",
  "duplicate_gateway_callback",
  "duplicate_order_submission",
  "concurrent_wallet_debit",
  "worker_restart",
  "abrchin_restart",
  "messagego_restart",
  "redis_failure",
  "nats_failure",
  "postgres_interruption",
  "provider_timeout",
  "unknown_provider_usage",
  "duplicate_s2s_nonce",
  "stale_s2s_timestamp",
  "invalid_hmac",
  "settlement_timeout",
  "reserve_succeeds_dispatch_fails",
  "dispatch_succeeds_settlement_lost",
  "idempotent_ai_retry",
  "readonly_token_ai_execute",
  "backup_restore",
  "fresh_migration",
  "upgrade_prior_schema",
  "parspack_history_upgrade",
  "wallet_settlement_history_upgrade",
] as const;

type Scenario = (typeof REQUIRED_SCENARIOS)[number];

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
    .replace(/wp5-credential-[A-Za-z0-9._-]+/g, "wp5-credential-[redacted]")
    .replace(/callbackTokenHash[=:][^\s,]+/g, "callbackTokenHash=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]");
}

function parseNodeCounts(output: string): Counts {
  const skipped = Number(/# skipped\s+(\d+)/.exec(output)?.[1] ?? NaN);
  const pass = Number(/# pass\s+(\d+)/.exec(output)?.[1] ?? NaN);
  const fail = Number(/# fail\s+(\d+)/.exec(output)?.[1] ?? NaN);
  const tests = Number(/# tests\s+(\d+)/.exec(output)?.[1] ?? NaN);
  if (Number.isFinite(pass) || Number.isFinite(fail) || Number.isFinite(skipped)) {
    return {
      pass: Number.isFinite(pass) ? pass : 0,
      fail: Number.isFinite(fail) ? fail : 0,
      skip: Number.isFinite(skipped) ? skipped : 0,
      tests: Number.isFinite(tests)
        ? tests
        : (Number.isFinite(pass) ? pass : 0) +
          (Number.isFinite(fail) ? fail : 0) +
          (Number.isFinite(skipped) ? skipped : 0),
    };
  }
  const skipLines = [...output.matchAll(/^# Subtest:.*\n(?:.*\n)*?ok .*# SKIP/gm)].length;
  return { pass: 0, fail: 0, skip: skipLines, tests: skipLines };
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
      /* ignore non-json */
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
    });
    let output = "";
    const append = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      output += text;
      process.stdout.write(text);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000);
    }, options.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({ code: code ?? 1, output });
    });
  });
}

async function collectTopology() {
  const docker = spawnSync("docker", ["info"], { encoding: "utf8" });
  const migrations = (await readdir(join(ROOT, "prisma/migrations")))
    .filter((name) => name !== "migration_lock.toml")
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
      ["-js", "-a", "127.0.0.1", "-p", "4222", "-sd", "/tmp/wp5-nats", "-D"],
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
      database: "abrchin",
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
    go: capture("go", ["version"]),
    abrchin_package_version: "1.0.0",
    messagego_product_version: "1.0.0",
    docker_daemon: docker.status === 0 ? "up" : "down",
    migrations,
    adapters: {
      payment_gateway: "MOCK",
      sms: "console",
      smtp: "console",
      arvan_mutations: false,
      provider_traffic: false,
    },
  };
}

type GateSpec = {
  id: string;
  repo: "abrchin" | "messagego";
  kind: "node-test" | "go-json" | "command" | "ops-backup";
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  covers: Scenario[];
};

function gates(): GateSpec[] {
  const npm = "npm";
  const goTest = (
    id: string,
    args: string[],
    covers: Scenario[],
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
    covers,
  });
  return [
    {
      id: "wp5-golden-path",
      repo: "abrchin",
      kind: "node-test",
      command: npm,
      args: ["run", "test:wp5-golden-path"],
      cwd: ROOT,
      timeoutMs: 20 * 60_000,
      covers: [
        "prepaid_1_month",
        "prepaid_3_months",
        "prepaid_6_months",
        "prepaid_12_months",
        "admin_publish_priced_arvan_plan",
        "customer_quote",
        "quote_price_and_expiry",
        "wallet_topup_mock_gateway",
        "idempotent_gateway_callback",
        "atomic_wallet_debit",
        "admin_approval_1",
        "manual_fulfillment",
        "admin_approval_2",
        "secure_credential_delivery",
        "financial_audit_reconcile",
        "insufficient_wallet",
        "expired_quote",
        "missing_price",
        "one_rial_placeholder",
        "zero_placeholder",
        "unpublished_plan",
        "customer_publication_attempt",
        "direct_order_payment",
        "duplicate_gateway_callback",
        "duplicate_order_submission",
        "concurrent_wallet_debit",
        "unknown_provider_usage",
        "provider_timeout",
      ],
    },
    {
      id: "wp5-runtime",
      repo: "abrchin",
      kind: "node-test",
      command: npm,
      args: ["run", "test:wp5-runtime"],
      cwd: ROOT,
      timeoutMs: 12 * 60_000,
      covers: ["worker_restart", "abrchin_restart", "postgres_interruption"],
    },
    {
      id: "wp5-settlement-history",
      repo: "abrchin",
      kind: "command",
      command: npm,
      args: ["run", "test:wp5-settlement-history"],
      cwd: ROOT,
      timeoutMs: 10 * 60_000,
      covers: ["wallet_settlement_history_upgrade"],
    },
    {
      id: "fresh-migration",
      repo: "abrchin",
      kind: "command",
      command: npm,
      args: ["run", "test:fresh-migration"],
      cwd: ROOT,
      timeoutMs: 10 * 60_000,
      covers: ["fresh_migration"],
    },
    {
      id: "migration-upgrade",
      repo: "abrchin",
      kind: "command",
      command: npm,
      args: ["run", "test:migration-upgrade"],
      cwd: ROOT,
      timeoutMs: 45 * 60_000,
      covers: ["upgrade_prior_schema"],
    },
    {
      id: "parspack-history",
      repo: "abrchin",
      kind: "command",
      command: npm,
      args: ["run", "test:parspack-history"],
      cwd: ROOT,
      timeoutMs: 15 * 60_000,
      covers: ["parspack_history_upgrade"],
    },
    {
      id: "ops-wp3-backup",
      repo: "abrchin",
      kind: "ops-backup",
      command: npm,
      args: ["run", "test:ops-wp3"],
      cwd: ROOT,
      timeoutMs: 10 * 60_000,
      covers: ["backup_restore"],
    },
    {
      id: "sellable-pricing-policy",
      repo: "abrchin",
      kind: "node-test",
      command: "node",
      args: [
        "--import",
        "./scripts/test-resolve-hook.mjs",
        "--experimental-strip-types",
        "--test",
        "scripts/sellable-pricing-policy-test.mts",
      ],
      cwd: ROOT,
      timeoutMs: 60_000,
      covers: ["missing_price", "one_rial_placeholder", "zero_placeholder"],
    },
    {
      id: "failure-recovery-policy",
      repo: "abrchin",
      kind: "node-test",
      command: "node",
      args: [
        "--import",
        "./scripts/test-resolve-hook.mjs",
        "--experimental-strip-types",
        "--test",
        "scripts/failure-recovery-policy-test.mts",
      ],
      cwd: ROOT,
      timeoutMs: 60_000,
      covers: ["provider_timeout"],
    },
    {
      id: "wp5-phase3-postgres",
      repo: "abrchin",
      kind: "node-test",
      command: npm,
      args: ["run", "test:wp5-phase3-postgres"],
      cwd: ROOT,
      timeoutMs: 15 * 60_000,
      covers: ["atomic_wallet_debit", "concurrent_wallet_debit"],
    },
    {
      id: "wp5-phase5-postgres",
      repo: "abrchin",
      kind: "node-test",
      command: npm,
      args: ["run", "test:wp5-phase5-postgres"],
      cwd: ROOT,
      timeoutMs: 15 * 60_000,
      covers: [
        "direct_order_payment",
        "customer_publication_attempt",
        "secure_credential_delivery",
      ],
    },
    {
      id: "messagego-settlement-unit",
      repo: "abrchin",
      kind: "node-test",
      command: npm,
      args: ["run", "test:messagego-v2-settlement"],
      cwd: ROOT,
      timeoutMs: 180_000,
      covers: ["unknown_provider_usage"],
    },
    {
      id: "messagego-settlement-postgres",
      repo: "abrchin",
      kind: "node-test",
      command: npm,
      args: ["run", "test:wp5-settlement-postgres"],
      cwd: ROOT,
      timeoutMs: 10 * 60_000,
      covers: ["duplicate_s2s_nonce", "invalid_hmac"],
    },
    {
      id: "messagego-integration-unit",
      repo: "abrchin",
      kind: "node-test",
      command: npm,
      args: ["run", "test:messagego-v2-integration"],
      cwd: ROOT,
      timeoutMs: 180_000,
      covers: ["settlement_timeout"],
    },
    {
      id: "messagego-integration-postgres",
      repo: "abrchin",
      kind: "node-test",
      command: npm,
      args: ["run", "test:wp5-integration-postgres"],
      cwd: ROOT,
      timeoutMs: 10 * 60_000,
      covers: ["dispatch_succeeds_settlement_lost"],
    },
    {
      id: "messagego-preprod-hmac",
      repo: "abrchin",
      kind: "node-test",
      command: npm,
      args: ["run", "test:messagego-v2-preprod"],
      cwd: ROOT,
      timeoutMs: 180_000,
      covers: ["invalid_hmac", "stale_s2s_timestamp", "duplicate_s2s_nonce"],
    },
    {
      id: "messagego-preprod-postgres",
      repo: "abrchin",
      kind: "node-test",
      command: npm,
      args: ["run", "test:messagego-v2-preprod-postgres"],
      cwd: ROOT,
      timeoutMs: 10 * 60_000,
      covers: ["invalid_hmac", "duplicate_s2s_nonce"],
    },
    {
      id: "messagego-fmt-check",
      repo: "messagego",
      kind: "command",
      command: "make",
      args: ["fmt-check"],
      cwd: MESSAGEGO,
      timeoutMs: 60_000,
      covers: [],
    },
    {
      id: "messagego-vet",
      repo: "messagego",
      kind: "command",
      command: "make",
      args: ["vet"],
      cwd: MESSAGEGO,
      timeoutMs: 120_000,
      covers: [],
    },
    goTest(
      "messagego-unit",
      ["./..."],
      [
        "invalid_hmac",
        "duplicate_s2s_nonce",
        "stale_s2s_timestamp",
        "readonly_token_ai_execute",
        "idempotent_ai_retry",
        "reserve_succeeds_dispatch_fails",
        "dispatch_succeeds_settlement_lost",
        "messagego_restart",
      ],
      25 * 60_000,
    ),
    goTest("messagego-race", ["-race", "./..."], ["idempotent_ai_retry"], 35 * 60_000),
    goTest(
      "messagego-wp09-cross",
      ["-tags=wp09cross", "-timeout", "180s", "./internal/v2integration"],
      ["settlement_timeout", "dispatch_succeeds_settlement_lost"],
      180_000,
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
      [],
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
      ["redis_failure"],
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
      [],
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
      ["nats_failure"],
      30_000,
      {
        WP5_NATS_EXPECT_DOWN: "1",
        CRX_TEST_NATS_URL: "nats://127.0.0.1:1",
      },
    ),
    goTest(
      "messagego-hmac-matrix",
      [
        "-timeout",
        "60s",
        "-run",
        "^(TestHMACFailureMatrix|TestDuplicateNonceRejected)$",
        "./internal/v2s2s",
      ],
      ["invalid_hmac", "stale_s2s_timestamp", "duplicate_s2s_nonce"],
      60_000,
    ),
    goTest(
      "messagego-dispatch-fail",
      [
        "-timeout",
        "60s",
        "-run",
        "^TestReserveSucceedsDispatchFailsKeepsHold$",
        "./internal/v2integration",
      ],
      ["reserve_succeeds_dispatch_fails", "provider_timeout"],
      60_000,
    ),
    goTest(
      "messagego-api-restart",
      [
        "-timeout",
        "180s",
        "-run",
        "^TestAPIProcessRestartKeepsLive$",
        "./internal/v2runtime",
      ],
      ["messagego_restart"],
      180_000,
    ),
  ];
}

async function runGate(spec: GateSpec): Promise<GateResult> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  console.log(`\n[wp5] GATE ${spec.id}: ${spec.command} ${spec.args.join(" ")}`);
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
  if (/SKIP isolated restore/i.test(output) && spec.kind === "ops-backup") {
    counts.skip += counts.skip === 0 ? 1 : 0;
  }
  let status: GateResult["status"] = "pass";
  if (code !== 0 || counts.fail > 0) status = "fail";
  else if (counts.skip > 0) status = "skip";
  const endedAt = new Date().toISOString();
  const tail = sanitize(output.split("\n").slice(-80).join("\n"));
  return {
    id: spec.id,
    repo: spec.repo,
    required: true,
    command: `${spec.command} ${spec.args.join(" ")}`.trim(),
    covers: spec.covers,
    startedAt,
    endedAt,
    elapsedMs: Date.now() - started,
    exitCode: code,
    counts,
    status,
    logTail: tail,
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
  financial: Record<string, unknown>;
  scenarioStatus: Record<string, string>;
}) {
  const gateRows = input.results
    .map(
      (gate) =>
        `| \`${gate.id}\` | \`${gate.repo}\` | \`${gate.status}\` | ${gate.counts.pass}/${gate.counts.fail}/${gate.counts.skip} | \`${gate.command}\` |`,
    )
    .join("\n");
  const scenarioRows = Object.entries(input.scenarioStatus)
    .map(([name, status]) => `| \`${name}\` | \`${status}\` |`)
    .join("\n");
  return `# WP5 production-candidate receipt

Tied SHAs:

- AbrChin: \`${input.abrchinSha}\`
- MessageGo: \`${input.messagegoSha}\`

\`\`\`text
verdict = ${input.verdict}
owner_acceptance = false
production_authorized = false
provider_traffic_authorized = false
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
- Payment/SMS/SMTP adapters: MOCK / console / console
- Live Arvan mutations: false
- Live provider traffic: false

## Migration versions

${input.topology.migrations.map((name) => `- \`${name}\``).join("\n")}

## Gate results

| Gate | Repo | Status | pass/fail/skip | Command |
| --- | --- | --- | --- | --- |
${gateRows}

Totals: pass=${input.totals.pass} fail=${input.totals.fail} skip=${input.totals.skip}

## Required scenario coverage

| Scenario | Status |
| --- | --- |
${scenarioRows}

## Restore verification

\`\`\`json
${JSON.stringify(input.restore, null, 2)}
\`\`\`

## Financial invariants

\`\`\`json
${JSON.stringify(input.financial, null, 2)}
\`\`\`

A skipped required test is \`NO-GO\`. This receipt does not set owner acceptance
or production authorization.
`;
}

function pointerMarkdown(abrchinSha: string, messagegoSha: string, verdict: string) {
  return `# WP5 production-candidate pointer

Package: AbrChin–MessageGo Golden Path production-candidate integration.

Canonical sanitized receipts:

- AbrChin \`${LAUNCH_MD.replace(`${ROOT}/`, "")}\`
- AbrChin \`docs/launch/evidence/wp5/receipt.json\`
- AbrChin \`docs/launch/evidence/wp5/receipt.md\`

\`\`\`text
PRODUCTION DEPLOYMENT = NOT AUTHORIZED
LIVE PROVIDER TRAFFIC = NOT AUTHORIZED
OWNER ACCEPTANCE = NOT SET
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
    throw new Error("initdb missing; backup/restore would skip and WP5 is NO-GO");
  }

  const results: GateResult[] = [];
  for (const spec of gates()) {
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

  const scenarioStatus: Record<string, string> = {};
  for (const scenario of REQUIRED_SCENARIOS) {
    const owners = results.filter((gate) => gate.covers.includes(scenario));
    if (owners.length === 0) scenarioStatus[scenario] = "unmapped";
    else if (owners.some((gate) => gate.status === "fail")) scenarioStatus[scenario] = "fail";
    else if (owners.some((gate) => gate.status === "skip")) scenarioStatus[scenario] = "skip";
    else if (owners.every((gate) => gate.status === "pass")) scenarioStatus[scenario] = "pass";
    else scenarioStatus[scenario] = "fail";
  }

  const requiredSkip = results.some((gate) => gate.status === "skip");
  const requiredFail = results.some((gate) => gate.status === "fail");
  const unmapped = Object.values(scenarioStatus).includes("unmapped");
  const scenarioFail = Object.values(scenarioStatus).some(
    (status) => status !== "pass",
  );
  const verdict =
    !requiredSkip && !requiredFail && !unmapped && !scenarioFail
      ? "READY_FOR_OWNER_TEST"
      : "NO-GO";

  const backupGate = results.find((gate) => gate.id === "ops-wp3-backup");
  const restore = {
    gate: "ops-wp3-backup",
    status: backupGate?.status ?? "missing",
    production_restore: false,
    isolated_restore_required: true,
    skipped: backupGate?.status === "skip",
  };
  const financial = {
    integer_rial_only: true,
    floating_point_money: false,
    wallet_credits_minus_debits_equals_balance: "asserted_in_wp5-golden-path",
    topup_ledger_once_per_intent: "asserted_in_wp5-golden-path",
    order_debit_once: "asserted_in_wp5-golden-path",
    settlement_history_net_equals_wallet: "asserted_in_wp5-settlement-history",
    secrets_in_receipts: false,
  };

  const endedAt = new Date().toISOString();
  const receipt = {
    work_package: "WP5",
    product: "MessageGo",
    product_version: "1.0.0",
    public_api: "/v1",
    verdict,
    owner_acceptance: false,
    production_authorized: false,
    provider_traffic_authorized: false,
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
    required_scenarios: scenarioStatus,
    restore_verification: restore,
    financial_invariants: financial,
    required_skip_means: "NO-GO",
  };

  await mkdir(EVIDENCE_DIR, { recursive: true });
  const jsonText = `${JSON.stringify(receipt, null, 2)}\n`;
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
    financial,
    scenarioStatus,
  });
  await writeFile(RECEIPT_JSON, jsonText);
  await writeFile(RECEIPT_MD, md);
  await writeFile(LAUNCH_MD, md);
  await writeFile(POINTER_MD, pointerMarkdown(abrchinSha, messagegoSha, verdict));

  console.log(`\n[wp5] verdict=${verdict} pass=${totals.pass} fail=${totals.fail} skip=${totals.skip}`);
  console.log(`[wp5] abrchin=${abrchinSha}`);
  console.log(`[wp5] messagego=${messagegoSha}`);
  console.log(`[wp5] wrote ${RECEIPT_JSON}`);
  if (verdict !== "READY_FOR_OWNER_TEST") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
