"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function OrderStatusRefresh() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [refreshed, setRefreshed] = useState(false);

  return (
    <div>
      <button
        type="button"
        className="product-btn product-btn--quiet"
        disabled={isPending}
        onClick={() => {
          setRefreshed(false);
          startTransition(() => {
            router.refresh();
            setRefreshed(true);
          });
        }}
      >
        <RefreshCw size={16} aria-hidden="true" />
        {isPending ? "در حال به‌روزرسانی…" : "به‌روزرسانی وضعیت"}
      </button>
      <span className="sr-only" aria-live="polite">
        {refreshed ? "آخرین وضعیت سفارش دریافت شد." : ""}
      </span>
    </div>
  );
}
