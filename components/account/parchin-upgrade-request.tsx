"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useToast } from "@/components/product/toast";

export function ParchinUpgradeRequest({
  enrollmentId,
  options,
}: {
  enrollmentId: string;
  options: Array<{ level: string; title: string; monthlyPriceTomanFa: string }>;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [requestedLevel, setRequestedLevel] = useState(options[0]?.level ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (options.length === 0) return null;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/account/parchin/${enrollmentId}/upgrade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedLevel }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "ثبت درخواست ممکن نشد.");
      showToast("درخواست ارتقای پرچین برای دوره بعد ثبت شد.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ثبت درخواست ممکن نشد.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="parchin-upgrade-request">
      <select
        aria-label="سطح جدید پرچین"
        value={requestedLevel}
        onChange={(event) => setRequestedLevel(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.level} value={option.level}>
            {option.title} · {option.monthlyPriceTomanFa} تومان در ماه
          </option>
        ))}
      </select>
      <button
        type="button"
        className="product-btn product-btn--primary"
        onClick={submit}
        disabled={busy}
      >
        {busy ? "در حال ثبت..." : "ثبت ارتقا برای دوره بعد"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
