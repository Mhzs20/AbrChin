import type { Metadata } from "next";

import { ConversationBuilder } from "@/components/conversation-builder";
import { getEnv } from "@/lib/env";
import type { ProjectKind } from "@/lib/recommendation/types";

export const metadata: Metadata = {
  title: "گفت‌وگوی ساخت سرور | ابرچین",
  description:
    "نیازت را به زبان خودت بگو؛ ابرچین منابع، سطح همراهی و مسیر رشد مناسب سرور ابری را پیشنهاد می‌دهد.",
  alternates: { canonical: "/compass" },
};

const projects = new Set<ProjectKind>([
  "site",
  "commerce",
  "product",
  "api",
  "migration",
  "data",
  "other",
]);

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CompassPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawProject = firstValue(params.project);
  const initialProject =
    rawProject && projects.has(rawProject as ProjectKind)
      ? (rawProject as ProjectKind)
      : undefined;
  const resume = firstValue(params.resume) === "1";
  const env = getEnv();
  const parspackQuotesReady =
    env.parspackEnabled &&
    env.infrastructureProviderMode === "parspack" &&
    Boolean(env.parspackApiToken);

  return (
    <ConversationBuilder
      initialProject={initialProject}
      resume={resume}
      parspackQuotesReady={parspackQuotesReady}
    />
  );
}
