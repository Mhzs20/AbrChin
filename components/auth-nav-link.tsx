"use client";

import { UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type MeResponse = {
  user?: {
    id: string;
    role: "ADMIN" | "CUSTOMER";
  };
};

export function AuthNavLink() {
  const pathname = usePathname();
  const [role, setRole] = useState<"ADMIN" | "CUSTOMER" | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        if (cancelled) return;
        if (!response.ok) {
          setRole(null);
          return;
        }
        const data = (await response.json()) as MeResponse;
        setRole(data.user?.role ?? null);
      } catch {
        if (!cancelled) setRole(null);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const href = role === "ADMIN" ? "/admin" : role === "CUSTOMER" ? "/account" : "/login";
  const label = role === "ADMIN" ? "پنل مدیریت" : role === "CUSTOMER" ? "حساب من" : "ورود";

  return (
    <Link
      className="button button-quiet button-compact auth-nav-link"
      href={href}
      aria-label={label}
    >
      <UserRound size={16} aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}
