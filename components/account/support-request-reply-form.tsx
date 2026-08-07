"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { FormField, SectionCard } from "@/components/product";
import { useToast } from "@/components/product/toast";

export function SupportRequestReplyForm({
  requestId,
  closed,
}: {
  requestId: string;
  closed: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (closed) {
    return (
      <SectionCard title="پاسخ">
        <p style={{ margin: 0, color: "var(--product-muted)" }}>
          این درخواست بسته‌شده یا حل‌شده است و پیام جدید نمی‌پذیرد.
        </p>
      </SectionCard>
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/account/support-requests/${requestId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "ارسال پیام ممکن نشد.");
      }
      setBody("");
      showToast("پیام ارسال شد.");
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "ارسال پیام ممکن نشد.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="ارسال پیام">
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <FormField id="support-reply" label="پیام شما">
          <textarea
            id="support-reply"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={4000}
            required
          />
        </FormField>
        {error ? (
          <p style={{ margin: 0, color: "crimson", fontSize: 13 }}>{error}</p>
        ) : null}
        <button
          type="submit"
          className="product-btn product-btn--primary"
          disabled={busy || !body.trim()}
          style={{ justifySelf: "start" }}
        >
          {busy ? "در حال ارسال..." : "ارسال"}
        </button>
      </form>
    </SectionCard>
  );
}
