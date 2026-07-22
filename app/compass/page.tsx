import type { Metadata } from "next";

import { CompassWizard, type CompassAnswers } from "@/components/compass-wizard";

export const metadata: Metadata = {
  title: "قطب‌نما | ابرچین",
  description: "با چند سؤال کوتاه، نقطه شروع مناسب زیرساخت پروژه‌ات را پیدا کن.",
  alternates: { canonical: "/compass" },
};

const allowed: Record<keyof CompassAnswers, string[]> = {
  project: ["site", "commerce", "product", "api", "migration", "unsure"],
  stage: ["building", "launch", "active", "growing"],
  scale: ["starting", "light", "daily", "heavy", "unsure"],
  management: ["raw", "ready", "managed"],
  priority: ["economy", "speed", "stability", "growth"],
  location: ["iran", "europe", "both", "unsure"],
};

export default async function CompassPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const initialAnswers: CompassAnswers = {};

  (Object.keys(allowed) as (keyof CompassAnswers)[]).forEach((key) => {
    const value = params[key];
    if (typeof value === "string" && allowed[key].includes(value)) {
      initialAnswers[key] = value;
    }
  });

  return <CompassWizard initialAnswers={initialAnswers} />;
}
