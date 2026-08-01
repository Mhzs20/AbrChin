import {
  InfrastructureProvider,
  PreprovisionedHealthStatus,
  PreprovisionedInventoryCredentialStatus,
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
import {
  credentialFingerprint,
  encryptCredential,
} from "@/lib/security/credential-vault";

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

type LockedInventoryCredentialRow = {
  id: string;
  inventoryItemId: string;
  username: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  secretFingerprint: string;
  status: PreprovisionedInventoryCredentialStatus;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  transferredAt: Date | null;
};

type InventoryExpectedSelection = {
  planId: string;
  catalogItemId: string;
  provider: InfrastructureProvider;
  apiVersion: string;
  regionCode: string;
  externalPlanId: string;
  externalImageId: string;
  externalNetworkId: string;
  externalSecurityId: string;
};

type InventoryEligibilityStage =
  | { kind: "AVAILABLE" }
  | { kind: "RESERVED_QUOTE"; quoteId: string }
  | {
      kind: "RESERVED_ORDER";
      quoteId: string;
      orderId: string;
      revision: number;
    }
  | { kind: "ASSIGNED"; orderId: string };

function freshAfter(now: Date, maxAgeMs: number) {
  return new Date(now.getTime() - maxAgeMs);
}
export function isPreprovisionedInventoryFresh(
  item: Pick<
    LockedInventoryRow,
    | "observedState"
    | "observedIpv4"
    | "observedNetworkId"
    | "observedSecurityId"
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
    Boolean(item.observedNetworkId) &&
    Boolean(item.observedSecurityId) &&
    item.lastObservedAt.getTime() >=
      now.getTime() - PREPROVISIONED_OBSERVATION_MAX_AGE_MS &&
    item.lastHealthCheckedAt != null &&
    item.lastHealthCheckedAt.getTime() >=
      now.getTime() - PREPROVISIONED_HEALTH_MAX_AGE_MS
  );
}

export function assessPreprovisionedInventoryEligibility(input: {
  item: LockedInventoryRow;
  credential: LockedInventoryCredentialRow | null;
  expected: InventoryExpectedSelection;
  stage: InventoryEligibilityStage;
  now?: Date;
}) {
  const { item, credential, expected, stage } = input;
  const now = input.now ?? new Date();
  const mappingMatches =
    item.planId === expected.planId &&
    item.catalogItemId === expected.catalogItemId &&
    item.provider === expected.provider &&
    item.apiVersion === expected.apiVersion &&
    item.regionCode === expected.regionCode &&
    item.externalPlanId === expected.externalPlanId &&
    item.externalImageId === expected.externalImageId &&
    item.observedNetworkId === expected.externalNetworkId &&
    item.observedSecurityId === expected.externalSecurityId;
  if (!mappingMatches) {
    return { eligible: false as const, reason: "inventory_mapping_mismatch" };
  }
  if (!isPreprovisionedInventoryFresh(item, now)) {
    return { eligible: false as const, reason: "inventory_not_fresh" };
  }

  if (stage.kind === "ASSIGNED") {
    const eligible =
      item.inventoryStatus === PreprovisionedInventoryStatus.ASSIGNED &&
      item.assignedOrderId === stage.orderId &&
      credential?.status ===
        PreprovisionedInventoryCredentialStatus.TRANSFERRED;
    return {
      eligible,
      reason: eligible ? "eligible" : "inventory_assignment_mismatch",
    } as const;
  }

  if (
    !credential ||
    credential.status !== PreprovisionedInventoryCredentialStatus.READY ||
    !credential.ciphertext ||
    !credential.iv ||
    !credential.authTag
  ) {
    return { eligible: false as const, reason: "inventory_credential_not_ready" };
  }

  if (stage.kind === "AVAILABLE") {
    const eligible =
      item.inventoryStatus === PreprovisionedInventoryStatus.AVAILABLE &&
      item.assignedOrderId == null &&
      item.reservedByQuoteId == null &&
      item.reservedByOrderId == null;
    return {
      eligible,
      reason: eligible ? "eligible" : "inventory_not_available",
    } as const;
  }
  if (stage.kind === "RESERVED_QUOTE") {
    const eligible =
      item.inventoryStatus === PreprovisionedInventoryStatus.RESERVED &&
      item.reservedByQuoteId === stage.quoteId &&
      item.reservedByOrderId == null &&
      item.assignedOrderId == null &&
      item.reservationExpiresAt != null &&
      item.reservationExpiresAt.getTime() > now.getTime();
    return {
      eligible,
      reason: eligible ? "eligible" : "inventory_quote_reservation_invalid",
    } as const;
  }
  const eligible =
    item.inventoryStatus === PreprovisionedInventoryStatus.RESERVED &&
    item.reservedByQuoteId === stage.quoteId &&
    item.reservedByOrderId === stage.orderId &&
    item.reservedRevision === stage.revision &&
    item.assignedOrderId == null &&
    item.reservationExpiresAt != null &&
    item.reservationExpiresAt.getTime() > now.getTime();
  return {
    eligible,
    reason: eligible ? "eligible" : "inventory_order_reservation_invalid",
  } as const;
}

async function lockInventoryAndCredentialTx(
  tx: Prisma.TransactionClient,
  inventoryItemId: string,
) {
  const rows = await tx.$queryRaw<LockedInventoryRow[]>`
    SELECT * FROM "PreprovisionedInventoryItem"
    WHERE "id" = ${inventoryItemId}
    FOR UPDATE
  `;
  const credentials = await tx.$queryRaw<LockedInventoryCredentialRow[]>`
    SELECT * FROM "PreprovisionedInventoryCredential"
    WHERE "inventoryItemId" = ${inventoryItemId}
    FOR UPDATE
  `;
  return { item: rows[0] ?? null, credential: credentials[0] ?? null };
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
    const { item, credential } = await lockInventoryAndCredentialTx(
      tx,
      candidate.id,
    );
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
        inventoryStatus:
          isPreprovisionedInventoryFresh(item, now) &&
          credential?.status ===
            PreprovisionedInventoryCredentialStatus.READY
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
    provider: InfrastructureProvider;
    apiVersion: string;
    regionCode: string;
    externalPlanId: string;
    externalImageId: string;
    externalNetworkId: string;
    externalSecurityId: string;
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
    const { item, credential } = await lockInventoryAndCredentialTx(
      tx,
      candidate.id,
    );
    const expected = {
      planId: input.planId,
      catalogItemId: input.catalogItemId,
      provider: input.provider,
      apiVersion: input.apiVersion,
      regionCode: input.regionCode,
      externalPlanId: input.externalPlanId,
      externalImageId: input.externalImageId,
      externalNetworkId: input.externalNetworkId,
      externalSecurityId: input.externalSecurityId,
    };
    if (
      item &&
      assessPreprovisionedInventoryEligibility({
        item,
        credential,
        expected,
        stage: { kind: "AVAILABLE" },
        now,
      }).eligible
    ) {
      return { ...item, credential: credential! };
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
  const { item, credential } = await lockInventoryAndCredentialTx(
    tx,
    input.inventoryItemId,
  );
  if (
    !item ||
    !assessPreprovisionedInventoryEligibility({
      item,
      credential,
      expected: {
        planId: item.planId,
        catalogItemId: item.catalogItemId,
        provider: item.provider,
        apiVersion: item.apiVersion,
        regionCode: item.regionCode,
          externalPlanId: item.externalPlanId,
          externalImageId: item.externalImageId,
          externalNetworkId: item.observedNetworkId!,
          externalSecurityId: item.observedSecurityId!,
      },
      stage: { kind: "AVAILABLE" },
      now,
    }).eligible
  ) {
    throw new WalletError(
      "inventory_reservation_conflict",
      "این سرور دیگر شرایط فروش امن را ندارد؛ گزینهٔ دیگری را انتخاب کنید.",
    );
  }
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
    expected: InventoryExpectedSelection;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const { item, credential } = await lockInventoryAndCredentialTx(
    tx,
    input.inventoryItemId,
  );
  if (
    !item ||
    !assessPreprovisionedInventoryEligibility({
      item,
      credential,
      expected: input.expected,
      stage: { kind: "RESERVED_QUOTE", quoteId: input.quoteId },
      now,
    }).eligible
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
    expected: InventoryExpectedSelection;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const { item, credential } = await lockInventoryAndCredentialTx(
    tx,
    input.inventoryItemId,
  );
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
    const assignedEligibility = assessPreprovisionedInventoryEligibility({
      item: item!,
      credential,
      expected: input.expected,
      stage: { kind: "ASSIGNED", orderId: input.orderId },
      now,
    });
    if (!assignedEligibility.eligible) {
      throw new WalletError(
        "inventory_unavailable",
        "Credential موجودی تخصیص‌یافته با سفارش همخوان نیست.",
      );
    }
    return { ...item!, credential: credential! };
  }
  if (
    !item ||
    !assessPreprovisionedInventoryEligibility({
      item,
      credential,
      expected: input.expected,
      stage: {
        kind: "RESERVED_ORDER",
        quoteId: input.quoteId,
        orderId: input.orderId,
        revision: input.revision,
      },
      now,
    }).eligible
  ) {
    throw new WalletError(
      "inventory_unavailable",
      "سرور آمادهٔ رزروشده دیگر سالم یا قابل تخصیص نیست؛ مبلغی برداشت نشد.",
    );
  }
  return { ...item, credential: credential! };
}

export async function assignReservedInventoryTx(
  tx: Prisma.TransactionClient,
  input: {
    inventoryItemId: string;
    quoteId: string;
    orderId: string;
    revision: number;
    assignedAt?: Date;
  },
) {
  const assignedAt = input.assignedAt ?? new Date();
  const { item, credential } = await lockInventoryAndCredentialTx(
    tx,
    input.inventoryItemId,
  );
  if (
    !item ||
    !assessPreprovisionedInventoryEligibility({
      item,
      credential,
      expected: {
        planId: item.planId,
        catalogItemId: item.catalogItemId,
        provider: item.provider,
        apiVersion: item.apiVersion,
        regionCode: item.regionCode,
        externalPlanId: item.externalPlanId,
        externalImageId: item.externalImageId,
        externalNetworkId: item.observedNetworkId!,
        externalSecurityId: item.observedSecurityId!,
      },
      stage: {
        kind: "RESERVED_ORDER",
        quoteId: input.quoteId,
        orderId: input.orderId,
        revision: input.revision,
      },
      now: assignedAt,
    }).eligible
  ) {
    throw new WalletError(
      "inventory_assignment_conflict",
      "تخصیص سرور یا Credential آن دیگر معتبر نیست؛ پرداخت لغو شد.",
    );
  }
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

export async function transferInventoryCredentialToInstanceTx(
  tx: Prisma.TransactionClient,
  input: {
    inventoryItemId: string;
    cloudInstanceId: string;
    transferredAt?: Date;
  },
) {
  const transferredAt = input.transferredAt ?? new Date();
  const { credential } = await lockInventoryAndCredentialTx(
    tx,
    input.inventoryItemId,
  );
  if (
    !credential ||
    credential.status !== PreprovisionedInventoryCredentialStatus.READY
  ) {
    throw new WalletError(
      "inventory_credential_not_ready",
      "Credential امن این سرور آمادهٔ انتقال نیست؛ پرداخت لغو شد.",
    );
  }
  const instanceCredential = await tx.instanceCredential.create({
    data: {
      cloudInstanceId: input.cloudInstanceId,
      createdById: credential.createdById,
      username: credential.username,
      ciphertext: credential.ciphertext,
      iv: credential.iv,
      authTag: credential.authTag,
      status: "READY",
      expiresAt: new Date(transferredAt.getTime() + 24 * 60 * 60 * 1_000),
    },
  });
  const transferred = await tx.preprovisionedInventoryCredential.updateMany({
    where: {
      id: credential.id,
      inventoryItemId: input.inventoryItemId,
      status: PreprovisionedInventoryCredentialStatus.READY,
      transferredAt: null,
    },
    data: {
      status: PreprovisionedInventoryCredentialStatus.TRANSFERRED,
      transferredAt,
    },
  });
  if (transferred.count !== 1) {
    throw new WalletError(
      "inventory_credential_transfer_conflict",
      "Credential این سرور هم‌زمان منتقل شد؛ پرداخت لغو شد.",
    );
  }
  return instanceCredential;
}

export async function releaseInventoryReservationForOrder(
  orderId: string,
  reason: string,
) {
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.preprovisionedInventoryItem.findFirst({
      where: { reservedByOrderId: orderId },
      select: { id: true },
    });
    const { item, credential } = candidate
      ? await lockInventoryAndCredentialTx(tx, candidate.id)
      : { item: null, credential: null };
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
        inventoryStatus:
          isPreprovisionedInventoryFresh(item, now) &&
          credential?.status ===
            PreprovisionedInventoryCredentialStatus.READY
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
  const rows = await prisma.preprovisionedInventoryItem.findMany({
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
    include: {
      credential: true,
      plan: { include: { catalogItem: true } },
    },
  });
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.plan.catalogItem) continue;
    const eligible = assessPreprovisionedInventoryEligibility({
      item: row,
      credential: row.credential,
      expected: {
        planId: row.plan.id,
        catalogItemId: row.plan.catalogItem.id,
        provider: row.plan.provider,
        apiVersion: row.plan.providerApiVersion,
        regionCode: row.plan.regionCode,
        externalPlanId:
          row.plan.catalogItem.externalPlanId ?? row.plan.sizeCode,
        externalImageId: row.plan.imageCode,
        externalNetworkId: row.observedNetworkId!,
        externalSecurityId: row.observedSecurityId!,
      },
      stage: { kind: "AVAILABLE" },
      now,
    });
    if (eligible.eligible) {
      counts.set(row.planId, (counts.get(row.planId) ?? 0) + 1);
    }
  }
  return counts;
}

export async function findFreshAvailableInventory(input: {
  planId: string;
  catalogItemId: string;
  provider: InfrastructureProvider;
  apiVersion: string;
  regionCode: string;
  externalPlanId: string;
  externalImageId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const rows = await prisma.preprovisionedInventoryItem.findMany({
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
    include: { credential: true },
  });
  return (
    rows.find((row) =>
      assessPreprovisionedInventoryEligibility({
        item: row,
        credential: row.credential,
        expected: {
          planId: input.planId,
          catalogItemId: input.catalogItemId,
          provider: input.provider,
          apiVersion: input.apiVersion,
          regionCode: input.regionCode,
          externalPlanId: input.externalPlanId,
          externalImageId: input.externalImageId,
          externalNetworkId: row.observedNetworkId!,
          externalSecurityId: row.observedSecurityId!,
        },
        stage: { kind: "AVAILABLE" },
        now,
      }).eligible,
    ) ?? null
  );
}

function providerPlanId(resource: ProviderResource) {
  return resource.externalPlanId?.trim() || null;
}

function providerImageId(resource: ProviderResource) {
  return resource.externalImageId?.trim() || null;
}

const INVENTORY_USERNAME_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/i;

export async function storePreprovisionedInventoryCredential(input: {
  inventoryItemId: string;
  actorUserId: string;
  username: string;
  secret: string;
  tx?: Prisma.TransactionClient;
}) {
  const username = input.username.trim();
  if (
    !INVENTORY_USERNAME_PATTERN.test(username) ||
    input.secret.length < 8 ||
    input.secret.length > 4_096
  ) {
    throw new WalletError(
      "invalid_inventory_credential",
      "نام کاربری یا Credential موجودی معتبر نیست.",
    );
  }
  const encrypted = encryptCredential(input.secret);
  const secretFingerprint = credentialFingerprint(input.secret);
  const store = async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`inventory-credential:${secretFingerprint}`}, 0)
      )::text AS locked
    `;
    const { item, credential: existing } =
      await lockInventoryAndCredentialTx(tx, input.inventoryItemId);
    if (
      !item ||
      item.assignedOrderId != null ||
      item.inventoryStatus === PreprovisionedInventoryStatus.ASSIGNED ||
      item.inventoryStatus === PreprovisionedInventoryStatus.DELIVERED ||
      item.inventoryStatus === PreprovisionedInventoryStatus.RESERVED
    ) {
      throw new WalletError(
        "inventory_credential_locked",
        "Credential این موجودی پس از رزرو یا تخصیص قابل تغییر نیست.",
      );
    }
    if (
      existing?.status ===
      PreprovisionedInventoryCredentialStatus.TRANSFERRED
    ) {
      throw new WalletError(
        "inventory_credential_transferred",
        "Credential این موجودی قبلاً منتقل شده است.",
      );
    }
    const reused = await tx.preprovisionedInventoryCredential.findUnique({
      where: { secretFingerprint },
      select: { inventoryItemId: true },
    });
    if (reused && reused.inventoryItemId !== item.id) {
      throw new WalletError(
        "inventory_credential_reused",
        "برای هر سرور باید Password یکتای دیگری ثبت شود.",
      );
    }
    const credential = await tx.preprovisionedInventoryCredential.upsert({
      where: { inventoryItemId: item.id },
      update: {
        username,
        ...encrypted,
        secretFingerprint,
        status: PreprovisionedInventoryCredentialStatus.READY,
        createdById: input.actorUserId,
        transferredAt: null,
      },
      create: {
        inventoryItemId: item.id,
        username,
        ...encrypted,
        secretFingerprint,
        status: PreprovisionedInventoryCredentialStatus.READY,
        createdById: input.actorUserId,
      },
    });
    await tx.preprovisionedInventoryItem.update({
      where: { id: item.id },
      data: {
        inventoryStatus: isPreprovisionedInventoryFresh(item)
          ? PreprovisionedInventoryStatus.AVAILABLE
          : item.healthStatus === PreprovisionedHealthStatus.UNHEALTHY
            ? PreprovisionedInventoryStatus.UNHEALTHY
            : PreprovisionedInventoryStatus.STALE,
        updatedById: input.actorUserId,
      },
    });
    return credential;
  };
  return input.tx ? store(input.tx) : prisma.$transaction(store);
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
      include: { credential: true },
    });
    if (
      existing &&
      (existing.assignedOrderId ||
        existing.inventoryStatus === PreprovisionedInventoryStatus.RESERVED ||
        existing.inventoryStatus === PreprovisionedInventoryStatus.DELIVERED)
    ) {
      throw new WalletError(
        "inventory_already_assigned",
        "Resource قبلاً به سفارش دیگری اختصاص یافته است.",
      );
    }
    const credentialReady =
      existing?.credential?.status ===
      PreprovisionedInventoryCredentialStatus.READY;
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
        inventoryStatus: reachable
          ? credentialReady
            ? PreprovisionedInventoryStatus.AVAILABLE
            : PreprovisionedInventoryStatus.STALE
          : inventoryStatus,
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
        inventoryStatus: reachable
          ? PreprovisionedInventoryStatus.STALE
          : inventoryStatus,
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
