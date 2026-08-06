import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { withIsolatedPostgres } from "./postgres-isolation.mts";

const execFileAsync = promisify(execFile);

await withIsolatedPostgres("finance-config", async (databaseUrl) => {
  const { stdout, stderr } = await execFileAsync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "test:finance-config"],
    {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        ABRCHIN_ISOLATED_TEST: "1",
        ARVAN_ENABLED: "false",
        ARVAN_MUTATIONS_ENABLED: "false",
        PARSPACK_ENABLED: "false",
        PARSPACK_MUTATIONS_ENABLED: "false",
      },
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
});

console.log("[finance-config] isolated finance configuration suite passed");
