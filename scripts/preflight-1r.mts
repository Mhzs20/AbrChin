import { spawn } from "node:child_process";

const dummyDatabaseUrl =
  "postgresql://preflight:preflight@127.0.0.1:1/abrchin_preflight";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const harnessEnv = {
  ...process.env,
  // Preflight must never inherit a real database URL. PostgreSQL suites create
  // their own isolated Docker database and only honor an explicit
  // POSTGRES_TEST_DATABASE_URL fallback.
  DATABASE_URL: dummyDatabaseUrl,
};

async function run(label: string, args: string[]) {
  console.log(`\n[preflight:1r] ${label}`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(npm, args, {
      env: harnessEnv,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `${label} failed (${signal ? `signal ${signal}` : `exit ${code ?? "unknown"}`})`,
          ),
        );
      }
    });
  });
}

for (const [label, args] of [
  ["Prisma format check", ["exec", "--", "prisma", "format", "--check"]],
  ["Prisma validate", ["exec", "--", "prisma", "validate"]],
  ["Prisma generate", ["exec", "--", "prisma", "generate"]],
  ["Typecheck", ["run", "typecheck"]],
  ["Lint", ["run", "lint"]],
  ["Financial PostgreSQL", ["run", "test:financial-postgres"]],
  ["Readiness", ["run", "test:readiness"]],
  ["Fresh Migration", ["run", "test:fresh-migration"]],
  ["Migration Safety", ["run", "test:migration-safety"]],
  ["Upgrade Migration", ["run", "test:migration-upgrade"]],
  ["Production Build", ["run", "build"]],
  ["Worker Runtime", ["run", "test:worker-runtime"]],
  ["Secret scan", ["run", "test:secret-scan"]],
] as Array<[string, string[]]>) {
  await run(label, args);
}
