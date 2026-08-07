"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

/**
 * Explicit customer action to re-price an expired quote.
 * Must never run as a side effect of GET/page render.
 */
export function QuoteExpiredRefresh({
  quoteId,
  catalogHref,
  quoteBasePath,
  refreshApiPath,
}: {
  quoteId: string;
  catalogHref: string;
  quoteBasePath: string;
  refreshApiPath: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);

  async function refresh() {
    if (inFlight.current || pending) return;
    inFlight.current = true;
    setError(null);
    try {
      const response = await fetch(refreshApiPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `quote-refresh-ui:${quoteId}`,
        },
        body: JSON.stringify({}),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        quote?: { id?: string };
      };
      if (!response.ok || !body.quote?.id) {
        throw new Error(body.error ?? "به‌روزرسانی قیمت ممکن نیست.");
      }
      startTransition(() => {
        router.replace(`${quoteBasePath}/${body.quote!.id}?renewed=1`);
        router.refresh();
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "به‌روزرسانی قیمت ممکن نیست.",
      );
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <section className="ready-quote-page page-view" aria-labelledby="quote-expired-title">
      <header className="ready-quote-heading">
        <div>
          <span className="eyebrow">پیش‌فاکتور منقضی</span>
          <h1 id="quote-expired-title">اعتبار این قیمت قفل‌شده تمام شده</h1>
          <p>
            برای ادامه خرید باید قیمت را با نرخ فعلی دوباره قفل کنی. مشاهدهٔ صفحه
            به‌تنهایی قیمت تازه نمی‌سازد.
          </p>
        </div>
        <Link className="button button-quiet" href={catalogHref}>
          بازگشت به فهرست
        </Link>
      </header>
      <aside className="ready-quote-checkout">
        {error ? <p role="alert">{error}</p> : null}
        <button
          type="button"
          className="button button-primary"
          disabled={pending}
          onClick={() => void refresh()}
        >
          {pending ? "در حال به‌روزرسانی…" : "به‌روزرسانی قیمت"}
        </button>
      </aside>
    </section>
  );
}
