import { ParchinReportType } from "@prisma/client";

import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { createParchinReport } from "@/lib/parchin/service";
import { WalletError } from "@/lib/wallet/errors";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const admin = await requireAdminUser();
    const [{ id }, body] = await Promise.all([
      params,
      request.json() as Promise<Record<string, unknown>>,
    ]);
    const type =
      typeof body.type === "string" &&
      Object.values(ParchinReportType).includes(body.type as ParchinReportType)
        ? (body.type as ParchinReportType)
        : null;
    const periodStart =
      typeof body.periodStart === "string" ? new Date(body.periodStart) : null;
    const periodEnd =
      typeof body.periodEnd === "string" ? new Date(body.periodEnd) : null;
    if (
      !type ||
      !periodStart ||
      !periodEnd ||
      Number.isNaN(periodStart.getTime()) ||
      Number.isNaN(periodEnd.getTime())
    ) {
      return jsonError("نوع یا بازه گزارش معتبر نیست.", 400);
    }
    const rawMetrics =
      body.metrics && typeof body.metrics === "object" && !Array.isArray(body.metrics)
        ? (body.metrics as Record<string, unknown>)
        : {};
    const metricKeys = [
      "uptimePercent",
      "cpuAveragePercent",
      "ramPeakPercent",
      "diskUsedPercent",
      "backupSuccessRatePercent",
    ] as const;
    const metrics: Record<string, number | string> = {};
    for (const key of metricKeys) {
      const value = rawMetrics[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100) {
        metrics[key] = value;
      }
    }
    for (const key of ["backupStatus", "patchStatus", "restoreStatus"] as const) {
      const value = rawMetrics[key];
      if (typeof value === "string" && value.trim()) {
        metrics[key] = value.trim().slice(0, 160);
      }
    }
    const report = await createParchinReport({
      enrollmentId: id,
      adminUserId: admin.id,
      type,
      title: typeof body.title === "string" ? body.title : "",
      summary: typeof body.summary === "string" ? body.summary : "",
      periodStart,
      periodEnd,
      metrics,
      recommendations: Array.isArray(body.recommendations)
        ? body.recommendations.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      publish: body.publish === true,
    });
    return jsonOk({
      report: {
        id: report.id,
        status: report.status,
        publishedAt: report.publishedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    const access = adminApiError(error);
    if (access) return jsonError(access.message, access.status);
    if (error instanceof WalletError) {
      return jsonError(error.message, error.code === "not_found" ? 404 : 400);
    }
    return jsonError("ثبت گزارش پرچین ممکن نیست.", 500);
  }
}
