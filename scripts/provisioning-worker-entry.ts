#!/usr/bin/env node
import { validateProviderEnvironment } from "@/lib/env";
import { runProvisioningWorkerCycle, touchWorkerHeartbeat } from "@/lib/infrastructure/provisioning-service";
import { processSubscriptionLifecycle } from "@/lib/subscriptions/service";
import { getWorkerConfig } from "@/lib/worker/config";
import { processOperationalAlertOutbox } from "@/lib/operations/alert-worker";
import {
  BillingCatchUpFailure,
  requireSuccessfulBillingCatchUp,
  settleClosedBillingPeriodsCatchUp,
} from "@/lib/billing/worker";
import { enqueueExpiredDunningForSuspensionReview } from "@/lib/billing/dunning";
import { purgeExpiredS2SReplayNonces } from "@/lib/messagego/s2s/replay";

const config = getWorkerConfig();
validateProviderEnvironment();
const SUBSCRIPTION_LIFECYCLE_INTERVAL_MS = 60_000;
const BILLING_WORKER_INTERVAL_MS = Math.max(
  Number.parseInt(
    process.env.BILLING_WORKER_INTERVAL_MS ?? "60000",
    10,
  ),
  60_000,
);
const BILLING_CATCH_UP_MAX_PERIODS = Math.min(
  Math.max(
    Number.parseInt(process.env.BILLING_CATCH_UP_MAX_PERIODS ?? "24", 10) ||
      24,
    1,
  ),
  500,
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
  try {
    await touchWorkerHeartbeat({ cycleOk: false, status: "stale" });
    console.log(`[abrchin-worker] initial heartbeat recorded id=${config.workerId}`);
  } catch (error) {
    console.error(
      "[abrchin-worker] initial heartbeat failed",
      error instanceof Error ? error.message : "unknown",
    );
    throw error;
  }
  let idleRounds = 0;
  let nextSubscriptionLifecycleAt = 0;
  let nextBillingAt = 0;

  while (!stopping) {
    try {
      const processed = await runProvisioningWorkerCycle();
      const alertsProcessed = await processOperationalAlertOutbox();
      if (Date.now() >= nextSubscriptionLifecycleAt) {
        await processSubscriptionLifecycle();
        nextSubscriptionLifecycleAt =
          Date.now() + SUBSCRIPTION_LIFECYCLE_INTERVAL_MS;
      }
      if (Date.now() >= nextBillingAt) {
        const billingNow = new Date();
        const hourlyCatchUp = await settleClosedBillingPeriodsCatchUp({
          cadence: "HOURLY",
          workerId: config.workerId,
          now: billingNow,
          maxPeriods: BILLING_CATCH_UP_MAX_PERIODS,
        });
        requireSuccessfulBillingCatchUp(hourlyCatchUp);
        const dailyCatchUp = await settleClosedBillingPeriodsCatchUp({
          cadence: "DAILY",
          workerId: config.workerId,
          now: billingNow,
          maxPeriods: BILLING_CATCH_UP_MAX_PERIODS,
        });
        requireSuccessfulBillingCatchUp(dailyCatchUp);
        await enqueueExpiredDunningForSuspensionReview(billingNow);
        nextBillingAt = Date.now() + BILLING_WORKER_INTERVAL_MS;
      }
      await purgeExpiredS2SReplayNonces();
      await touchWorkerHeartbeat({ cycleOk: true });
      if (processed || alertsProcessed > 0) {
        idleRounds = 0;
      } else {
        idleRounds += 1;
        if (idleRounds >= config.maxIdleRounds) {
          await sleep(config.pollMs);
          idleRounds = 0;
        }
      }
    } catch (error) {
      if (error instanceof BillingCatchUpFailure) {
        console.error(
          JSON.stringify({
            event: "billing_catch_up_failed",
            workerId: config.workerId,
            cadence: error.cadence,
            periodStart: error.failedPeriod.periodStart,
            periodEnd: error.failedPeriod.periodEnd,
            billingRunId: error.failedPeriod.billingRunId,
            failureCode: error.failedPeriod.failureCode,
            retryStatus: "pending_next_billing_cycle",
          }),
        );
      } else {
        console.error("[abrchin-worker]", error instanceof Error ? error.message : "unknown");
      }
      await touchWorkerHeartbeat({ cycleOk: false, status: "stale" });
      await sleep(config.pollMs);
    }
    await sleep(200);
  }

  console.log("[abrchin-worker] stopped");
}

void main();
