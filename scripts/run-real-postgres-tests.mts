import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const root = process.cwd();
const testFiles = process.argv.slice(2);
if (testFiles.length === 0) {
  throw new Error("Pass at least one PostgreSQL test file");
}

function findBin() {
  const candidates = [
    "/usr/lib/postgresql/16/bin",
    "/usr/lib/postgresql/15/bin",
    "/usr/bin",
  ];
  for (const dir of candidates) {
    const initdb = spawnSync(join(dir, "initdb"), ["--version"], { encoding: "utf8" });
    const postgres = spawnSync(join(dir, "postgres"), ["--version"], { encoding: "utf8" });
    if (initdb.status === 0 && postgres.status === 0) return dir;
  }
  return "";
}

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("port"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function waitReady(bin: string, port: number) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const ready = spawnSync(join(bin, "pg_isready"), ["-h", "127.0.0.1", "-p", String(port)], {
      encoding: "utf8",
    });
    if (ready.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("real postgres did not become ready");
}

async function main() {
  const bin = findBin();
  if (!bin) {
    console.error("REAL_POSTGRES_VALIDATION_UNAVAILABLE: initdb/postgres not found");
    process.exit(2);
  }
  const dataDir = mkdtempSync(join(tmpdir(), "abrchin-preprod-pg-"));
  const port = await freePort();
  const init = spawnSync(
    join(bin, "initdb"),
    ["-D", dataDir, "--auth=trust", `--username=${process.env.USER || "ubuntu"}`, "--encoding=UTF8", "--no-locale"],
    { encoding: "utf8" },
  );
  if (init.status !== 0) {
    console.error(init.stdout, init.stderr);
    throw new Error("initdb failed");
  }
  const logPath = join(dataDir, "postgres.log");
  writeFileSync(logPath, "");
  const postgres = spawn(
    join(bin, "postgres"),
    [
      "-D",
      dataDir,
      "-h",
      "127.0.0.1",
      "-p",
      String(port),
      "-k",
      dataDir,
      "-c",
      "listen_addresses=127.0.0.1",
      "-c",
      `unix_socket_directories=${dataDir}`,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  const url = `postgres://${process.env.USER || "ubuntu"}@127.0.0.1:${port}/postgres?sslmode=disable`;
  const env = {
    ...process.env,
    DATABASE_URL: url,
    ABRCHIN_ISOLATED_TEST: "1",
    SESSION_SECRET: process.env.SESSION_SECRET || "isolated_postgres_test_secret_2026",
    CREDENTIAL_ENCRYPTION_KEY:
      process.env.CREDENTIAL_ENCRYPTION_KEY ||
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    PAYMENT_CALLBACK_BASE_URL: process.env.PAYMENT_CALLBACK_BASE_URL || "http://127.0.0.1:3010",
  };
  try {
    await waitReady(bin, port);
    await run("./node_modules/.bin/prisma", ["migrate", "deploy"], env);
    await run("node", [
      "--import",
      "./scripts/test-resolve-hook.mjs",
      "--experimental-strip-types",
      "--test",
      "--test-concurrency=1",
      ...testFiles,
    ], env);
  } finally {
    postgres.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      postgres.kill("SIGKILL");
    } catch {
      /* already exited */
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
