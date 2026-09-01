import type { ParchinLevel } from "@prisma/client";

import { parchinLevelLabel as fallbackParchinLevelLabel } from "@/lib/parchin/catalog";

export type ParchinLevelLabels = Record<ParchinLevel, string>;

const levels: ParchinLevel[] = [
  "PARCHIN_START",
  "PARCHIN_ACTIVE",
  "PARCHIN_STABLE",
];

export function defaultParchinLevelLabels(): ParchinLevelLabels {
  return {
    PARCHIN_START: fallbackParchinLevelLabel("PARCHIN_START"),
    PARCHIN_ACTIVE: fallbackParchinLevelLabel("PARCHIN_ACTIVE"),
    PARCHIN_STABLE: fallbackParchinLevelLabel("PARCHIN_STABLE"),
  };
}

export function resolveParchinLevelLabel(
  level: ParchinLevel | null | undefined,
  labels?: Partial<ParchinLevelLabels> | null,
) {
  if (level && labels?.[level]) return labels[level]!;
  return fallbackParchinLevelLabel(level);
}

export function activeParchinLevelsFromLabels(
  labels: ParchinLevelLabels,
  active?: Partial<Record<ParchinLevel, boolean>>,
) {
  return levels.filter((level) => active?.[level] !== false);
}
