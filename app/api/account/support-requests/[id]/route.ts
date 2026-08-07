import { panelApiError, requireCustomer } from "@/lib/auth/guards";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import {
  addCustomerSupportMessage,
  getCustomerSupportRequest,
  toPublicSupportRequest,
} from "@/lib/support/service";
import { WalletError } from "@/lib/wallet/errors";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCustomer();
    const { id } = await params;
    const request = await getCustomerSupportRequest(user.id, id);
    return jsonOk({
      request: {
        ...toPublicSupportRequest(request),
        cloudInstance: request.cloudInstance,
        serviceOrder: request.serviceOrder,
        messages: request.messages.map((message) => ({
          id: message.id,
          body: message.body,
          isStaff: message.isStaff,
          createdAt: message.createdAt.toISOString(),
          authorName: message.isStaff
            ? "پشتیبانی ابرچین"
            : message.author.displayName || "شما",
        })),
      },
    });
  } catch (error) {
    const access = panelApiError(error);
    if (access) return jsonError(access.message, access.status);
    if (error instanceof WalletError) {
      return jsonError(error.message, error.code === "not_found" ? 404 : 400);
    }
    return jsonError("دریافت درخواست ممکن نیست.", 500);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const user = await requireCustomer();
    const { id } = await params;
    const body = (await request.json()) as { body?: unknown };
    const updated = await addCustomerSupportMessage({
      userId: user.id,
      requestId: id,
      body: typeof body.body === "string" ? body.body : "",
    });
    return jsonOk({ request: toPublicSupportRequest(updated) });
  } catch (error) {
    const access = panelApiError(error);
    if (access) return jsonError(access.message, access.status);
    if (error instanceof WalletError) {
      return jsonError(
        error.message,
        error.code === "not_found"
          ? 404
          : error.code === "invalid_status"
            ? 409
            : 400,
      );
    }
    return jsonError("ارسال پیام ممکن نیست.", 500);
  }
}
