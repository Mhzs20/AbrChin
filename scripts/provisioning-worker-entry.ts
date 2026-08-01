#!/usr/bin/env node
import { InfrastructureProvider } from "@prisma/client";

import { validateProviderEnvironment } from "@/lib/env";
import { refreshProviderCatalogForPricing } from "@/lib/infrastructure/catalog-service";
import {
  settleProviderCatalogSyncTasks,
  type ProviderCatalogSyncTask,
} from "@/lib/infrastructure/catalog-sync-observability";
import { refreshMultiProviderCatalog } from "@/lib/infrastructure/multi-provider-catalog-service";
import {
  isCloudProviderConfigured,
  isProviderConfigured,
} from "@/lib/infrastructure/provider-factory";
import { runProvisioningWorkerCycle, touchWorkerHeartbeat } from "@/lib/infrastructure/provisioning-service";
import { processSubscriptionLifecycle } from "@/lib/subscriptions/service";
import { getWorkerConfig } from "@/lib/worker/config";

const config = getWorkerConfig();
validateProviderEnvironment();
const SUBSCRIPTION_LIFECYCLE_INTERVAL_MS = 60_000;
const CATALOG_SYNC_INTERVAL_MS = Math.max(
  Number.parseInt(process.env.CATALOG_SYNC_INTERVAL_MS ?? "300000", 10),
  60_000,
);

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`[abrchin-worker] provisioning worker started id=${config.workerId}`);
  let idleRounds = 0;
  let nextSubscriptionLifecycleAt = 0;
  let nextCatalogSyncAt = 0;

  while (!stopping) {
    try {
      const processed = await runProvisioningWorkerCycle();
      if (Date.now() >= nextSubscriptionLifecycleAt) {
        await processSubscriptionLifecycle();
        nextSubscriptionLifecycleAt =
          Date.now() + SUBSCRIPTION_LIFECYCLE_INTERVAL_MS;
      }
      if (Date.now() >= nextCatalogSyncAt) {
        const syncTasks: ProviderCatalogSyncTask[] = [];
        if (isCloudProviderConfigured(InfrastructureProvider.ARVAN)) {
          syncTasks.push({
            provider: InfrastructureProvider.ARVAN,
            apiVersion: "v1",
            operation: "catalog_sync",
            promise: refreshMultiProviderCatalog(
              InfrastructureProvider.ARVAN,
            ),
          });
        }
        if (isProviderConfigured()) {
          syncTasks.push({
            provider: InfrastructureProvider.PARSPACK,
            apiVersion: "v1",
            operation: "catalog_sync",
            promise: refreshProviderCatalogForPricing(),
          });
        }
        await settleProviderCatalogSyncTasks(syncTasks);
        nextCatalogSyncAt = Date.now() + CATALOG_SYNC_INTERVAL_MS;
      }
      await touchWorkerHeartbeat({ cycleOk: true });
      if (processed) {
        idleRounds = 0;
      } else {
        idleRounds += 1;
        if (idleRounds >= config.maxIdleRounds) {
          await sleep(config.pollMs);
          idleRounds = 0;
        }
      }
    } catch (error) {
      console.error("[abrchin-worker]", error instanceof Error ? error.message : "unknown");
      await touchWorkerHeartbeat({ cycleOk: false, status: "stale" });
      await sleep(config.pollMs);
    }
    await sleep(200);
  }

  console.log("[abrchin-worker] stopped");
}

void main();
