import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { jsonError, rejectCrossOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Legacy provider-markup write path.
 *
 * Blocked: writing markup here skips FinanceConfigurationRevision, margin
 * guardrails, and card/quote parity. Use the atomic Financial Center API.
 */
export async function PATCH(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    await requireAdminUser();
    return jsonError(
      "این مسیر Markup منسوخ شده است. حاشیه سود منبع را فقط از مرکز مالی (/api/admin/finance/configuration) ذخیره کن.",
      410,
      { code: "legacy_markup_endpoint_retired" },
    );
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    console.error(
      "[admin/providers/markup]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("ذخیره Markup ممکن نیست.", 500);
  }
}
