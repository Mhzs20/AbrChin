#!/usr/bin/env node
import { runProvisioningWorkerCycle, touchWorkerHeartbeat } from "@/lib/infrastructure/provisioning-service";
import { getWorkerConfig } from "@/lib/worker/config";

const config = getWorkerConfig();

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

  while (!stopping) {
    try {
      const processed = await runProvisioningWorkerCycle();
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
