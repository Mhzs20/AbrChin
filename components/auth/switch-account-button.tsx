"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SwitchAccountButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function switchAccount() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      className="product-btn product-btn--quiet"
      disabled={loading}
      onClick={switchAccount}
    >
      {loading ? "در حال خروج…" : "ورود با حساب دیگر"}
    </button>
  );
}
