import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import {
  RecommendationFlowStatus,
  RecommendationQuoteStatus,
  type Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db";
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

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokenMatches(token: string, expectedHash: string): boolean {
  const received = Buffer.from(tokenHash(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return (
    received.length === expected.length &&
    timingSafeEqual(received, expected)
  );
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

export async function updateConversationAnswer(input: {
  sessionId: string;
  questionId: QuestionId;
  answer: unknown;
  source?: "user" | "estimate" | "default";
  userId?: string | null;
  guestToken?: string | null;
}) {
  const session = await requireConversationAccess(input);
  const answer = validateRecommendationAnswer(
    input.questionId,
    input.answer,
  );
  const answers = {
    ...(session.answers as RecommendationAnswers),
    [input.questionId]: answer,
  };
  const sources = {
    ...(session.answerSources as AnswerSources),
    [input.questionId]: input.source ?? "user",
  };
  const order = getRecommendationQuestionOrder(answers);
  const nextId = order.find((questionId) => !answers[questionId]) ?? null;

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
    const currentState = session.productFlowState ?? "DRAFT";
    const targetState =
      currentState === "DRAFT"
        ? "DRAFT"
        : nextId
          ? "UNDERSTANDING_CONFIRMED"
          : "REQUIREMENTS_COMPLETE";
    await tx.recommendationSession.update({
      where: { id: session.id },
      data: {
        answers: answers as Prisma.InputJsonValue,
        answerSources: sources as Prisma.InputJsonValue,
        status: nextId
          ? RecommendationFlowStatus.PROFILING
          : RecommendationFlowStatus.READY_TO_COMPARE,
        productFlowState: targetState,
        revision: { increment: 1 },
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    if (targetState !== currentState) {
      await tx.productFlowTransition.create({
        data: {
          recommendationSessionId: session.id,
          fromState: currentState,
          toState: targetState,
          reason: "conversation_answer_updated",
          idempotencyKey: `conversation-answer:${session.id}:${session.revision + 1}`,
        },
      });
    }
  });

  return {
    sessionId: session.id,
    revision: session.revision + 1,
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
  userId?: string | null;
  guestToken?: string | null;
}) {
  const session = await requireConversationAccess(input);
  if (session.productFlowState === "UNDERSTANDING_CONFIRMED") return session;
  if ((session.productFlowState ?? "DRAFT") !== "DRAFT") {
    throw new Error("conversation_state_conflict");
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.recommendationSession.update({
      where: { id: session.id },
      data: {
        understandingSnapshot: input.understanding,
        productFlowState: "UNDERSTANDING_CONFIRMED",
        revision: { increment: 1 },
      },
    });
    await tx.productFlowTransition.create({
      data: {
        recommendationSessionId: session.id,
        fromState: "DRAFT",
        toState: "UNDERSTANDING_CONFIRMED",
        reason: "customer_confirmed_understanding",
        idempotencyKey: `understanding:${session.id}:${session.revision + 1}`,
      },
    });
    return updated;
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
  return prisma.recommendationSession.update({
    where: { id: session.id },
    data: {
      userId: input.userId,
      guestAccessTokenHash: null,
      claimedAt: new Date(),
    },
  });
}
