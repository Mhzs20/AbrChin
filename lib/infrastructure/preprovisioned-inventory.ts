import {
  InfrastructureProvider,
  PreprovisionedHealthStatus,
  PreprovisionedInventoryStatus,
  type Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import type {
  CloudProviderAdapter,
  ProviderResource,
} from "@/lib/infrastructure/cloud-provider-adapter";
import { createCloudProviderAdapter } from "@/lib/infrastructure/provider-factory";
import {
  tcpConnectivityProbe,
  type ConnectivityProbe,
} from "@/lib/infrastructure/health-check-service";
import { WalletError } from "@/lib/wallet/errors";

export const PREPROVISIONED_OBSERVATION_MAX_AGE_MS = 5 * 60 * 1000;
export const PREPROVISIONED_HEALTH_MAX_AGE_MS = 5 * 60 * 1000;

type LockedInventoryRow = {
  id: string;
  catalogItemId: string;
  planId: string;
  provider: InfrastructureProvider;
  apiVersion: string;
  providerResourceId: string;
  regionCode: string;
  externalPlanId: string;
  externalImageId: string;
  observedState: string;
  observedIpv4: string | null;
  observedNetworkId: string | null;
  observedSecurityId: string | null;
  lastObservedAt: Date;
  lastHealthCheckedAt: Date | null;
  healthStatus: PreprovisionedHealthStatus;
  inventoryStatus: PreprovisionedInventoryStatus;
  reservedByQuoteId: string | null;
  reservedByOrderId: string | null;
  reservedRevision: number | null;
  reservationExpiresAt: Date | null;
  assignedOrderId: string | null;
};

function freshAfter(now: Date, maxAgeMs: number) {
  return new Date(now.getTime() - maxAgeMs);
}

export function isPreprovisionedInventoryFresh(
  item: Pick<
    LockedInventoryRow,
    | "observedState"
    | "observedIpv4"
    | "lastObservedAt"
    | "lastHealthCheckedAt"
    | "healthStatus"
  >,
  now = new Date(),
) {
  return (
    item.healthStatus === PreprovisionedHealthStatus.HEALTHY &&
    item.observedState.toLowerCase() === "active" &&
    Boolean(item.observedIpv4) &&
    item.lastObservedAt.getTime() >=
      now.getTime() - PREPROVISIONED_OBSERVATION_MAX_AGE_MS &&
    item.lastHealthCheckedAt != null &&
    item.lastHealthCheckedAt.getTime() >=
      now.getTime() - PREPROVISIONED_HEALTH_MAX_AGE_MS
  );
}

export async function releaseExpiredInventoryReservationsTx(
  tx: Prisma.TransactionClient,
  now = new Date(),
) {
  const expired = await tx.preprovisionedInventoryItem.findMany({
    where: {
      inventoryStatus: PreprovisionedInventoryStatus.RESERVED,
      assignedOrderId: null,
      reservationExpiresAt: { lte: now },
    },
    select: { id: true },
  });
  let released = 0;
  for (const candidate of expired) {
    const rows = await tx.$queryRaw<LockedInventoryRow[]>`
      SELECT * FROM "PreprovisionedInventoryItem"
      WHERE "id" = ${candidate.id}
      FOR UPDATE SKIP LOCKED
    `;
    const item = rows[0];
    if (
      !item ||
      item.inventoryStatus !== PreprovisionedInventoryStatus.RESERVED ||
      item.assignedOrderId != null ||
      !item.reservationExpiresAt ||
      item.reservationExpiresAt.getTime() > now.getTime()
    ) {
      continue;
    }
    const result = await tx.preprovisionedInventoryItem.updateMany({
      where: {
        id: item.id,
        inventoryStatus: PreprovisionedInventoryStatus.RESERVED,
        assignedOrderId: null,
        reservationExpiresAt: { lte: now },
      },
      data: {
        inventoryStatus: isPreprovisionedInventoryFresh(item, now)
          ? PreprovisionedInventoryStatus.AVAILABLE
          : PreprovisionedInventoryStatus.STALE,
        reservedByQuoteId: null,
        reservedByOrderId: null,
        reservedRevision: null,
        reservedAt: null,
        reservationExpiresAt: null,
      },
    });
    released += result.count;
  }
  return released;
}

export async function releaseExpiredInventoryReservations(now = new Date()) {
  return prisma.$transaction((tx) =>
    releaseExpiredInventoryReservationsTx(tx, now),
  );
}

export async function lockAvailableInventoryTx(
  tx: Prisma.TransactionClient,
  input: {
    planId: string;
    catalogItemId: string;
    externalImageId: string;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  await releaseExpiredInventoryReservationsTx(tx, now);
  const candidates = await tx.preprovisionedInventoryItem.findMany({
    where: {
      planId: input.planId,
      catalogItemId: input.catalogItemId,
      externalImageId: input.externalImageId,
      inventoryStatus: PreprovisionedInventoryStatus.AVAILABLE,
      healthStatus: PreprovisionedHealthStatus.HEALTHY,
      observedState: { equals: "active", mode: "insensitive" },
      observedIpv4: { not: null },
      lastObservedAt: {
        gte: freshAfter(now, PREPROVISIONED_OBSERVATION_MAX_AGE_MS),
      },
      lastHealthCheckedAt: {
        gte: freshAfter(now, PREPROVISIONED_HEALTH_MAX_AGE_MS),
      },
      assignedOrderId: null,
      reservedByQuoteId: null,
    },
    orderBy: [{ lastHealthCheckedAt: "desc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  for (const candidate of candidates) {
    const rows = await tx.$queryRaw<LockedInventoryRow[]>`
      SELECT * FROM "PreprovisionedInventoryItem"
      WHERE "id" = ${candidate.id}
      FOR UPDATE SKIP LOCKED
    `;
    const item = rows[0];
    if (
      item &&
      item.planId === input.planId &&
      item.catalogItemId === input.catalogItemId &&
      item.externalImageId === input.externalImageId &&
      item.inventoryStatus === PreprovisionedInventoryStatus.AVAILABLE &&
      item.assignedOrderId == null &&
      item.reservedByQuoteId == null &&
      isPreprovisionedInventoryFresh(item, now)
    ) {
      return item;
    }
  }
  throw new WalletError(
    "inventory_unavailable",
    "در حال حاضر سرور آمادهٔ سالم و تأییدشده‌ای برای این انتخاب موجود نیست.",
  );
}

export async function reserveLockedInventoryForQuoteTx(
  tx: Prisma.TransactionClient,
  input: {
    inventoryItemId: string;
    quoteId: string;
    revision: number;
    expiresAt: Date;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const reserved = await tx.preprovisionedInventoryItem.updateMany({
    where: {
      id: input.inventoryItemId,
      inventoryStatus: PreprovisionedInventoryStatus.AVAILABLE,
      healthStatus: PreprovisionedHealthStatus.HEALTHY,
      assignedOrderId: null,
      reservedByQuoteId: null,
    },
    data: {
      inventoryStatus: PreprovisionedInventoryStatus.RESERVED,
      reservedByQuoteId: input.quoteId,
      reservedRevision: input.revision,
      reservedAt: now,
      reservationExpiresAt: input.expiresAt,
    },
  });
  if (reserved.count !== 1) {
    throw new WalletError(
      "inventory_reservation_conflict",
      "این سرور هم‌زمان رزرو شد؛ گزینهٔ دیگری را انتخاب کنید.",
    );
  }
}

export async function bindInventoryReservationToOrderTx(
  tx: Prisma.TransactionClient,
  input: {
    inventoryItemId: string;
    quoteId: string;
    orderId: string;
    revision: number;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const rows = await tx.$queryRaw<LockedInventoryRow[]>`
    SELECT * FROM "PreprovisionedInventoryItem"
    WHERE "id" = ${input.inventoryItemId}
    FOR UPDATE
  `;
  const item = rows[0];
  if (
    !item ||
    item.inventoryStatus !== PreprovisionedInventoryStatus.RESERVED ||
    item.reservedByQuoteId !== input.quoteId ||
    item.assignedOrderId != null ||
    !item.reservationExpiresAt ||
    item.reservationExpiresAt.getTime() <= now.getTime() ||
    !isPreprovisionedInventoryFresh(item, now)
  ) {
    throw new WalletError(
      "inventory_reservation_expired",
      "رزرو سرور آماده منقضی یا نامعتبر شده است؛ Quote تازه بسازید.",
    );
  }
  await tx.preprovisionedInventoryItem.update({
    where: { id: item.id },
    data: {
      reservedByOrderId: input.orderId,
      reservedRevision: input.revision,
    },
  });
  return item;
}

export async function lockReservedInventoryForPaymentTx(
  tx: Prisma.TransactionClient,
  input: {
    inventoryItemId: string;
    quoteId: string;
    orderId: string;
    revision: number;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const rows = await tx.$queryRaw<LockedInventoryRow[]>`
    SELECT * FROM "PreprovisionedInventoryItem"
    WHERE "id" = ${input.inventoryItemId}
    FOR UPDATE
  `;
  const item = rows[0];
  const alreadyAssignedToSameOrder =
    item?.inventoryStatus === PreprovisionedInventoryStatus.ASSIGNED &&
    item.assignedOrderId === input.orderId &&
    item.reservedByQuoteId === input.quoteId &&
    item.reservedByOrderId === input.orderId &&
    item.reservedRevision === input.revision;
  if (alreadyAssignedToSameOrder) {
    // A concurrent/replayed payment can observe the assignment committed by the
    // first transaction. The payment ledger remains the idempotency authority;
    // returning the same locked row lets the caller replay without assigning or
    // debiting a second time.
    return item;
  }
  if (
    !item ||
    item.inventoryStatus !== PreprovisionedInventoryStatus.RESERVED ||
    item.reservedByQuoteId !== input.quoteId ||
    item.reservedByOrderId !== input.orderId ||
    item.reservedRevision !== input.revision ||
    item.assignedOrderId != null ||
    !item.reservationExpiresAt ||
    item.reservationExpiresAt.getTime() <= now.getTime() ||
    !isPreprovisionedInventoryFresh(item, now)
  ) {
    throw new WalletError(
      "inventory_unavailable",
      "سرور آمادهٔ رزروشده دیگر سالم یا قابل تخصیص نیست؛ مبلغی برداشت نشد.",
    );
  }
  return item;
}

export async function assignReservedInventoryTx(
  tx: Prisma.TransactionClient,
  input: {
    inventoryItemId: string;
    quoteId: string;
    orderId: string;
    assignedAt?: Date;
  },
) {
  const assignedAt = input.assignedAt ?? new Date();
  const assigned = await tx.preprovisionedInventoryItem.updateMany({
    where: {
      id: input.inventoryItemId,
      inventoryStatus: PreprovisionedInventoryStatus.RESERVED,
      reservedByQuoteId: input.quoteId,
      reservedByOrderId: input.orderId,
      assignedOrderId: null,
    },
    data: {
      inventoryStatus: PreprovisionedInventoryStatus.ASSIGNED,
      assignedOrderId: input.orderId,
      assignedAt,
      reservationExpiresAt: null,
    },
  });
  if (assigned.count !== 1) {
    throw new WalletError(
      "inventory_assignment_conflict",
      "تخصیص سرور آماده هم‌زمان تغییر کرد؛ تراکنش پرداخت لغو شد.",
    );
  }
}

export async function releaseInventoryReservationForOrder(
  orderId: string,
  reason: string,
) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<LockedInventoryRow[]>`
      SELECT * FROM "PreprovisionedInventoryItem"
      WHERE "reservedByOrderId" = ${orderId}
      FOR UPDATE
    `;
    const item = rows[0];
    if (
      !item ||
      item.inventoryStatus !== PreprovisionedInventoryStatus.RESERVED ||
      item.assignedOrderId != null
    ) {
      return false;
    }
    const now = new Date();
    await tx.preprovisionedInventoryItem.update({
      where: { id: item.id },
      data: {
        inventoryStatus: isPreprovisionedInventoryFresh(item, now)
          ? PreprovisionedInventoryStatus.AVAILABLE
          : PreprovisionedInventoryStatus.STALE,
        reservedByQuoteId: null,
        reservedByOrderId: null,
        reservedRevision: null,
        reservedAt: null,
        reservationExpiresAt: null,
        adminAudit: {
          event: "reservation_released",
          reason: reason.slice(0, 120),
          containsSecret: false,
          at: now.toISOString(),
        },
      },
    });
    return true;
  });
}

export async function countAvailableInventoryByPlan(planIds: string[]) {
  if (planIds.length === 0) return new Map<string, number>();
  const now = new Date();
  const rows = await prisma.preprovisionedInventoryItem.groupBy({
    by: ["planId"],
    where: {
      planId: { in: planIds },
      inventoryStatus: PreprovisionedInventoryStatus.AVAILABLE,
      healthStatus: PreprovisionedHealthStatus.HEALTHY,
      observedState: { equals: "active", mode: "insensitive" },
      observedIpv4: { not: null },
      lastObservedAt: {
        gte: freshAfter(now, PREPROVISIONED_OBSERVATION_MAX_AGE_MS),
      },
      lastHealthCheckedAt: {
        gte: freshAfter(now, PREPROVISIONED_HEALTH_MAX_AGE_MS),
      },
      assignedOrderId: null,
      reservedByQuoteId: null,
    },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.planId, row._count._all]));
}

export async function findFreshAvailableInventory(input: {
  planId: string;
  catalogItemId: string;
  externalImageId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return prisma.preprovisionedInventoryItem.findFirst({
    where: {
      planId: input.planId,
      catalogItemId: input.catalogItemId,
      externalImageId: input.externalImageId,
      inventoryStatus: PreprovisionedInventoryStatus.AVAILABLE,
      healthStatus: PreprovisionedHealthStatus.HEALTHY,
      observedState: { equals: "active", mode: "insensitive" },
      observedIpv4: { not: null },
      observedNetworkId: { not: null },
      observedSecurityId: { not: null },
      lastObservedAt: {
        gte: freshAfter(now, PREPROVISIONED_OBSERVATION_MAX_AGE_MS),
      },
      lastHealthCheckedAt: {
        gte: freshAfter(now, PREPROVISIONED_HEALTH_MAX_AGE_MS),
      },
      assignedOrderId: null,
      reservedByQuoteId: null,
    },
    orderBy: [{ lastHealthCheckedAt: "desc" }, { createdAt: "asc" }],
  });
}

function providerPlanId(resource: ProviderResource) {
  return resource.externalPlanId?.trim() || null;
}

function providerImageId(resource: ProviderResource) {
  return resource.externalImageId?.trim() || null;
}

export async function observeAndRegisterPreprovisionedInventory(input: {
  planId: string;
  providerResourceId: string;
  actorUserId: string;
  reason: string;
  adapterOverride?: CloudProviderAdapter;
  probe?: ConnectivityProbe;
}) {
  const plan = await prisma.infrastructurePlan.findUnique({
    where: { id: input.planId },
    include: { catalogItem: true },
  });
  if (
    !plan?.catalogItem ||
    plan.provider !== InfrastructureProvider.ARVAN ||
    plan.providerApiVersion !== "v1" ||
    plan.productKind !== "CLOUD_SERVER" ||
    plan.offerSource !== "PREPROVISIONED_INVENTORY"
  ) {
    throw new WalletError(
      "invalid_inventory_plan",
      "پلن موجودی واقعی معتبر نیست.",
    );
  }
  const catalogItem = plan.catalogItem;
  const adapter =
    input.adapterOverride ??
    createCloudProviderAdapter(plan.provider, plan.providerApiVersion);
  const resource = await adapter.findExistingResource({
    region: plan.regionCode,
    orderPublicId: `inventory-${plan.id}`,
    expectedName: "",
    providerResourceId: input.providerResourceId,
  });
  if (!resource) {
    throw new WalletError(
      "inventory_resource_not_found",
      "Resource از Provider مشاهده نشد.",
    );
  }
  if (
    resource.region !== plan.regionCode ||
    providerPlanId(resource) !==
      (catalogItem.externalPlanId ?? plan.sizeCode) ||
    providerImageId(resource) !== plan.imageCode
  ) {
    throw new WalletError(
      "inventory_resource_mismatch",
      "Region، Plan یا Image مشاهده‌شده با پلن Admin یکسان نیست.",
    );
  }
  const observedNetworkId = resource.networkIds?.[0] ?? null;
  const observedSecurityId = resource.securityIds?.[0] ?? null;
  const observable =
    resource.state.toLowerCase() === "active" &&
    Boolean(resource.ipv4) &&
    Boolean(observedNetworkId) &&
    Boolean(observedSecurityId);
  const probe = input.probe ?? tcpConnectivityProbe;
  const reachable = observable
    ? await probe({
        host: resource.ipv4!,
        port: /windows/i.test(resource.externalImageId ?? plan.imageCode)
          ? 3389
          : 22,
        timeoutMs: 3_000,
        attempt: 1,
      })
    : false;
  const now = new Date();
  const healthStatus = reachable
    ? PreprovisionedHealthStatus.HEALTHY
    : PreprovisionedHealthStatus.UNHEALTHY;
  const inventoryStatus = reachable
    ? PreprovisionedInventoryStatus.AVAILABLE
    : PreprovisionedInventoryStatus.UNHEALTHY;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.preprovisionedInventoryItem.findUnique({
      where: {
        provider_apiVersion_providerResourceId: {
          provider: plan.provider,
          apiVersion: plan.providerApiVersion,
          providerResourceId: resource.id,
        },
      },
    });
    if (
      existing &&
      (existing.assignedOrderId ||
        existing.inventoryStatus === PreprovisionedInventoryStatus.DELIVERED)
    ) {
      throw new WalletError(
        "inventory_already_assigned",
        "Resource قبلاً به سفارش دیگری اختصاص یافته است.",
      );
    }
    return tx.preprovisionedInventoryItem.upsert({
      where: {
        provider_apiVersion_providerResourceId: {
          provider: plan.provider,
          apiVersion: plan.providerApiVersion,
          providerResourceId: resource.id,
        },
      },
      update: {
        catalogItemId: catalogItem.id,
        planId: plan.id,
        regionCode: resource.region,
        externalPlanId: providerPlanId(resource)!,
        externalImageId: providerImageId(resource)!,
        observedState: resource.state,
        observedIpv4: resource.ipv4,
        observedNetworkId,
        observedSecurityId,
        lastObservedAt: resource.observedAt,
        lastHealthCheckedAt: now,
        healthStatus,
        inventoryStatus,
        adminAudit: {
          event: "provider_get_observation",
          actorUserId: input.actorUserId,
          reason: input.reason.slice(0, 240),
          containsSecret: false,
          at: now.toISOString(),
        },
        updatedById: input.actorUserId,
      },
      create: {
        catalogItemId: catalogItem.id,
        planId: plan.id,
        provider: plan.provider,
        apiVersion: plan.providerApiVersion,
        providerResourceId: resource.id,
        regionCode: resource.region,
        externalPlanId: providerPlanId(resource)!,
        externalImageId: providerImageId(resource)!,
        observedState: resource.state,
        observedIpv4: resource.ipv4,
        observedNetworkId,
        observedSecurityId,
        lastObservedAt: resource.observedAt,
        lastHealthCheckedAt: now,
        healthStatus,
        inventoryStatus,
        adminAudit: {
          event: "provider_get_observation",
          actorUserId: input.actorUserId,
          reason: input.reason.slice(0, 240),
          containsSecret: false,
          at: now.toISOString(),
        },
        createdById: input.actorUserId,
        updatedById: input.actorUserId,
      },
    });
  });
}
