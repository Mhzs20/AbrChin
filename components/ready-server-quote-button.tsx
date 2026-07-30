"use client";

import { ArrowLeft, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReadyServerQuoteButton({
  planId,
  productPath = "cloud-servers",
}: {
  planId: string;
  productPath?: "cloud-servers" | "ready-servers";
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function createQuote() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/${productPath}/quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const body = (await response.json()) as {
        error?: string;
        quote?: { id?: string };
      };
      if (!response.ok || !body.quote?.id) {
        throw new Error(body.error ?? "دریافت قیمت زنده ممکن نشد.");
      }
      router.push(`/${productPath}/quote/${body.quote.id}`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "دریافت قیمت زنده ممکن نشد.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ready-server-quote-action">
      <button
        className="button button-primary"
        disabled={loading}
        onClick={createQuote}
        type="button"
      >
        {loading ? (
          <>
            <LoaderCircle className="ready-server-spinner" size={17} aria-hidden="true" />
            بررسی قیمت و ظرفیت
          </>
        ) : (
          <>
            دریافت Quote
            <ArrowLeft size={17} aria-hidden="true" />
          </>
        )}
      </button>
      {error ? <small role="alert">{error}</small> : null}
    </div>
  );
}
