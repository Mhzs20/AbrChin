import {
  PreprovisionedInventoryCredentialStatus,
  PreprovisionedInventoryStatus,
  RecommendationFlowStatus,
  RecommendationQuoteStatus,
  ServiceOrderStatus,
  type Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { WalletError } from "@/lib/wallet/errors";
import { isPreprovisionedInventoryFresh } from "@/lib/infrastructure/preprovisioned-inventory";
import { transitionProductFlowTx } from "@/lib/product-flow/service";
import {
  isProductFlowState,
  type ProductFlowState,
} from "@/lib/product-flow/state-machine";

const EXPIREABLE_QUOTE_STATUSES: RecommendationQuoteStatus[] = [
  RecommendationQuoteStatus.ACTIVE,
  RecommendationQuoteStatus.SELECTED,
];

const EXPIREABLE_FLOW_STATES = new Set<ProductFlowState>([
  "QUOTED",
  "AUTH_REQUIRED",
  "AWAITING_PAYMENT",
]);

/**
 * Idempotently expire a locked commercial quote after its 60-minute TTL.
 *
 * - Marks the RecommendationQuote EXPIRED
 * - Transitions product-flow owners to QUOTE_EXPIRED when allowed
 * - Leaves PENDING_PAYMENT ServiceOrder rows non-payable via flow/quote status
 * - Releases unused inventory reservations
 * - Never deletes financial or audit history
 */
export async function expireLockedQuoteContractTx(
  tx: Prisma.TransactionClient,
  input: {
    quoteId: string;
    now?: Date;
    reason?: string;
  },
): Promise<{ expired: boolean }> {
  const now = input.now ?? new Date();
  const reason = input.reason ?? "quote_ttl_elapsed";

  const quote = await tx.recommendationQuote.findUnique({
    where: { id: input.quoteId },
    include: {
      session: true,
      serviceOrder: true,
      reservedInventoryItem: {
        include: { credential: true },
      },
    },
  });
  if (!quote) return { expired: false };

  if (
    quote.status === RecommendationQuoteStatus.EXPIRED ||
    quote.status === RecommendationQuoteStatus.INVALIDATED ||
    quote.status === RecommendationQuoteStatus.CONVERTED
  ) {
    return { expired: quote.status === RecommendationQuoteStatus.EXPIRED };
  }

  if (quote.expiresAt.getTime() > now.getTime()) {
    return { expired: false };
  }

  if (EXPIREABLE_QUOTE_STATUSES.includes(quote.status)) {
    await tx.recommendationQuote.update({
      where: { id: quote.id },
      data: { status: RecommendationQuoteStatus.EXPIRED },
    });
  }

  const order = quote.serviceOrder;
  const sessionState = quote.session.productFlowState;
  const orderState = order?.productFlowState ?? null;
  const fromStateRaw = orderState ?? sessionState;
  const fromState =
    fromStateRaw && isProductFlowState(fromStateRaw) ? fromStateRaw : null;

  if (fromState && EXPIREABLE_FLOW_STATES.has(fromState)) {
    await transitionProductFlowTx(tx, {
      owner: {
        recommendationSessionId: quote.sessionId,
        serviceOrderId: order?.id ?? null,
      },
      from: fromState,
      to: "QUOTE_EXPIRED",
      reason,
      idempotencyKey: `quote-expired:${quote.id}`,
      metadata: {
        quoteId: quote.id,
        expiresAt: quote.expiresAt.toISOString(),
        containsSecret: false,
      },
    });
  }

  if (
    quote.session.status === RecommendationFlowStatus.QUOTED ||
    quote.session.status === RecommendationFlowStatus.CHECKOUT
  ) {
    await tx.recommendationSession.update({
      where: { id: quote.sessionId },
      data: { status: RecommendationFlowStatus.EXPIRED },
    });
  }

  // Keep ServiceOrder row for audit; payment gates on quote/flow expiry.
  if (order && order.status === ServiceOrderStatus.PENDING_PAYMENT) {
    void order;
  }

  const inventory = quote.reservedInventoryItem;
  if (
    inventory &&
    inventory.inventoryStatus === PreprovisionedInventoryStatus.RESERVED &&
    inventory.assignedOrderId == null
  ) {
    await tx.preprovisionedInventoryItem.update({
      where: { id: inventory.id },
      data: {
        inventoryStatus:
          isPreprovisionedInventoryFresh(inventory, now) &&
          inventory.credential?.status ===
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
  }

  return { expired: true };
}

export async function expireLockedQuoteContract(input: {
  quoteId: string;
  now?: Date;
  reason?: string;
}) {
  return prisma.$transaction((tx) => expireLockedQuoteContractTx(tx, input));
}

export function isCommercialQuoteExpired(input: {
  quoteExpiresAt: Date;
  orderQuoteExpiresAt?: Date | null;
  sessionExpiresAt?: Date | null;
  now?: Date;
}): boolean {
  const now = input.now ?? new Date();
  return (
    input.quoteExpiresAt.getTime() <= now.getTime() ||
    (input.orderQuoteExpiresAt != null &&
      input.orderQuoteExpiresAt.getTime() <= now.getTime()) ||
    (input.sessionExpiresAt != null &&
      input.sessionExpiresAt.getTime() <= now.getTime())
  );
}

/**
 * Expire due quotes and reject payment. Runs in its own transaction so the
 * expiration commit is not rolled back by the payment failure path.
 */
export async function rejectIfQuoteExpired(input: {
  quoteId: string;
  quoteExpiresAt: Date;
  orderQuoteExpiresAt?: Date | null;
  sessionExpiresAt?: Date | null;
  now?: Date;
}): Promise<void> {
  if (!isCommercialQuoteExpired(input)) return;
  await expireLockedQuoteContract({
    quoteId: input.quoteId,
    now: input.now,
    reason: "quote_ttl_elapsed",
  });
  throw new WalletError(
    "quote_expired",
    "اعتبار قیمت این سفارش تمام شده؛ قیمت را دوباره دریافت کنید.",
  );
}

/**
 * Worker/sweep helper: expire due ACTIVE/SELECTED quotes idempotently.
 */
export async function expireDueLockedQuotes(now = new Date(), limit = 100) {
  const due = await prisma.recommendationQuote.findMany({
    where: {
      status: { in: EXPIREABLE_QUOTE_STATUSES },
      expiresAt: { lte: now },
    },
    select: { id: true },
    take: limit,
    orderBy: { expiresAt: "asc" },
  });
  let expired = 0;
  for (const quote of due) {
    const result = await expireLockedQuoteContract({
      quoteId: quote.id,
      now,
      reason: "quote_ttl_sweep",
    });
    if (result.expired) expired += 1;
  }
  return expired;
}
