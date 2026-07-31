import type { RecommendationAnswers } from "@/lib/recommendation/types";

export const workloadClassifications = [
  "GENERAL_LINUX",
  "WINDOWS",
  "WEB_APPLICATION",
  "ECOMMERCE",
  "DATABASE",
  "CONTAINER",
  "API",
  "WORKER",
  "AI_LIGHT",
  "CUSTOM",
] as const;

export type WorkloadClassification =
  (typeof workloadClassifications)[number];

/**
 * This is support metadata, not a product or a price modifier. It is derived
 * deterministically from answers and can later be refined by the selected OS.
 */
export function classifyWorkload(
  answers: RecommendationAnswers,
): WorkloadClassification {
  if (answers.project === "commerce") return "ECOMMERCE";
  if (answers.project === "api") return "API";
  if (
    answers.project === "data" &&
    answers.architecture === "data_heavy"
  ) {
    return "DATABASE";
  }
  if (answers.project === "data") return "WORKER";
  if (
    answers.project === "site" ||
    answers.project === "product"
  ) {
    return "WEB_APPLICATION";
  }
  if (answers.project === "migration") return "CUSTOM";
  return "GENERAL_LINUX";
}
