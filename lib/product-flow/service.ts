import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  assertProductFlowTransition,
  type ProductFlowState,
} from "@/lib/product-flow/state-machine";

export type ProductFlowOwner = {
  recommendationSessionId?: string | null;
  serviceOrderId?: string | null;
  infrastructureOrderId?: string | null;
};

export async function transitionProductFlow(input: {
  owner: ProductFlowOwner;
  from: ProductFlowState;
  to: ProductFlowState;
  idempotencyKey: string;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue;
  actorUserId?: string | null;
}) {
  assertProductFlowTransition(input.from, input.to);
  if (
    !input.owner.recommendationSessionId &&
    !input.owner.serviceOrderId &&
    !input.owner.infrastructureOrderId
  ) {
    throw new Error("product_flow_owner_required");
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.productFlowTransition.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      if (
        existing.fromState !== input.from ||
        existing.toState !== input.to
      ) {
        throw new Error("product_flow_idempotency_conflict");
      }
      return existing;
    }

    if (input.owner.recommendationSessionId) {
      const changed = await tx.recommendationSession.updateMany({
        where: {
          id: input.owner.recommendationSessionId,
          OR:
            input.from === "DRAFT"
              ? [{ productFlowState: "DRAFT" }, { productFlowState: null }]
              : [{ productFlowState: input.from }],
        },
        data: { productFlowState: input.to },
      });
      if (changed.count !== 1) throw new Error("product_flow_state_conflict");
    }
    if (input.owner.serviceOrderId) {
      const changed = await tx.serviceOrder.updateMany({
        where: {
          id: input.owner.serviceOrderId,
          productFlowState: input.from,
        },
        data: { productFlowState: input.to },
      });
      if (changed.count !== 1) throw new Error("product_flow_state_conflict");
    }
    if (input.owner.infrastructureOrderId) {
      const changed = await tx.infrastructureOrder.updateMany({
        where: {
          id: input.owner.infrastructureOrderId,
          productFlowState: input.from,
        },
        data: { productFlowState: input.to },
      });
      if (changed.count !== 1) throw new Error("product_flow_state_conflict");
    }

    return tx.productFlowTransition.create({
      data: {
        recommendationSessionId:
          input.owner.recommendationSessionId ?? null,
        serviceOrderId: input.owner.serviceOrderId ?? null,
        infrastructureOrderId:
          input.owner.infrastructureOrderId ?? null,
        fromState: input.from,
        toState: input.to,
        reason: input.reason ?? null,
        metadata: input.metadata,
        idempotencyKey: input.idempotencyKey,
        actorUserId: input.actorUserId ?? null,
      },
    });
  });
}
