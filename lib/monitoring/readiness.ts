import { prisma } from "@/lib/db";
import { getBillingCatchUpStatus } from "@/lib/billing/worker";
import { getEffectiveProviderBillingContract, providerBillingContractBlockingReasons } from "@/lib/billing/provider-contract";
import { getWorkerHealthStatus } from "@/lib/infrastructure/provisioning-service";

export type ReadinessComponentStatus = "healthy" | "stale" | "down" | "unknown";
export type PlatformReadinessStatus = "operational" | "degraded" | "outage";

const DATABASE_TIMEOUT_MS = 2_500;

export function derivePlatformReadinessStatus(
  database: ReadinessComponentStatus,
  worker: ReadinessComponentStatus,
  billingCatchUp: ReadinessComponentStatus = "healthy",
  billingContracts: ReadinessComponentStatus = "healthy",
): PlatformReadinessStatus {
  if (database === "down" || worker === "down") return "outage";
  if (
    database !== "healthy" ||
    worker === "stale" ||
    worker === "unknown" ||
    billingCatchUp !== "healthy" ||
    billingContracts !== "healthy"
  ) {
    return "degraded";
  }
  return "operational";
}

async function getProviderBillingContractHealth() {
  const providers = await Promise.all(
    (["ARVAN", "PARSPACK"] as const).map(async (provider) => {
      const contract = await getEffectiveProviderBillingContract({
        provider,
        providerApiVersion: "v1",
        productKind: "CLOUD_SERVER",
      });
      const blockingReasons = providerBillingContractBlockingReasons(contract);
      return {
        provider,
        status:
          contract?.status === "VERIFIED" && blockingReasons.length === 0
            ? ("healthy" as const)
            : ("stale" as const),
        version: contract?.version ?? null,
        source: contract?.source ?? null,
        effectiveFrom: contract?.effectiveFrom.toISOString() ?? null,
        blockingReasons,
      };
    }),
  );
  return {
    status: providers.every((provider) => provider.status === "healthy")
      ? ("healthy" as const)
      : ("stale" as const),
    providers,
  };
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
  let billingContracts: ReadinessComponentStatus = "unknown";
  let billingCatchUpStatus: Awaited<
    ReturnType<typeof getBillingCatchUpStatus>
  > | null = null;
  let billingContractStatus: Awaited<
    ReturnType<typeof getProviderBillingContractHealth>
  > | null = null;

  if (database === "healthy") {
    try {
      const [workerHealth, catchUp, providerContracts] = await Promise.all([
        getWorkerHealthStatus(),
        getBillingCatchUpStatus(),
        getProviderBillingContractHealth(),
      ]);
      worker = workerHealth.status;
      workerLastSeenAt = workerHealth.lastSeenAt;
      billingCatchUpStatus = catchUp;
      billingCatchUp =
        catchUp.status === "CURRENT" ? "healthy" : "stale";
      billingContractStatus = providerContracts;
      billingContracts = providerContracts.status;
    } catch {
      worker = "unknown";
    }
  }

  const status = derivePlatformReadinessStatus(
    database,
    worker,
    billingCatchUp,
    billingContracts,
  );
  return {
    status,
    severity:
      status === "outage" ? "critical" : status === "degraded" ? "warning" : "normal",
    components: {
      web: "healthy" as const,
      database,
      provisioningWorker: worker,
      billingCatchUp,
      billingContracts,
    },
    workerLastSeenAt,
    billingCatchUp: billingCatchUpStatus,
    billingContracts: billingContractStatus,
    checkedAt: new Date().toISOString(),
  };
}
