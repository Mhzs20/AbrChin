import type { ParchinLevel } from "@prisma/client";

import type { RecommendationAnswers } from "@/lib/recommendation/types";

export const parchinLevels = [
  "PARCHIN_START",
  "PARCHIN_ACTIVE",
  "PARCHIN_STABLE",
] as const satisfies readonly ParchinLevel[];

export function parchinLevelRank(level: ParchinLevel): number {
  return parchinLevels.indexOf(level);
}

export function recommendedParchinLevel(
  answers: RecommendationAnswers,
): ParchinLevel {
  if (
    answers.criticality === "high" ||
    answers.criticality === "severe" ||
    (answers.project === "commerce" &&
      (answers.usage === "busy" || answers.stage === "growing"))
  ) {
    return "PARCHIN_STABLE";
  }
  if (
    answers.criticality === "medium" ||
    answers.project === "commerce" ||
    answers.project === "data" ||
    answers.architecture === "data_heavy" ||
    answers.stage === "active" ||
    answers.stage === "growing"
  ) {
    return "PARCHIN_ACTIVE";
  }
  return "PARCHIN_START";
}

export function assertParchinLevelAllowed(
  requested: ParchinLevel,
  minimum: ParchinLevel,
): void {
  if (parchinLevelRank(requested) < parchinLevelRank(minimum)) {
    throw new Error("parchin_level_below_minimum");
  }
}
