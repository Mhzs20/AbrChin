import type {
  AnswerSource,
  AnswerSources,
  QuestionId,
  RecommendationAnswers,
} from "@/lib/recommendation/types";
import { getRecommendationQuestionOrder } from "@/lib/recommendation/questions";

const allowedAnswers: Record<QuestionId, readonly string[]> = {
  project: ["site", "commerce", "product", "api", "migration", "data", "other"],
  audience: ["iran", "mixed", "abroad", "unknown"],
  stage: ["idea", "launch", "active", "growing", "migration"],
  usage: ["starting", "light", "daily", "busy", "unknown"],
  architecture: ["single", "app_db", "multi_service", "data_heavy", "unknown"],
  storage: ["small", "medium", "large", "unknown"],
  growth: ["stable", "campaign", "rapid", "unknown"],
  downtime: ["flexible", "short", "near_zero", "unknown"],
  criticality: ["low", "medium", "high", "severe", "unknown"],
  management: ["managed", "unknown"],
};

const questionIds = Object.keys(allowedAnswers) as QuestionId[];
const allowedSources: AnswerSource[] = ["user", "estimate", "default"];

export function validateRecommendationAnswer(
  questionId: QuestionId,
  value: unknown,
): string {
  if (
    typeof value !== "string" ||
    !allowedAnswers[questionId].includes(value)
  ) {
    throw new Error(`invalid_recommendation_answer:${questionId}`);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function parseRecommendationInput(value: unknown): {
  answers: RecommendationAnswers;
  sources: AnswerSources;
} {
  const payload = asRecord(value);
  const rawAnswers = asRecord(payload.answers);
  const rawSources = asRecord(payload.sources);
  const answers: Record<string, string> = {};
  const sources: Record<string, AnswerSource> = {};

  for (const questionId of questionIds) {
    const answer = rawAnswers[questionId];
    if (answer === undefined) continue;
    if (typeof answer !== "string" || !allowedAnswers[questionId].includes(answer)) {
      throw new Error(`invalid_recommendation_answer:${questionId}`);
    }
    answers[questionId] = answer;

    const source = rawSources[questionId];
    sources[questionId] =
      typeof source === "string" && allowedSources.includes(source as AnswerSource)
        ? (source as AnswerSource)
        : "user";
  }

  const requiredQuestionIds = getRecommendationQuestionOrder(answers as RecommendationAnswers);
  for (const questionId of requiredQuestionIds) {
    if (!answers[questionId]) {
      throw new Error(`invalid_recommendation_answer:${questionId}`);
    }
  }

  return {
    answers: answers as RecommendationAnswers,
    sources: sources as AnswerSources,
  };
}
