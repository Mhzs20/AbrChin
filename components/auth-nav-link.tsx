"use client";

import { UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type MeResponse = {
  user?: {
    id: string;
  };
};

export function AuthNavLink() {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        if (cancelled) return;
        if (!response.ok) {
          setSignedIn(false);
          return;
        }
        const data = (await response.json()) as MeResponse;
        setSignedIn(Boolean(data.user));
      } catch {
        if (!cancelled) setSignedIn(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const href = signedIn ? "/account" : "/login";
  const label = signedIn ? "حساب من" : "ورود";

  return (
    <Link
      className="button button-quiet button-compact auth-nav-link"
      href={href}
      aria-label={label}
    >
      <UserRound size={16} aria-hidden="true" />
      <span>{signedIn === null ? "ورود" : label}</span>
    </Link>
  );
}
