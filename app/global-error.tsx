"use client";

import { ArrowLeft, Cloud } from "lucide-react";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="fa" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          fontFamily:
            "Vazirmatn, Tahoma, system-ui, -apple-system, sans-serif",
          background: "linear-gradient(180deg, #f4f7fd 0%, #eef3fb 100%)",
          color: "#102d56",
        }}
      >
        <section
          className="brand-error-page"
          role="alert"
          style={{
            display: "flex",
            minHeight: "100dvh",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: 10,
            textAlign: "center",
            padding: 32,
          }}
        >
          <span
            style={{
              display: "grid",
              width: 76,
              height: 76,
              placeItems: "center",
              borderRadius: 23,
              background: "#e7f0ff",
              color: "#1d72f3",
            }}
          >
            <Cloud size={34} aria-hidden="true" />
          </span>
          <small style={{ color: "#0f5ed6", fontWeight: 800 }}>خطای سامانه</small>
          <h1 style={{ margin: 0, fontSize: 28, color: "#061f45" }}>
            ابرچین الان پاسخ نداد.
          </h1>
          <p style={{ margin: 0, maxWidth: 420, color: "#5b6f8c", lineHeight: 1.8 }}>
            یک خطای سراسری رخ داد. لطفاً دوباره تلاش کن یا به صفحه خانه برگرد.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                display: "inline-flex",
                minHeight: 46,
                alignItems: "center",
                justifyContent: "center",
                gap: 9,
                padding: "0 19px",
                border: "1px solid rgba(15, 84, 188, 0.25)",
                borderRadius: 14,
                background: "linear-gradient(135deg, #1d72f3, #0f5ed6)",
                color: "#fff",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              تلاش دوباره
            </button>
            {/* global-error replaces the root layout; prefer hard navigation over next/link */}
            <button
              type="button"
              onClick={() => {
                window.location.href = "/";
              }}
              style={{
                display: "inline-flex",
                minHeight: 46,
                alignItems: "center",
                justifyContent: "center",
                gap: 9,
                padding: "0 19px",
                border: "1px solid rgba(20, 58, 107, 0.12)",
                borderRadius: 14,
                background: "#fff",
                color: "#0b2a55",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              برگشت به خانه
              <ArrowLeft size={18} aria-hidden="true" />
            </button>
          </div>
        </section>
      </body>
    </html>
  );
}
