import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import {
  Prisma,
  RecommendationFlowStatus,
  RecommendationQuoteStatus,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import {
  transitionProductFlowTx,
  type ProductFlowOwner,
} from "@/lib/product-flow/service";
import {
  getRecommendationQuestion,
  getRecommendationQuestionOrder,
} from "@/lib/recommendation/questions";
import { validateRecommendationAnswer } from "@/lib/recommendation/input";
import type {
  AnswerSources,
  QuestionId,
  RecommendationAnswers,
} from "@/lib/recommendation/types";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export class ConversationRevisionConflictError extends Error {
  readonly currentRevision: number;

  constructor(currentRevision: number) {
    super("conversation_revision_conflict");
    this.name = "ConversationRevisionConflictError";
    this.currentRevision = currentRevision;
  }
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createGuestSessionCredential() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: tokenHash(token) };
}

export function createCatalogGuestSessionCredential(
  idempotencyKey: string,
) {
  const secret = getEnv().sessionSecret;
  if (secret.length < 16) {
    throw new Error("SESSION_SECRET must be set (min 16 characters)");
  }
  const token = createHmac("sha256", secret)
    .update(`catalog-checkout:${idempotencyKey}`, "utf8")
    .digest("base64url");
  return { token, hash: tokenHash(token) };
}

function tokenMatches(token: string, expectedHash: string): boolean {
  const received = Buffer.from(tokenHash(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return (
    received.length === expected.length &&
    timingSafeEqual(received, expected)
  );
}

export function verifyGuestSessionCredential(
  token: string,
  expectedHash: string,
) {
  return tokenMatches(token, expectedHash);
}

export function buildConversationResumeLookup(input: {
  userId?: string | null;
  guestToken?: string | null;
  now?: Date;
}) {
  const common = {
    expiresAt: { gt: input.now ?? new Date() },
    productFlowState: { notIn: ["ACTIVE", "CANCELLED"] },
  };
  if (input.userId) return { ...common, userId: input.userId };
  if (input.guestToken) {
    return {
      ...common,
      userId: null,
      guestAccessTokenHash: tokenHash(input.guestToken),
    };
  }
  return null;
}

function asAnswers(value: Prisma.JsonValue): RecommendationAnswers {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecommendationAnswers)
    : {};
}

function asSources(value: Prisma.JsonValue): AnswerSources {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as AnswerSources)
    : {};
}

function publicDeliveryConfiguration(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    region:
      typeof record.regionLabel === "string"
        ? record.regionLabel
        : typeof record.region === "string"
          ? record.region
          : null,
    operatingSystem:
      typeof record.operatingSystem === "string"
        ? record.operatingSystem
        : null,
    accessMethod:
      typeof record.accessMethod === "string" ? record.accessMethod : null,
    sshKeyConfigured:
      typeof record.sshKeyName === "string" && record.sshKeyName.length > 0,
    network:
      record.topologyVerificationMode === "PROVIDER_MANAGED"
        ? "PROVIDER_MANAGED"
        : record.externalNetworkId
          ? "DEFAULT_LOCKED"
          : null,
    security:
      record.topologyVerificationMode === "PROVIDER_MANAGED"
        ? "PROVIDER_MANAGED"
        : record.externalSecurityId
          ? "DEFAULT_LOCKED"
          : null,
    startupScriptConfigured:
      typeof record.startupScriptCode === "string" &&
      record.startupScriptCode.length > 0,
  };
}

export async function serializeConversationSession(
  sessionId: string,
) {
  const session = await prisma.recommendationSession.findUnique({
    where: { id: sessionId },
    include: {
      quotes: {
        where: {
          status: {
            in: [
              RecommendationQuoteStatus.ACTIVE,
              RecommendationQuoteStatus.SELECTED,
            ],
          },
        },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!session) throw new Error("conversation_session_not_found");
  const answers = asAnswers(session.answers);
  const order = getRecommendationQuestionOrder(answers);
  const nextId = order.find((questionId) => !answers[questionId]) ?? null;
  const activeQuote = session.quotes[0] ?? null;
  return {
    sessionId: session.id,
    revision: session.revision,
    productFlowState: session.productFlowState ?? "DRAFT",
    answers,
    answerSources: asSources(session.answerSources),
    understandingSnapshot: session.understandingSnapshot,
    nextQuestion: nextId
      ? getRecommendationQuestion(nextId, answers)
      : null,
    selectedParchinLevel: session.selectedParchinLevel,
    deliveryConfiguration: publicDeliveryConfiguration(
      session.deliveryConfiguration,
    ),
    activeQuote: activeQuote
      ? {
          id: activeQuote.id,
          amountRial: activeQuote.amountRial.toString(),
          renewalAmountRial: activeQuote.renewalAmountRial.toString(),
          status: activeQuote.status,
          expiresAt: activeQuote.expiresAt.toISOString(),
        }
      : null,
    expiresAt:
      activeQuote?.expiresAt.toISOString() ?? session.expiresAt.toISOString(),
  };
}

export async function createConversationSession(userId?: string | null) {
  const guestToken = userId ? null : randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const session = await prisma.recommendationSession.create({
    data: {
      userId: userId ?? null,
      guestAccessTokenHash: guestToken ? tokenHash(guestToken) : null,
      status: RecommendationFlowStatus.DISCOVERY,
      productFlowState: "DRAFT",
      answers: {},
      answerSources: {},
      expiresAt,
    },
  });
  return {
    id: session.id,
    guestToken,
    expiresAt,
    revision: session.revision,
    state: "DRAFT" as const,
    nextQuestion: getRecommendationQuestion("project", {}),
  };
}

export async function requireConversationAccess(input: {
  sessionId: string;
  userId?: string | null;
  guestToken?: string | null;
}) {
  const session = await prisma.recommendationSession.findUnique({
    where: { id: input.sessionId },
  });
  if (!session || session.expiresAt.getTime() <= Date.now()) {
    throw new Error("conversation_session_not_found");
  }
  if (session.userId) {
    if (session.userId !== input.userId) {
      throw new Error("conversation_session_forbidden");
    }
    return session;
  }
  if (
    !session.guestAccessTokenHash ||
    !input.guestToken ||
    !tokenMatches(input.guestToken, session.guestAccessTokenHash)
  ) {
    throw new Error("conversation_session_forbidden");
  }
  return session;
}

export async function getConversationSession(input: {
  sessionId: string;
  userId?: string | null;
  guestToken?: string | null;
}) {
  await requireConversationAccess(input);
  return serializeConversationSession(input.sessionId);
}

export async function getLatestConversationSession(userId: string) {
  const session = await prisma.recommendationSession.findFirst({
    where: {
      userId,
      expiresAt: { gt: new Date() },
      productFlowState: {
        notIn: ["ACTIVE", "CANCELLED"],
      },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  return session ? serializeConversationSession(session.id) : null;
}

export async function getLatestConversationSessionForAccess(input: {
  userId?: string | null;
  guestToken?: string | null;
}) {
  const now = new Date();
  const where = buildConversationResumeLookup({ ...input, now });
  const session = where
    ? await prisma.recommendationSession.findFirst({
        where,
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      })
    : null;
  return session ? serializeConversationSession(session.id) : null;
}

function resetOwner(sessionId: string): ProductFlowOwner {
  return { recommendationSessionId: sessionId };
}

export async function updateConversationAnswer(input: {
  sessionId: string;
  questionId: QuestionId;
  answer: unknown;
  expectedRevision: number;
  source?: "user" | "estimate" | "default";
  userId?: string | null;
  guestToken?: string | null;
}) {
  const session = await requireConversationAccess(input);
  if (session.revision !== input.expectedRevision) {
    throw new ConversationRevisionConflictError(session.revision);
  }
  const answer = validateRecommendationAnswer(input.questionId, input.answer);
  const answers = {
    ...asAnswers(session.answers),
    [input.questionId]: answer,
  };
  const sources = {
    ...asSources(session.answerSources),
    [input.questionId]: input.source ?? "user",
  };
  const order = getRecommendationQuestionOrder(answers);
  const nextId = order.find((questionId) => !answers[questionId]) ?? null;
  const currentState = session.productFlowState ?? "DRAFT";
  if (
    ["AUTH_REQUIRED", "AWAITING_PAYMENT", "PAID", "PROVISIONING_SUBMITTED",
      "PROVISIONING", "HEALTH_CHECKING", "DELIVERED", "ACTIVE"].includes(
      currentState,
    )
  ) {
    throw new Error("conversation_answers_locked");
  }

  await prisma.$transaction(async (tx) => {
    await tx.recommendationQuote.updateMany({
      where: {
        sessionId: session.id,
        status: {
          in: [
            RecommendationQuoteStatus.ACTIVE,
            RecommendationQuoteStatus.SELECTED,
          ],
        },
      },
      data: { status: RecommendationQuoteStatus.INVALIDATED },
    });
    const changed = await tx.recommendationSession.updateMany({
      where: {
        id: session.id,
        revision: input.expectedRevision,
      },
      data: {
        answers: answers as Prisma.InputJsonValue,
        answerSources: sources as Prisma.InputJsonValue,
        status: nextId
          ? RecommendationFlowStatus.PROFILING
          : RecommendationFlowStatus.READY_TO_COMPARE,
        selectedParchinLevel: null,
        deliveryConfiguration: Prisma.DbNull,
        revision: { increment: 1 },
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    if (changed.count !== 1) {
      const latest = await tx.recommendationSession.findUniqueOrThrow({
        where: { id: session.id },
        select: { revision: true },
      });
      throw new ConversationRevisionConflictError(latest.revision);
    }

    const targetState =
      currentState === "DRAFT"
        ? "DRAFT"
        : nextId
          ? "UNDERSTANDING_CONFIRMED"
          : "REQUIREMENTS_COMPLETE";
    if (targetState !== currentState) {
      await transitionProductFlowTx(tx, {
        owner: resetOwner(session.id),
        from: currentState as Parameters<
          typeof transitionProductFlowTx
        >[1]["from"],
        to: targetState,
        reason: "conversation_answer_updated",
        idempotencyKey: `conversation-answer:${session.id}:${input.expectedRevision + 1}`,
        actorUserId: input.userId ?? null,
        metadata: { questionId: input.questionId },
      });
    }
  });

  return {
    sessionId: session.id,
    revision: input.expectedRevision + 1,
    answers,
    complete: nextId == null,
    nextQuestion: nextId
      ? getRecommendationQuestion(nextId, answers)
      : null,
  };
}

export async function confirmConversationUnderstanding(input: {
  sessionId: string;
  understanding: Prisma.InputJsonValue;
  expectedRevision: number;
  userId?: string | null;
  guestToken?: string | null;
}) {
  const session = await requireConversationAccess(input);
  if (session.revision !== input.expectedRevision) {
    throw new ConversationRevisionConflictError(session.revision);
  }
  if ((session.productFlowState ?? "DRAFT") !== "DRAFT") {
    throw new Error("conversation_state_conflict");
  }
  return prisma.$transaction(async (tx) => {
    const changed = await tx.recommendationSession.updateMany({
      where: { id: session.id, revision: input.expectedRevision },
      data: {
        understandingSnapshot: input.understanding,
        revision: { increment: 1 },
      },
    });
    if (changed.count !== 1) {
      const latest = await tx.recommendationSession.findUniqueOrThrow({
        where: { id: session.id },
        select: { revision: true },
      });
      throw new ConversationRevisionConflictError(latest.revision);
    }
    await transitionProductFlowTx(tx, {
      owner: resetOwner(session.id),
      from: "DRAFT",
      to: "UNDERSTANDING_CONFIRMED",
      reason: "customer_confirmed_understanding",
      idempotencyKey: `understanding:${session.id}:${input.expectedRevision + 1}`,
      actorUserId: input.userId ?? null,
    });
    return tx.recommendationSession.findUniqueOrThrow({
      where: { id: session.id },
    });
  });
}

export async function claimConversationSession(input: {
  sessionId: string;
  userId: string;
  guestToken: string;
}) {
  const session = await requireConversationAccess(input);
  if (session.userId && session.userId !== input.userId) {
    throw new Error("conversation_session_forbidden");
  }
  if (session.userId === input.userId) {
    return serializeConversationSession(session.id);
  }
  const changed = await prisma.recommendationSession.updateMany({
    where: {
      id: session.id,
      userId: null,
      guestAccessTokenHash: session.guestAccessTokenHash,
      revision: session.revision,
    },
    data: {
      userId: input.userId,
      guestAccessTokenHash: null,
      claimedAt: new Date(),
      revision: { increment: 1 },
    },
  });
  if (changed.count !== 1) {
    throw new ConversationRevisionConflictError(session.revision);
  }
  return serializeConversationSession(session.id);
}

export async function claimConversationByGuestToken(input: {
  userId: string;
  guestToken: string;
}) {
  const session = await prisma.recommendationSession.findFirst({
    where: {
      guestAccessTokenHash: tokenHash(input.guestToken),
      userId: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (!session) throw new Error("conversation_session_not_found");
  return claimConversationSession({
    sessionId: session.id,
    userId: input.userId,
    guestToken: input.guestToken,
  });
}
