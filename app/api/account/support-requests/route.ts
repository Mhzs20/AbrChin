import { panelApiError, requireCustomer } from "@/lib/auth/guards";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import {
  createSupportRequest,
  listCustomerSupportRequests,
  parseSupportCategory,
  toPublicSupportRequest,
} from "@/lib/support/service";
import { WalletError } from "@/lib/wallet/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireCustomer();
    const rows = await listCustomerSupportRequests(user.id);
    return jsonOk({ requests: rows.map(toPublicSupportRequest) });
  } catch (error) {
    const access = panelApiError(error);
    if (access) return jsonError(access.message, access.status);
    return jsonError("دریافت درخواست‌ها ممکن نیست.", 500);
  }
}

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const user = await requireCustomer();
    const body = (await request.json()) as Record<string, unknown>;
    const category = parseSupportCategory(body.category);
    if (!category) return jsonError("دسته‌بندی معتبر نیست.", 400);
    const created = await createSupportRequest({
      userId: user.id,
      category,
      subject: typeof body.subject === "string" ? body.subject : "",
      description: typeof body.description === "string" ? body.description : "",
      cloudInstanceId:
        typeof body.cloudInstanceId === "string" ? body.cloudInstanceId : null,
      serviceOrderId:
        typeof body.serviceOrderId === "string" ? body.serviceOrderId : null,
    });
    return jsonOk({ request: toPublicSupportRequest(created) });
  } catch (error) {
    const access = panelApiError(error);
    if (access) return jsonError(access.message, access.status);
    if (error instanceof WalletError) {
      return jsonError(error.message, error.code === "not_found" ? 404 : 400);
    }
    console.error("[support:create]", error instanceof Error ? error.message : "unknown");
    return jsonError("ثبت درخواست ممکن نیست.", 500);
  }
}
