import type { MetadataRoute } from "next";

const routes = [
  "",
  "/cloud-servers",
  "/compass",
  "/solutions",
  "/support",
  "/about",
  "/help",
  "/status",
  "/terms",
  "/privacy",
  "/refund-policy",
  "/service-policy",
];

export default function sitemap(): MetadataRoute.Sitemap {
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
            : route === "/terms" ||
                route === "/privacy" ||
                route === "/refund-policy" ||
                route === "/service-policy"
              ? 0.5
              : 0.7,
  }));
}
