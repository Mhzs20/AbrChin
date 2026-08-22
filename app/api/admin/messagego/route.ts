import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { toSafeConnectionFailure } from "@/lib/admin/service-connection-safety";
import { getEnv } from "@/lib/env";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { checkMessageGoConnection, isMessageGoConfigured } from "@/lib/messagego/client";

export const dynamic = "force-dynamic";

function safeConfiguration() {
  const env = getEnv();
  return {
    configured: isMessageGoConfigured(),
    baseUrl: env.messageGoBaseUrl || null,
    clientId: env.messageGoClientId || null,
    tenantId: env.messageGoTenantId || null,
    workspaceId: env.messageGoWorkspaceId || null,
    secretConfigured: Boolean(env.messageGoClientSecret),
  };
}

export async function GET() {
  try {
    await requireAdminUser();
    return jsonOk({ connection: safeConfiguration() });
  } catch (error) {
    const accessError = adminApiError(error);
    if (accessError) return jsonError(accessError.message, accessError.status);
    return jsonError("دریافت وضعیت اتصال MessageGo ممکن نیست.", 500);
  }
}

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    await requireAdminUser();
    if (!isMessageGoConfigured()) {
      return jsonOk({
        connection: {
          ...safeConfiguration(),
          status: "UNCONFIGURED",
          message: "اتصال MessageGo هنوز تنظیم نشده است.",
        },
      });
    }
    await checkMessageGoConnection();
    return jsonOk({
      connection: {
        ...safeConfiguration(),
        status: "HEALTHY",
        message: "Token Exchange و دسترسی Conversation API با موفقیت انجام شد.",
      },
    });
  } catch (error) {
    const accessError = adminApiError(error);
    if (accessError) return jsonError(accessError.message, accessError.status);
    const safe = toSafeConnectionFailure(error);
    return jsonOk({
      connection: {
        ...safeConfiguration(),
        status: "ERROR",
        errorCode: safe.code,
        message: safe.message,
      },
    });
  }
}
