import { SupportRequestStatus } from "@prisma/client";

import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import {
  adminUpdateSupportRequest,
  getAdminSupportRequest,
  toPublicSupportRequest,
} from "@/lib/support/service";
import { WalletError } from "@/lib/wallet/errors";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdminUser();
    const { id } = await params;
    const request = await getAdminSupportRequest(id);
    return jsonOk({
      request: {
        ...toPublicSupportRequest(request),
        user: request.user,
        cloudInstance: request.cloudInstance,
        serviceOrder: request.serviceOrder,
        messages: request.messages.map((message) => ({
          id: message.id,
          body: message.body,
          isStaff: message.isStaff,
          createdAt: message.createdAt.toISOString(),
          authorName:
            message.author.displayName ||
            (message.isStaff ? "پشتیبانی" : request.user.mobile),
        })),
      },
    });
  } catch (error) {
    const access = adminApiError(error);
    if (access) return jsonError(access.message, access.status);
    if (error instanceof WalletError) {
      return jsonError(error.message, error.code === "not_found" ? 404 : 400);
    }
    return jsonError("دریافت درخواست ممکن نیست.", 500);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const admin = await requireAdminUser();
    const { id } = await params;
    const body = (await request.json()) as {
      status?: unknown;
      reply?: unknown;
      assignedToId?: unknown;
    };
    const status =
      typeof body.status === "string" &&
      Object.values(SupportRequestStatus).includes(
        body.status as SupportRequestStatus,
      )
        ? (body.status as SupportRequestStatus)
        : undefined;
    const updated = await adminUpdateSupportRequest({
      adminUserId: admin.id,
      requestId: id,
      status,
      reply: typeof body.reply === "string" ? body.reply : undefined,
      assignedToId:
        body.assignedToId === null
          ? null
          : typeof body.assignedToId === "string"
            ? body.assignedToId
            : undefined,
    });
    return jsonOk({ request: toPublicSupportRequest(updated) });
  } catch (error) {
    const access = adminApiError(error);
    if (access) return jsonError(access.message, access.status);
    if (error instanceof WalletError) {
      return jsonError(error.message, error.code === "not_found" ? 404 : 400);
    }
    return jsonError("به‌روزرسانی درخواست ممکن نیست.", 500);
  }
}
