"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { FormField, SectionCard } from "@/components/product";
import { useToast } from "@/components/product/toast";
import { SUPPORT_STATUS_LABELS } from "@/lib/labels/customer";

const STATUSES = Object.keys(SUPPORT_STATUS_LABELS);

export function AdminSupportRequestPanel({
  requestId,
  currentStatus,
}: {
  requestId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [status, setStatus] = useState(currentStatus);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/support-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          reply: reply.trim() ? reply : undefined,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "به‌روزرسانی ممکن نشد.");
      }
      setReply("");
      showToast("درخواست پشتیبانی به‌روز شد.");
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "به‌روزرسانی ممکن نشد.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="پاسخ و وضعیت">
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, maxWidth: 560 }}>
        <FormField id="admin-support-status" label="وضعیت">
          <select
            id="admin-support-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUSES.map((key) => (
              <option key={key} value={key}>
                {SUPPORT_STATUS_LABELS[key]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="admin-support-reply" label="پاسخ (اختیاری)">
          <textarea
            id="admin-support-reply"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={5}
            maxLength={4000}
          />
        </FormField>
        {error ? (
          <p style={{ margin: 0, color: "crimson", fontSize: 13 }}>{error}</p>
        ) : null}
        <button
          type="submit"
          className="product-btn product-btn--primary"
          disabled={busy}
          style={{ justifySelf: "start" }}
        >
          {busy ? "در حال ذخیره..." : "ذخیره"}
        </button>
      </form>
    </SectionCard>
  );
}
