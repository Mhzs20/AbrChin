import { spawn } from "node:child_process";

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const root = process.cwd();
const databaseUrl =
  "postgresql://postgres:postgres@127.0.0.1:55434/postgres?pgbouncer=true&connection_limit=10&pool_timeout=30";
const testFiles = process.argv.slice(2);

if (testFiles.length === 0) {
  throw new Error("Pass at least one PostgreSQL test file");
}

const testEnvironment = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  ABRCHIN_ISOLATED_TEST: "1",
  SESSION_SECRET:
    process.env.SESSION_SECRET || "isolated_postgres_test_secret_2026",
  CREDENTIAL_ENCRYPTION_KEY:
    process.env.CREDENTIAL_ENCRYPTION_KEY ||
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  PAYMENT_CALLBACK_BASE_URL:
    process.env.PAYMENT_CALLBACK_BASE_URL || "http://127.0.0.1:3010",
};

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: testEnvironment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function main() {
  const database = await PGlite.create("memory://");
  const socket = new PGLiteSocketServer({
    db: database,
    host: "127.0.0.1",
    port: 55434,
    maxConnections: 40,
  });

  try {
    await socket.start();
    await run("./node_modules/.bin/prisma", ["generate"]);
    await run("./node_modules/.bin/prisma", ["migrate", "deploy"]);
    await run("node", [
      "--import",
      "./scripts/test-resolve-hook.mjs",
      "--experimental-strip-types",
      "--test",
      "--test-concurrency=1",
      ...testFiles,
    ]);
  } finally {
    await socket.stop().catch(() => undefined);
    await database.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
