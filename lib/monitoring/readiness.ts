import { existsSync } from "node:fs";

import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { isLegalLaunchReady } from "@/lib/legal/config";
import { getBillingCatchUpStatus } from "@/lib/billing/worker";
import { getEffectiveProviderBillingContract, providerBillingContractBlockingReasons } from "@/lib/billing/provider-contract";
import { getWorkerHealthStatus } from "@/lib/infrastructure/provisioning-service";

export type ReadinessComponentStatus =
  | "healthy"
  | "stale"
  | "down"
  | "unknown"
  | "disabled";
export type PlatformReadinessStatus = "operational" | "degraded" | "outage";

const DATABASE_TIMEOUT_MS = 2_500;

function isBlocking(status: ReadinessComponentStatus): boolean {
  return status !== "healthy" && status !== "disabled";
}

export function derivePlatformReadinessStatus(
  database: ReadinessComponentStatus,
  worker: ReadinessComponentStatus,
  billingCatchUp: ReadinessComponentStatus = "healthy",
  billingContracts: ReadinessComponentStatus = "healthy",
  extras: {
    migrations?: ReadinessComponentStatus;
    messageGoS2S?: ReadinessComponentStatus;
    catalogProvider?: ReadinessComponentStatus;
  } = {},
): PlatformReadinessStatus {
  const migrations = extras.migrations ?? "healthy";
  const messageGoS2S = extras.messageGoS2S ?? "disabled";
  const catalogProvider = extras.catalogProvider ?? "disabled";
  if (database === "down" || worker === "down" || migrations === "down") {
    return "outage";
  }
  if (
    [database, worker, billingCatchUp, billingContracts, migrations, messageGoS2S, catalogProvider].some(
      isBlocking,
    )
  ) {
    return "degraded";
  }
  return "operational";
}

async function getProviderBillingContractHealth() {
  const providers = await Promise.all(
    (["ARVAN"] as const).map(async (provider) => {
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

async function checkMigrations(): Promise<ReadinessComponentStatus> {
  try {
    const rows = await prisma.$queryRaw<Array<{ pending: bigint | number }>>`
      SELECT COUNT(*)::bigint AS pending
      FROM "_prisma_migrations"
      WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL
    `;
    const pending = Number(rows[0]?.pending ?? 1);
    return pending === 0 ? "healthy" : "down";
  } catch {
    return "down";
  }
}

function messageGoS2SStatus(): ReadinessComponentStatus {
  const env = getEnv();
  const enabled =
    env.messageGoSettlementEnabled ||
    env.messageGoCustomerAiEnabled ||
    env.messageGoSecretHandoffEnabled;
  if (!enabled) return "disabled";
  if (!env.messageGoS2SKeyringFile || !env.messageGoS2SSigningKeyringFile) {
    return "down";
  }
  if (!existsSync(env.messageGoS2SKeyringFile) || !existsSync(env.messageGoS2SSigningKeyringFile)) {
    return "down";
  }
  return "healthy";
}

function catalogProviderStatus(): ReadinessComponentStatus {
  const env = getEnv();
  if (!env.arvanEnabled) return "disabled";
  if (!env.arvanApiKey) return "down";
  return "healthy";
}

export async function getPlatformReadiness() {
  const env = getEnv();
  const database = await checkDatabase();
  let worker: ReadinessComponentStatus = "unknown";
  let workerLastSeenAt: string | null = null;
  let billingCatchUp: ReadinessComponentStatus = "unknown";
  let billingContracts: ReadinessComponentStatus = env.arvanEnabled ? "unknown" : "disabled";
  let migrations: ReadinessComponentStatus = "unknown";
  let billingCatchUpStatus: Awaited<
    ReturnType<typeof getBillingCatchUpStatus>
  > | null = null;
  let billingContractStatus: Awaited<
    ReturnType<typeof getProviderBillingContractHealth>
  > | null = null;

  if (database === "healthy") {
    try {
      const [workerHealth, catchUp, providerContracts, migrationStatus] = await Promise.all([
        getWorkerHealthStatus(),
        getBillingCatchUpStatus(),
        env.arvanEnabled
          ? getProviderBillingContractHealth()
          : Promise.resolve(null),
        checkMigrations(),
      ]);
      worker = workerHealth.status;
      workerLastSeenAt = workerHealth.lastSeenAt;
      billingCatchUpStatus = catchUp;
      billingCatchUp = catchUp.status === "CURRENT" ? "healthy" : "stale";
      migrations = migrationStatus;
      if (env.arvanEnabled && providerContracts) {
        billingContractStatus = providerContracts;
        billingContracts = providerContracts.status;
      } else {
        billingContracts = "disabled";
      }
    } catch {
      worker = "unknown";
      migrations = "unknown";
    }
  } else {
    migrations = "down";
  }

  const messageGoS2S = messageGoS2SStatus();
  const catalogProvider = catalogProviderStatus();

  const status = derivePlatformReadinessStatus(
    database,
    worker,
    billingCatchUp,
    billingContracts,
    { migrations, messageGoS2S, catalogProvider },
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
      migrations,
      messageGoS2S,
      catalogProvider,
    },
    features: {
      customerAi: env.messageGoCustomerAiEnabled ? "enabled" : "disabled",
      settlement: env.messageGoSettlementEnabled ? "enabled" : "disabled",
      secretHandoff: env.messageGoSecretHandoffEnabled ? "enabled" : "disabled",
      arvanMutations: env.arvanMutationsEnabled ? "enabled" : "disabled",
      legalEntity: isLegalLaunchReady() ? "ready" : "blocked",
    },
    workerLastSeenAt,
    billingCatchUp: billingCatchUpStatus,
    billingContracts: billingContractStatus,
    checkedAt: new Date().toISOString(),
  };
}
