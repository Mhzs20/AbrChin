import { ServiceConnectionName } from "@prisma/client";

import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { getServiceConnectionsAdminView, runServiceConnectionCheck } from "@/lib/admin/service-connections";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminUser();
    return jsonOk({ connections: await getServiceConnectionsAdminView() });
  } catch (error) {
    const accessError = adminApiError(error);
    if (accessError) return jsonError(accessError.message, accessError.status);
    return jsonError("دریافت وضعیت اتصال‌ها ممکن نیست.", 500);
  }
}

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    await requireAdminUser();
    const body = (await request.json().catch(() => ({}))) as { service?: unknown };
    const service = Object.values(ServiceConnectionName).includes(body.service as ServiceConnectionName)
      ? body.service as ServiceConnectionName
      : null;
    if (!service) return jsonError("سرویس معتبر نیست.", 400);
    return jsonOk({ connection: await runServiceConnectionCheck(service) });
  } catch (error) {
    const accessError = adminApiError(error);
    if (accessError) return jsonError(accessError.message, accessError.status);
    return jsonError("بررسی اتصال ممکن نیست.", 500);
  }
}
