import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import {
  createPlanBillingPolicyVersion,
  parsePlanBillingPolicyInput,
} from "@/lib/billing/policy-admin";
import {
  jsonError,
  jsonOk,
  readIdempotencyKey,
  rejectCrossOrigin,
} from "@/lib/http";
import { isIdempotencyConflictError } from "@/lib/idempotency";
import { readRequestMeta } from "@/lib/session";
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
    const idempotencyKey = readIdempotencyKey(request);
    if (!idempotencyKey) {
      return jsonError("شناسه یکتای درخواست الزامی است.", 400);
    }
    const body = (await request.json()) as Record<string, unknown>;
    const policy = parsePlanBillingPolicyInput(body);
    const { id } = await params;
    const meta = await readRequestMeta(request);
    const result = await createPlanBillingPolicyVersion({
      planId: id,
      actorUserId: admin.id,
      policy,
      idempotencyKey,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return jsonOk(result);
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    if (isIdempotencyConflictError(error)) {
      return jsonError("شناسه یکتا با درخواست قبلی تعارض دارد.", 409);
    }
    if (error instanceof WalletError) {
      return jsonError(error.message, 409, { code: error.code });
    }
    console.error(
      "[admin/billing-policy]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("ذخیره Billing Policy ممکن نیست.", 500);
  }
}
