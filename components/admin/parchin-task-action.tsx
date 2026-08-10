"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { FormField } from "@/components/product";
import { useToast } from "@/components/product/toast";

const STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED", "COMPLETED", "CANCELED"] as const;

export function ParchinTaskAction({
  taskId,
  currentStatus,
  currentAssigneeId,
  assignees,
}: {
  taskId: string;
  currentStatus: string;
  currentAssigneeId: string | null;
  assignees: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(currentStatus);
  const [assignedToId, setAssignedToId] = useState(currentAssigneeId ?? "");
  const [evidenceSummary, setEvidenceSummary] = useState("");
  const [blockedReason, setBlockedReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/parchin/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          assignedToId: assignedToId || null,
          evidenceSummary:
            status === "COMPLETED" ? evidenceSummary : undefined,
          blockedReason: status === "BLOCKED" ? blockedReason : undefined,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "ذخیره وظیفه ممکن نشد.");
      showToast("وظیفه پرچین به‌روز شد.");
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ذخیره ممکن نشد.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="product-btn product-btn--quiet"
        onClick={() => setOpen(true)}
      >
        اقدام
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="parchin-inline-action">
      <FormField id={`task-status-${taskId}`} label="وضعیت">
        <select
          id={`task-status-${taskId}`}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {value === "TODO"
                ? "انجام‌نشده"
                : value === "IN_PROGRESS"
                  ? "در حال انجام"
                  : value === "BLOCKED"
                    ? "مسدود"
                    : value === "COMPLETED"
                      ? "تکمیل‌شده"
                      : "لغوشده"}
            </option>
          ))}
        </select>
      </FormField>
      <FormField id={`task-owner-${taskId}`} label="مسئول">
        <select
          id={`task-owner-${taskId}`}
          value={assignedToId}
          onChange={(event) => setAssignedToId(event.target.value)}
        >
          <option value="">تخصیص‌داده‌نشده</option>
          {assignees.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </FormField>
      {status === "COMPLETED" ? (
        <FormField id={`task-evidence-${taskId}`} label="شاهد و نتیجه">
          <textarea
            id={`task-evidence-${taskId}`}
            value={evidenceSummary}
            onChange={(event) => setEvidenceSummary(event.target.value)}
            maxLength={2000}
            rows={3}
            required
          />
        </FormField>
      ) : null}
      {status === "BLOCKED" ? (
        <FormField id={`task-blocked-${taskId}`} label="علت مسدودی">
          <textarea
            id={`task-blocked-${taskId}`}
            value={blockedReason}
            onChange={(event) => setBlockedReason(event.target.value)}
            maxLength={1000}
            rows={3}
            required
          />
        </FormField>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="product-btn product-btn--primary" disabled={busy}>
          {busy ? "در حال ذخیره..." : "ذخیره"}
        </button>
        <button
          type="button"
          className="product-btn product-btn--quiet"
          onClick={() => setOpen(false)}
        >
          بستن
        </button>
      </div>
    </form>
  );
}
