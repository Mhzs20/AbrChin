import type { MetadataRoute } from "next";

const routes = ["", "/cloud-servers", "/compass", "/solutions", "/support", "/about", "/help"];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: `https://abrchin.ir${route}`,
    lastModified: new Date(),
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : route === "/cloud-servers" ? 0.9 : route === "/compass" ? 0.8 : 0.7,
  }));
}
