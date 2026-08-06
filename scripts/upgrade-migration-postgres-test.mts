import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { withTemporaryPostgres } from "./postgres-isolation.mts";

const execFileAsync = promisify(execFile);

await withTemporaryPostgres("upgrade", async (databaseUrl) => {
  const controlledEnvironment = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    POSTGRES_TEST_DATABASE_URL: databaseUrl,
    ABRCHIN_ISOLATED_TEST: "1",
    ARVAN_ENABLED: "false",
    ARVAN_MUTATIONS_ENABLED: "false",
    ARVAN_PUBLIC_SALE_ENABLED: "false",
    ARVAN_CLOUD_PUBLIC_SALE_ENABLED: "false",
    PARSPACK_ENABLED: "false",
    PARSPACK_MUTATIONS_ENABLED: "false",
    PARSPACK_PUBLIC_SALE_ENABLED: "false",
    // Alert recipients must be fixture-controlled; a host ADMIN_MOBILES
    // secret would add an extra SMS outbox row and break dedup counts.
    ADMIN_MOBILES: "",
  };
  const { stdout, stderr } = await execFileAsync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "test:postgres"],
    {
      env: controlledEnvironment,
      maxBuffer: 30 * 1024 * 1024,
    },
  );
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
});

console.log("[upgrade-migration] isolated upgrade migration passed");
