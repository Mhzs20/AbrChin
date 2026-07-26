import { DeliveryMode, InfrastructureProvider } from "@prisma/client";

import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { prisma } from "@/lib/db";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { assertPositiveIntegerToman, tomanToRial } from "@/lib/money";
import { listAllPlans } from "@/lib/orders/plans";
import { readRequestMeta } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminUser();
    const plans = await listAllPlans();
    return jsonOk({
      plans: plans.map((plan) => ({
        id: plan.id,
        code: plan.code,
        title: plan.title,
        description: plan.description,
        deliveryMode: plan.deliveryMode,
        regionCode: plan.regionCode,
        sizeCode: plan.sizeCode,
        imageCode: plan.imageCode,
        salePriceRial: plan.salePriceRial.toString(),
        estimatedProviderCostRial: plan.estimatedProviderCostRial.toString(),
        active: plan.active,
        sortOrder: plan.sortOrder,
      })),
    });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    console.error("[admin/plans/get]", error instanceof Error ? error.message : "unknown");
    return jsonError("دریافت پلن‌ها ممکن نیست.", 500);
  }
}

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const admin = await requireAdminUser();
    const meta = await readRequestMeta(request);
    const body = (await request.json()) as Record<string, unknown>;

    const code = typeof body.code === "string" ? body.code.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!code || !title) return jsonError("کد و عنوان الزامی است.", 400);

    const salePriceRial = tomanToRial(assertPositiveIntegerToman(body.salePriceToman));
    const estimatedProviderCostRial = tomanToRial(assertPositiveIntegerToman(body.estimatedProviderCostToman));

    const plan = await prisma.infrastructurePlan.create({
      data: {
        code,
        title,
        description: typeof body.description === "string" ? body.description.trim() : null,
        provider: InfrastructureProvider.PARSPACK,
        regionCode: String(body.regionCode ?? ""),
        sizeCode: String(body.sizeCode ?? ""),
        imageCode: String(body.imageCode ?? ""),
        deliveryMode: body.deliveryMode === "MANAGED" ? DeliveryMode.MANAGED : DeliveryMode.RAW,
        salePriceRial,
        estimatedProviderCostRial,
        active: body.active !== false,
        sortOrder: Number(body.sortOrder ?? 0),
        updatedById: admin.id,
      },
    });

    await writeAuditLog({
      actorUserId: admin.id,
      action: AuditActions.PLAN_CREATE,
      entityType: "infrastructure_plan",
      entityId: plan.id,
      afterData: { code: plan.code, title: plan.title },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return jsonOk({ plan: { id: plan.id, code: plan.code } });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    console.error("[admin/plans/post]", error instanceof Error ? error.message : "unknown");
    return jsonError("ایجاد پلن ممکن نیست.", 500);
  }
}
