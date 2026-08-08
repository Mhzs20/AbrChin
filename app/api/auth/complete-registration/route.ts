import { panelApiError, requireAuthenticatedCustomer } from "@/lib/auth/guards";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { completeCustomerRegistration } from "@/lib/identity/registration";
import { WalletError } from "@/lib/wallet/errors";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const current = await requireAuthenticatedCustomer();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("درخواست نامعتبر است.", 400);
    }

    const payload =
      typeof body === "object" && body ? (body as Record<string, unknown>) : {};

    const user = await completeCustomerRegistration({
      userId: current.id,
      firstName: payload.firstName,
      lastName: payload.lastName,
      email: payload.email,
    });

    return jsonOk({ ok: true, user });
  } catch (error) {
    const accessError = panelApiError(error);
    if (accessError) return jsonError(accessError.message, accessError.status);
    if (error instanceof WalletError) {
      const status =
        error.code === "email_taken"
          ? 409
          : error.code === "registration_already_complete"
            ? 409
            : 400;
      return jsonError(error.message, status, { code: error.code });
    }
    console.error(
      "[auth/complete-registration]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("تکمیل ثبت‌نام ممکن نشد.", 500);
  }
}
