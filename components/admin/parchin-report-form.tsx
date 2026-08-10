"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { FormField, SectionCard } from "@/components/product";
import { useToast } from "@/components/product/toast";

const REPORT_TYPES = ["HEALTH", "OPERATIONS", "RESTORE", "SECURITY", "CAPACITY", "INCIDENT"] as const;

export function ParchinReportForm({
  enrollmentId,
  defaultPeriodStart,
  defaultPeriodEnd,
}: {
  enrollmentId: string;
  defaultPeriodStart: string;
  defaultPeriodEnd: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [type, setType] = useState<(typeof REPORT_TYPES)[number]>("HEALTH");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [uptimePercent, setUptimePercent] = useState("");
  const [cpuAveragePercent, setCpuAveragePercent] = useState("");
  const [ramPeakPercent, setRamPeakPercent] = useState("");
  const [diskUsedPercent, setDiskUsedPercent] = useState("");
  const [backupSuccessRatePercent, setBackupSuccessRatePercent] = useState("");
  const [backupStatus, setBackupStatus] = useState("");
  const [patchStatus, setPatchStatus] = useState("");
  const [restoreStatus, setRestoreStatus] = useState("");
  const [periodStart, setPeriodStart] = useState(defaultPeriodStart);
  const [periodEnd, setPeriodEnd] = useState(defaultPeriodEnd);
  const [publish, setPublish] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/parchin/enrollments/${enrollmentId}/reports`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            title,
            summary,
            periodStart: new Date(`${periodStart}T00:00:00+03:30`).toISOString(),
            periodEnd: new Date(`${periodEnd}T23:59:59+03:30`).toISOString(),
            metrics: {
              ...(uptimePercent ? { uptimePercent: Number(uptimePercent) } : {}),
              ...(cpuAveragePercent ? { cpuAveragePercent: Number(cpuAveragePercent) } : {}),
              ...(ramPeakPercent ? { ramPeakPercent: Number(ramPeakPercent) } : {}),
              ...(diskUsedPercent ? { diskUsedPercent: Number(diskUsedPercent) } : {}),
              ...(backupSuccessRatePercent
                ? { backupSuccessRatePercent: Number(backupSuccessRatePercent) }
                : {}),
              ...(backupStatus ? { backupStatus } : {}),
              ...(patchStatus ? { patchStatus } : {}),
              ...(restoreStatus ? { restoreStatus } : {}),
            },
            recommendations: recommendations
              .split("\n")
              .map((item) => item.trim())
              .filter(Boolean),
            publish,
          }),
        },
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "ثبت گزارش ممکن نشد.");
      setTitle("");
      setSummary("");
      setRecommendations("");
      showToast(publish ? "گزارش برای مشتری منتشر شد." : "پیش‌نویس گزارش ذخیره شد.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ثبت گزارش ممکن نشد.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="ثبت گزارش پرچین">
      <form onSubmit={submit} className="parchin-report-form">
        <FormField id="parchin-report-type" label="نوع گزارش">
          <select
            id="parchin-report-type"
            value={type}
            onChange={(event) => setType(event.target.value as typeof type)}
          >
            {REPORT_TYPES.map((value) => (
              <option key={value} value={value}>
                {value === "HEALTH"
                  ? "سلامت"
                  : value === "OPERATIONS"
                    ? "عملیات"
                    : value === "RESTORE"
                      ? "Restore"
                      : value === "SECURITY"
                        ? "امنیت"
                        : value === "CAPACITY"
                          ? "ظرفیت"
                          : "رخداد"}
              </option>
            ))}
          </select>
        </FormField>
        <div className="parchin-report-period">
          <FormField id="parchin-report-start" label="شروع بازه">
            <input
              id="parchin-report-start"
              type="date"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
              required
            />
          </FormField>
          <FormField id="parchin-report-end" label="پایان بازه">
            <input
              id="parchin-report-end"
              type="date"
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.target.value)}
              required
            />
          </FormField>
        </div>
        <FormField id="parchin-report-title" label="عنوان">
          <input
            id="parchin-report-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={160}
            required
          />
        </FormField>
        <FormField id="parchin-report-summary" label="خلاصه نتیجه">
          <textarea
            id="parchin-report-summary"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={6}
            maxLength={8000}
            required
          />
        </FormField>
        <fieldset className="parchin-report-metrics">
          <legend>شاخص‌های قابل مشاهده مشتری</legend>
          {[
            ["parchin-report-uptime", "Uptime (%)", uptimePercent, setUptimePercent],
            ["parchin-report-cpu", "میانگین CPU (%)", cpuAveragePercent, setCpuAveragePercent],
            ["parchin-report-ram", "اوج RAM (%)", ramPeakPercent, setRamPeakPercent],
            ["parchin-report-disk", "فضای Disk مصرف‌شده (%)", diskUsedPercent, setDiskUsedPercent],
            ["parchin-report-backup-rate", "موفقیت بکاپ (%)", backupSuccessRatePercent, setBackupSuccessRatePercent],
          ].map(([id, label, value, setter]) => (
            <FormField key={id as string} id={id as string} label={label as string}>
              <input
                id={id as string}
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={value as string}
                onChange={(event) => (setter as (next: string) => void)(event.target.value)}
              />
            </FormField>
          ))}
          <FormField id="parchin-report-backup-status" label="وضعیت بکاپ">
            <input id="parchin-report-backup-status" value={backupStatus} onChange={(event) => setBackupStatus(event.target.value)} maxLength={160} placeholder="مثلاً موفق؛ آخرین نسخه ۰۲:۰۰" />
          </FormField>
          <FormField id="parchin-report-patch-status" label="وضعیت Patch">
            <input id="parchin-report-patch-status" value={patchStatus} onChange={(event) => setPatchStatus(event.target.value)} maxLength={160} placeholder="مثلاً به‌روز؛ بدون Patch معوق" />
          </FormField>
          <FormField id="parchin-report-restore-status" label="وضعیت Restore">
            <input id="parchin-report-restore-status" value={restoreStatus} onChange={(event) => setRestoreStatus(event.target.value)} maxLength={160} placeholder="مثلاً آزمون موفق در محیط ایزوله" />
          </FormField>
        </fieldset>
        <FormField
          id="parchin-report-recommendations"
          label="اقدام‌های پیشنهادی"
          hint="هر پیشنهاد در یک خط"
        >
          <textarea
            id="parchin-report-recommendations"
            value={recommendations}
            onChange={(event) => setRecommendations(event.target.value)}
            rows={4}
          />
        </FormField>
        <label className="parchin-report-publish">
          <input
            type="checkbox"
            checked={publish}
            onChange={(event) => setPublish(event.target.checked)}
          />
          همین حالا در پنل مشتری منتشر شود
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button className="product-btn product-btn--primary" disabled={busy}>
          {busy ? "در حال ثبت..." : publish ? "ثبت و انتشار" : "ذخیره پیش‌نویس"}
        </button>
      </form>
    </SectionCard>
  );
}
