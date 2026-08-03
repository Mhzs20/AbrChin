import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { withIsolatedPostgres } from "./postgres-isolation.mts";

const execFileAsync = promisify(execFile);
const commands = [
  "test:wallet-recovery",
  "test:billing-worker",
  "test:billing-runtime-safety",
  "test:billing-admin",
  "test:wallet-activation",
  "test:delivery-credential",
  "test:admin-operations",
];

for (const command of commands) {
  await withIsolatedPostgres(
    `financial-${command.replace(/[^a-z0-9]/gi, "-")}`,
    async (databaseUrl) => {
      const controlledEnvironment = {
        ...process.env,
        DATABASE_URL: databaseUrl,
        ABRCHIN_ISOLATED_TEST: "1",
        ARVAN_ENABLED: "false",
        ARVAN_MUTATIONS_ENABLED: "false",
        ARVAN_PUBLIC_SALE_ENABLED: "false",
        ARVAN_CLOUD_PUBLIC_SALE_ENABLED: "false",
        PARSPACK_ENABLED: "false",
        PARSPACK_MUTATIONS_ENABLED: "false",
        PARSPACK_PUBLIC_SALE_ENABLED: "false",
      };
    console.log(`[financial-postgres] ${command}`);
    const { stdout, stderr } = await execFileAsync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["run", command],
      {
        env: controlledEnvironment,
        maxBuffer: 20 * 1024 * 1024,
      },
    );
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    },
  );
}

console.log("[financial-postgres] isolated financial PostgreSQL suite passed");
