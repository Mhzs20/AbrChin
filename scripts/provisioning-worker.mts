#!/usr/bin/env node
import { runProvisioningWorkerCycle } from "../lib/infrastructure/provisioning-service.ts";

const POLL_MS = Number.parseInt(process.env.WORKER_POLL_MS ?? "3000", 10);
const MAX_IDLE_ROUNDS = Number.parseInt(process.env.WORKER_MAX_IDLE_ROUNDS ?? "20", 10);

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
  console.log("[abrchin-worker] provisioning worker started");
  let idleRounds = 0;

  while (!stopping) {
    try {
      const processed = await runProvisioningWorkerCycle();
      if (processed) {
        idleRounds = 0;
      } else {
        idleRounds += 1;
        if (idleRounds >= MAX_IDLE_ROUNDS) {
          await sleep(POLL_MS);
          idleRounds = 0;
        }
      }
    } catch (error) {
      console.error("[abrchin-worker]", error instanceof Error ? error.message : "unknown");
      await sleep(POLL_MS);
    }
    await sleep(200);
  }

  console.log("[abrchin-worker] stopped");
}

void main();
