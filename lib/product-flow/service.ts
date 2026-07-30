import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  assertProductFlowTransition,
  isProductFlowState,
  type ProductFlowState,
} from "@/lib/product-flow/state-machine";

export type ProductFlowOwner = {
  recommendationSessionId?: string | null;
  serviceOrderId?: string | null;
  infrastructureOrderId?: string | null;
};

export type ProductFlowTransitionInput = {
  owner: ProductFlowOwner;
  from: ProductFlowState;
  to: ProductFlowState;
  idempotencyKey: string;
  reason: string;
  metadata?: Prisma.InputJsonValue;
  actorUserId?: string | null;
};

export class ProductFlowConflictError extends Error {
  readonly code:
    | "product_flow_state_conflict"
    | "product_flow_idempotency_conflict"
    | "product_flow_invariant_failed";

  constructor(
    code:
      | "product_flow_state_conflict"
      | "product_flow_idempotency_conflict"
      | "product_flow_invariant_failed",
  ) {
    super(code);
    this.name = "ProductFlowConflictError";
    this.code = code;
  }
}

function ownerFingerprint(owner: ProductFlowOwner): string {
  const values = [
    owner.recommendationSessionId ?? "-",
    owner.serviceOrderId ?? "-",
    owner.infrastructureOrderId ?? "-",
  ];
  if (values.every((value) => value === "-")) {
    throw new Error("product_flow_owner_required");
  }
  return values.join(":");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function assertTransitionInvariant(
  tx: Prisma.TransactionClient,
  input: ProductFlowTransitionInput,
): Promise<void> {
  if (!input.owner.recommendationSessionId) return;
  if (!["DELIVERY_CONFIGURED", "QUOTED"].includes(input.to)) return;
  const session = await tx.recommendationSession.findUnique({
    where: { id: input.owner.recommendationSessionId },
    select: {
      selectedParchinLevel: true,
      deliveryConfiguration: true,
    },
  });
  if (
    !session?.selectedParchinLevel ||
    !session.deliveryConfiguration ||
    typeof session.deliveryConfiguration !== "object" ||
    Array.isArray(session.deliveryConfiguration)
  ) {
    throw new ProductFlowConflictError("product_flow_invariant_failed");
  }
}

async function currentOwnerState(
  tx: Prisma.TransactionClient,
  owner: ProductFlowOwner,
): Promise<{ state: ProductFlowState; revision: number }> {
  const rows = await Promise.all([
    owner.recommendationSessionId
      ? tx.recommendationSession.findUnique({
          where: { id: owner.recommendationSessionId },
          select: { productFlowState: true, productFlowRevision: true },
        })
      : null,
    owner.serviceOrderId
      ? tx.serviceOrder.findUnique({
          where: { id: owner.serviceOrderId },
          select: { productFlowState: true, productFlowRevision: true },
        })
      : null,
    owner.infrastructureOrderId
      ? tx.infrastructureOrder.findUnique({
          where: { id: owner.infrastructureOrderId },
          select: { productFlowState: true, productFlowRevision: true },
        })
      : null,
  ]);
  const present = rows.filter((row) => row != null);
  if (present.length === 0) {
    throw new ProductFlowConflictError("product_flow_state_conflict");
  }
  const normalized = present.map((row) => ({
    state:
      row.productFlowState == null
        ? ("DRAFT" as const)
        : isProductFlowState(row.productFlowState)
          ? row.productFlowState
          : null,
    revision: row.productFlowRevision,
  }));
  if (
    normalized.some((row) => row.state == null) ||
    normalized.some(
      (row) =>
        row.state !== normalized[0]?.state ||
        row.revision !== normalized[0]?.revision,
    )
  ) {
    throw new ProductFlowConflictError("product_flow_state_conflict");
  }
  return normalized[0] as { state: ProductFlowState; revision: number };
}

export async function assertProductFlowOwnerStateTx(
  tx: Prisma.TransactionClient,
  owner: ProductFlowOwner,
  expected: ProductFlowState,
) {
  const current = await currentOwnerState(tx, owner);
  if (current.state !== expected) {
    throw new ProductFlowConflictError("product_flow_state_conflict");
  }
  return current;
}

export async function transitionProductFlowTx(
  tx: Prisma.TransactionClient,
  input: ProductFlowTransitionInput,
) {
  assertProductFlowTransition(input.from, input.to);
  const fingerprint = ownerFingerprint(input.owner);
  const existing = await tx.productFlowTransition.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    if (
      existing.ownerFingerprint !== fingerprint ||
      existing.fromState !== input.from ||
      existing.toState !== input.to ||
      existing.reason !== input.reason ||
      stableJson(existing.metadata ?? null) !==
        stableJson(input.metadata ?? null)
    ) {
      throw new ProductFlowConflictError(
        "product_flow_idempotency_conflict",
      );
    }
    return existing;
  }

  const current = await currentOwnerState(tx, input.owner);
  if (current.state !== input.from) {
    throw new ProductFlowConflictError("product_flow_state_conflict");
  }
  await assertTransitionInvariant(tx, input);
  const nextRevision = current.revision + 1;

  const updates = await Promise.all([
    input.owner.recommendationSessionId
      ? tx.recommendationSession.updateMany({
          where: {
            id: input.owner.recommendationSessionId,
            productFlowRevision: current.revision,
            OR:
              input.from === "DRAFT"
                ? [{ productFlowState: "DRAFT" }, { productFlowState: null }]
                : [{ productFlowState: input.from }],
          },
          data: {
            productFlowState: input.to,
            productFlowRevision: { increment: 1 },
          },
        })
      : null,
    input.owner.serviceOrderId
      ? tx.serviceOrder.updateMany({
          where: {
            id: input.owner.serviceOrderId,
            productFlowState: input.from,
            productFlowRevision: current.revision,
          },
          data: {
            productFlowState: input.to,
            productFlowRevision: { increment: 1 },
          },
        })
      : null,
    input.owner.infrastructureOrderId
      ? tx.infrastructureOrder.updateMany({
          where: {
            id: input.owner.infrastructureOrderId,
            productFlowState: input.from,
            productFlowRevision: current.revision,
          },
          data: {
            productFlowState: input.to,
            productFlowRevision: { increment: 1 },
          },
        })
      : null,
  ]);
  if (updates.some((result) => result != null && result.count !== 1)) {
    throw new ProductFlowConflictError("product_flow_state_conflict");
  }

  return tx.productFlowTransition.create({
    data: {
      recommendationSessionId:
        input.owner.recommendationSessionId ?? null,
      serviceOrderId: input.owner.serviceOrderId ?? null,
      infrastructureOrderId: input.owner.infrastructureOrderId ?? null,
      fromState: input.from,
      toState: input.to,
      reason: input.reason,
      metadata: input.metadata,
      idempotencyKey: input.idempotencyKey,
      ownerFingerprint: fingerprint,
      fromRevision: current.revision,
      toRevision: nextRevision,
      actorUserId: input.actorUserId ?? null,
    },
  });
}

export async function bootstrapCatalogCheckoutFlowTx(
  tx: Prisma.TransactionClient,
  input: {
    recommendationSessionId: string;
    idempotencyKey: string;
    actorUserId?: string | null;
    metadata?: Prisma.InputJsonValue;
  },
) {
  const transitions = [
    ["DRAFT", "UNDERSTANDING_CONFIRMED", "catalog_need_confirmed"],
    [
      "UNDERSTANDING_CONFIRMED",
      "REQUIREMENTS_COMPLETE",
      "catalog_requirements_confirmed",
    ],
    ["REQUIREMENTS_COMPLETE", "RECOMMENDED", "catalog_plan_selected"],
    ["RECOMMENDED", "PARCHIN_SELECTED", "catalog_parchin_selected"],
    [
      "PARCHIN_SELECTED",
      "DELIVERY_CONFIGURED",
      "catalog_delivery_configured",
    ],
    ["DELIVERY_CONFIGURED", "QUOTED", "catalog_selection_quoted"],
  ] as const;
  const owner = {
    recommendationSessionId: input.recommendationSessionId,
  };
  for (const [index, [from, to, reason]] of transitions.entries()) {
    await transitionProductFlowTx(tx, {
      owner,
      from,
      to,
      reason,
      idempotencyKey: `${input.idempotencyKey}:transition:${index}`,
      actorUserId: input.actorUserId ?? null,
      metadata: input.metadata,
    });
  }
}

export async function transitionProductFlow(
  input: ProductFlowTransitionInput,
) {
  return prisma.$transaction((tx) => transitionProductFlowTx(tx, input));
}
