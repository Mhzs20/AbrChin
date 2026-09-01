import { prisma } from "@/lib/db";
import {
  defaultParchinLevelLabels,
  type ParchinLevelLabels,
} from "@/lib/parchin/labels";

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
    // Names stay catalog defaults. Availability/sale is fail-closed elsewhere.
  }
  return labels;
}
