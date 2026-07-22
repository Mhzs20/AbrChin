import type { MetadataRoute } from "next";

const routes = ["", "/compass", "/solutions", "/support", "/about", "/help"];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: `https://abrchin.ir${route}`,
    lastModified: new Date(),
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : route === "/compass" ? 0.9 : 0.7,
  }));
}
