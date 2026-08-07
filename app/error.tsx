"use client";

import { ArrowLeft, Cloud } from "lucide-react";
import Link from "next/link";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="brand-error-page page-view" role="alert">
      <span>
        <Cloud size={34} aria-hidden="true" />
      </span>
      <small>خطای موقت</small>
      <h1>نمایش این صفحه الان ممکن نشد.</h1>
      <p>
        یک اختلال کوتاه رخ داد. می‌توانی دوباره تلاش کنی یا به خانه برگردی.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        <button type="button" className="button button-primary" onClick={reset}>
          تلاش دوباره
        </button>
        <Link className="button button-quiet" href="/">
          برگشت به خانه
          <ArrowLeft size={18} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
