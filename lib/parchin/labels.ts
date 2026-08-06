import type { ParchinLevel } from "@prisma/client";

import { prisma } from "@/lib/db";
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

/** Admin-configured titles (customer-facing). Falls back to catalog defaults. */
export async function listParchinLevelLabels(): Promise<ParchinLevelLabels> {
  const labels = defaultParchinLevelLabels();
  try {
    const rows = await prisma.parchinPricingConfig.findMany({
      select: { level: true, title: true, active: true },
      orderBy: { sortOrder: "asc" },
    });
    for (const row of rows) {
      const title = row.title.trim();
      if (title) labels[row.level] = title;
    }
  } catch {
    // Fail open to defaults so storefront/Compass still render.
  }
  return labels;
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
