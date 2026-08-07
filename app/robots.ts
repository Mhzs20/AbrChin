import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/admin/",
        "/account",
        "/account/",
        "/api",
        "/api/",
        "/login",
        "/login/",
        "/cloud-servers/quote",
        "/ready-servers/quote",
        "/account/order",
      ],
    },
    sitemap: "https://abrchin.ir/sitemap.xml",
  };
}
