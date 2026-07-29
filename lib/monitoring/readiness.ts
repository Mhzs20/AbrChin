import { prisma } from "@/lib/db";
import { getWorkerHealthStatus } from "@/lib/infrastructure/provisioning-service";

export type ReadinessComponentStatus = "healthy" | "stale" | "down" | "unknown";
export type PlatformReadinessStatus = "operational" | "degraded" | "outage";

const DATABASE_TIMEOUT_MS = 2_500;

export function derivePlatformReadinessStatus(
  database: ReadinessComponentStatus,
  worker: ReadinessComponentStatus,
): PlatformReadinessStatus {
  if (database === "down") return "outage";
  if (database !== "healthy" || worker === "stale" || worker === "unknown") {
    return "degraded";
  }
  if (worker === "down") return "outage";
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

  if (database === "healthy") {
    try {
      const workerHealth = await getWorkerHealthStatus();
      worker = workerHealth.status;
      workerLastSeenAt = workerHealth.lastSeenAt;
    } catch {
      worker = "unknown";
    }
  }

  return {
    status: derivePlatformReadinessStatus(database, worker),
    components: {
      web: "healthy" as const,
      database,
      provisioningWorker: worker,
    },
    workerLastSeenAt,
    checkedAt: new Date().toISOString(),
  };
}
