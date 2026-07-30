import { DeliveryMode, InfrastructureProvider } from "@prisma/client";

import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { prisma } from "@/lib/db";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { assertPositiveIntegerToman } from "@/lib/money";
import { listAllPlans } from "@/lib/orders/plans";
import {
  compatibleImageCodes,
  resolveCatalogItemPricing,
} from "@/lib/pricing/plan-pricing";
import { readRequestMeta } from "@/lib/session";
import { READY_SERVER_PLAN_PREFIX } from "@/lib/cloud-servers/catalog";

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
        catalogItemId: plan.catalogItemId,
        catalogMappingStatus: plan.catalogMappingStatus,
        vcpu: plan.catalogItem?.vcpu ?? plan.vcpu,
        ramGb:
          plan.catalogItem?.ramMb == null
            ? plan.ramGb
            : Math.ceil(plan.catalogItem.ramMb / 1024),
        storageGb: plan.catalogItem?.diskGb ?? plan.storageGb,
        basePriceRial: plan.pricing?.providerBasePriceRial.toString() ?? null,
        finalPriceRial: plan.pricing?.finalPriceRial.toString() ?? null,
        available: plan.catalogItem?.available === true,
        lastSyncedAt: plan.catalogItem?.lastSyncedAt.toISOString() ?? null,
        deliveryEstimateMinutes: plan.deliveryEstimateMinutes,
        parchinIncluded: plan.parchinIncluded,
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
    if (code.startsWith(READY_SERVER_PLAN_PREFIX)) {
      return jsonError("این پیشوند برای پلن‌های خودکار سرور آماده رزرو شده است.", 400);
    }
    if (
      body.deliveryMode === "RAW" ||
      ("parchinIncluded" in body && body.parchinIncluded !== true)
    ) {
      return jsonError("تمام سرورهای ابرچین فقط همراه با پرچین فروخته می‌شوند.", 400);
    }
    if (
      "salePriceToman" in body ||
      "renewalPriceToman" in body ||
      "estimatedProviderCostToman" in body ||
      "vcpu" in body ||
      "ramGb" in body ||
      "storageGb" in body
    ) {
      return jsonError("قیمت و منابع فقط از کاتالوگ Provider خوانده می‌شوند.", 400);
    }
    const catalogItemId =
      typeof body.catalogItemId === "string" ? body.catalogItemId.trim() : "";
    const imageCode = typeof body.imageCode === "string" ? body.imageCode.trim() : "";
    const [catalogItem, pricingConfig] = await Promise.all([
      prisma.providerCatalogItem.findUnique({ where: { id: catalogItemId } }),
      prisma.providerPricingConfig.findUnique({
        where: { provider: InfrastructureProvider.PARSPACK },
      }),
    ]);
    if (!catalogItem || catalogItem.provider !== InfrastructureProvider.PARSPACK) {
      return jsonError("Catalog Item معتبر نیست.", 400);
    }
    if (!compatibleImageCodes(catalogItem).includes(imageCode)) {
      return jsonError("Image با Region و Size انتخاب‌شده سازگار نیست.", 400);
    }
    const pricing = pricingConfig
      ? resolveCatalogItemPricing(catalogItem, pricingConfig)
      : null;
    if (body.active !== false && !pricing) {
      return jsonError("Catalog Item ناموجود یا فاقد قرارداد قیمت معتبر است.", 400);
    }

    const plan = await prisma.infrastructurePlan.create({
      data: {
        code,
        title,
        description: typeof body.description === "string" ? body.description.trim() : null,
        provider: InfrastructureProvider.PARSPACK,
        regionCode: catalogItem.regionCode,
        sizeCode: catalogItem.sizeCode,
        imageCode,
        deliveryMode: DeliveryMode.MANAGED,
        vcpu: catalogItem.vcpu,
        ramGb:
          catalogItem.ramMb == null ? null : Math.ceil(catalogItem.ramMb / 1024),
        storageGb: catalogItem.diskGb,
        salePriceRial: pricing?.finalPriceRial ?? 1n,
        renewalPriceRial: pricing?.finalPriceRial ?? 1n,
        estimatedProviderCostRial: pricing?.providerBasePriceRial ?? 1n,
        deliveryEstimateMinutes: assertPositiveIntegerToman(body.deliveryEstimateMinutes),
        parchinIncluded: true,
        active: body.active !== false && pricing != null,
        sortOrder: Number(body.sortOrder ?? 0),
        catalogItemId: catalogItem.id,
        catalogMappingStatus: "MAPPED",
        catalogMappedAt: new Date(),
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
