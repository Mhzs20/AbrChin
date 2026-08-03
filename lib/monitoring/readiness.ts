import { prisma } from "@/lib/db";
import { getBillingCatchUpStatus } from "@/lib/billing/worker";
import { getWorkerHealthStatus } from "@/lib/infrastructure/provisioning-service";

export type ReadinessComponentStatus = "healthy" | "stale" | "down" | "unknown";
export type PlatformReadinessStatus = "operational" | "degraded" | "outage";

const DATABASE_TIMEOUT_MS = 2_500;

export function derivePlatformReadinessStatus(
  database: ReadinessComponentStatus,
  worker: ReadinessComponentStatus,
  billingCatchUp: ReadinessComponentStatus = "healthy",
): PlatformReadinessStatus {
  if (database === "down" || worker === "down") return "outage";
  if (
    database !== "healthy" ||
    worker === "stale" ||
    worker === "unknown" ||
    billingCatchUp !== "healthy"
  ) {
    return "degraded";
  }
  return "operational";
}

async function checkDatabase(): Promise<ReadinessComponentStatus> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("database_readiness_timeout")),
          DATABASE_TIMEOUT_MS,
        );
      }),
    ]);
    return "healthy";
  } catch {
    return "down";
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function getPlatformReadiness() {
  const database = await checkDatabase();
  let worker: ReadinessComponentStatus = "unknown";
  let workerLastSeenAt: string | null = null;
  let billingCatchUp: ReadinessComponentStatus = "unknown";
  let billingCatchUpStatus: Awaited<
    ReturnType<typeof getBillingCatchUpStatus>
  > | null = null;

  if (database === "healthy") {
    try {
      const [workerHealth, catchUp] = await Promise.all([
        getWorkerHealthStatus(),
        getBillingCatchUpStatus(),
      ]);
      worker = workerHealth.status;
      workerLastSeenAt = workerHealth.lastSeenAt;
      billingCatchUpStatus = catchUp;
      billingCatchUp =
        catchUp.status === "CURRENT" ? "healthy" : "stale";
    } catch {
      worker = "unknown";
    }
  }

  return {
    status: derivePlatformReadinessStatus(database, worker, billingCatchUp),
    components: {
      web: "healthy" as const,
      database,
      provisioningWorker: worker,
      billingCatchUp,
    },
    workerLastSeenAt,
    billingCatchUp: billingCatchUpStatus,
    checkedAt: new Date().toISOString(),
  };
}
