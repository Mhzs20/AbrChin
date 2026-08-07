import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile() {
  const envPath = resolve(process.cwd(), ".env");
  try {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // Optional in CI; DATABASE_URL may already be present.
  }
}

loadEnvFile();

const dryRun = process.argv.includes("--dry-run");

const { runAccountingBackfill } = await import("../lib/accounting/backfill.ts");

const counts = await runAccountingBackfill({ dryRun });

console.log(
  JSON.stringify(
    {
      ok: counts.errors.length === 0,
      dryRun: counts.dryRun,
      recordsScanned: counts.recordsScanned,
      entriesToCreate: counts.entriesToCreate,
      alreadyPosted: counts.alreadyPosted,
      needsReconciliation: counts.needsReconciliation,
      walletTopUps: counts.walletTopUps,
      walletTopUpRefunds: counts.walletTopUpRefunds,
      servicePurchases: counts.servicePurchases,
      serviceRefunds: counts.serviceRefunds,
      renewals: counts.renewals,
      expenses: counts.expenses,
      errorCount: counts.errors.length,
      errors: counts.errors.slice(0, 20),
    },
    null,
    2,
  ),
);

if (counts.errors.length > 0) {
  process.exitCode = 1;
}
