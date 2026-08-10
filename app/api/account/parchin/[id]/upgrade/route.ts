import { ParchinLevel } from "@prisma/client";

import { panelApiError, requireCustomer } from "@/lib/auth/guards";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { requestParchinLevelUpgrade } from "@/lib/parchin/service";
import { WalletError } from "@/lib/wallet/errors";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const user = await requireCustomer();
    const [{ id }, body] = await Promise.all([
      params,
      request.json() as Promise<Record<string, unknown>>,
    ]);
    const requestedLevel =
      typeof body.requestedLevel === "string" &&
      Object.values(ParchinLevel).includes(body.requestedLevel as ParchinLevel)
        ? (body.requestedLevel as ParchinLevel)
        : null;
    if (!requestedLevel) return jsonError("سطح پرچین معتبر نیست.", 400);
    const enrollment = await requestParchinLevelUpgrade({
      enrollmentId: id,
      userId: user.id,
      requestedLevel,
    });
    return jsonOk({
      enrollment: {
        id: enrollment.id,
        requestedNextLevel: enrollment.requestedNextLevel,
        requestedLevelAt: enrollment.requestedLevelAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    const access = panelApiError(error);
    if (access) return jsonError(access.message, access.status);
    if (error instanceof WalletError) {
      return jsonError(error.message, error.code === "not_found" ? 404 : 400);
    }
    return jsonError("ثبت درخواست ارتقای پرچین ممکن نیست.", 500);
  }
}
