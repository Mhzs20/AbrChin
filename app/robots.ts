import type { MetadataRoute } from "next";

import { isLegalLaunchReady } from "@/lib/legal/config";

export default function robots(): MetadataRoute.Robots {
  const legalDisallow = isLegalLaunchReady()
    ? []
    : ["/terms", "/privacy", "/refund-policy", "/service-policy"];
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
        ...legalDisallow,
      ],
    },
    sitemap: "https://abrchin.ir/sitemap.xml",
  };
}
