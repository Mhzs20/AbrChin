import type { Metadata } from "next";

import { ConversationBuilder } from "@/components/conversation-builder";
import type { ManagementKind, ProjectKind } from "@/lib/recommendation/types";
import { getCurrentUser } from "@/lib/session";

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
const managementModes = new Set<Exclude<ManagementKind, "unknown">>(["raw", "managed"]);

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
  const rawManagement = firstValue(params.management);
  const initialManagement =
    rawManagement &&
    managementModes.has(rawManagement as Exclude<ManagementKind, "unknown">)
      ? (rawManagement as Exclude<ManagementKind, "unknown">)
      : undefined;
  const resume = firstValue(params.resume) === "1";
  const user = await getCurrentUser();

  return (
    <ConversationBuilder
      initialProject={initialProject}
      initialManagement={initialManagement}
      resume={resume}
      signedIn={Boolean(user)}
    />
  );
}
