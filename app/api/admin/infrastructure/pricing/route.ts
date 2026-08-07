import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { jsonError, rejectCrossOrigin } from "@/lib/http";

/**
 * Legacy commerce pricing write path.
 *
 * Blocked: independent writes here diverge from FinanceConfigurationRevision
 * and can leave tax / product markup / Parchin half-synced with provider
 * margins. All Admin finance mutation must go through the atomic Financial
 * Center endpoint.
 */
export async function PATCH(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    await requireAdminUser();
    return jsonError(
      "این مسیر قیمت‌گذاری منسوخ شده است. تنظیمات مالی را فقط از مرکز مالی (/api/admin/finance/configuration) ذخیره کن.",
      410,
      { code: "legacy_pricing_endpoint_retired" },
    );
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    return jsonError("ذخیره تنظیمات مالی ممکن نیست.", 500);
  }
}
