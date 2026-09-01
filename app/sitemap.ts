import type { MetadataRoute } from "next";

import { isLegalLaunchReady } from "@/lib/legal/config";

const publicRoutes = [
  "",
  "/cloud-servers",
  "/compass",
  "/solutions",
  "/support",
  "/about",
  "/help",
  "/status",
];

const legalRoutes = [
  "/terms",
  "/privacy",
  "/refund-policy",
  "/service-policy",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = isLegalLaunchReady()
    ? [...publicRoutes, ...legalRoutes]
    : publicRoutes;
  return routes.map((route) => ({
    url: `https://abrchin.ir${route}`,
    lastModified: new Date(),
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority:
      route === ""
        ? 1
        : route === "/cloud-servers"
          ? 0.9
          : route === "/compass"
            ? 0.8
            : 0.7,
  }));
}
