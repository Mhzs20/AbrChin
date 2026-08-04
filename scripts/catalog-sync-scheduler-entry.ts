#!/usr/bin/env node
import { InfrastructureProvider } from "@prisma/client";

import {
  safeProviderSyncCode,
  settleProviderCatalogSyncTasks,
  type ProviderCatalogSyncTask,
} from "@/lib/infrastructure/catalog-sync-observability";
import { refreshMultiProviderCatalog } from "@/lib/infrastructure/multi-provider-catalog-service";
import { isCloudProviderConfigured } from "@/lib/infrastructure/provider-factory";
import { processOperationalAlertOutbox } from "@/lib/operations/alert-worker";
import { checkStorefrontLowStockAlerts } from "@/lib/storefront/low-stock-alerts";

const intervalMs = Math.max(
  Number.parseInt(process.env.CATALOG_SYNC_INTERVAL_MS ?? "300000", 10) ||
    300_000,
  60_000,
);
let stopping = false;

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCycle() {
  const tasks: ProviderCatalogSyncTask[] = [
    InfrastructureProvider.PARSPACK,
    InfrastructureProvider.ARVAN,
  ].flatMap((provider) =>
    isCloudProviderConfigured(provider)
      ? [
          {
            provider,
            apiVersion: "v1",
            operation: "catalog_sync" as const,
            promise: refreshMultiProviderCatalog(provider),
          },
        ]
      : [],
  );
  await settleProviderCatalogSyncTasks(tasks, undefined, {
    persistIncidents: true,
  });
  await checkStorefrontLowStockAlerts().catch((error) => {
    console.error(
      JSON.stringify({
        event: "storefront_low_stock_check_failed",
        readOnly: true,
        safeErrorCode: safeProviderSyncCode(error),
      }),
    );
  });
  await processOperationalAlertOutbox(20).catch((error) => {
    console.error(
      JSON.stringify({
        event: "storefront_alert_outbox_failed",
        readOnly: true,
        safeErrorCode: safeProviderSyncCode(error),
      }),
    );
  });
}

async function main() {
  console.log(
    JSON.stringify({
      event: "catalog_sync_scheduler_started",
      readOnly: true,
      intervalMs,
    }),
  );
  while (!stopping) {
    const startedAt = Date.now();
    await runCycle().catch((error) => {
      console.error(
        JSON.stringify({
          event: "catalog_sync_scheduler_cycle_failed",
          readOnly: true,
          safeErrorCode: safeProviderSyncCode(error),
        }),
      );
    });
    const remaining = Math.max(intervalMs - (Date.now() - startedAt), 1_000);
    for (let waited = 0; waited < remaining && !stopping; waited += 1_000) {
      await sleep(Math.min(1_000, remaining - waited));
    }
  }
  console.log(
    JSON.stringify({
      event: "catalog_sync_scheduler_stopped",
      readOnly: true,
    }),
  );
}

void main();
