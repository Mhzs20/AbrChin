"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Old combined Providers page used #pricing / #regions anchors. */
export function LegacyProvidersHashRedirect() {
  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (hash === "pricing") {
      router.replace("/admin/infrastructure/pricing");
      return;
    }
    if (hash === "regions") {
      router.replace("/admin/infrastructure/regions");
    }
  }, [router]);

  return null;
}
