import { StorefrontSlotRole } from "@prisma/client";

import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import {
  jsonError,
  jsonOk,
  rejectCrossOrigin,
} from "@/lib/http";
import { readRequestMeta } from "@/lib/session";
import {
  getStorefrontAssortmentAdminView,
  listStorefrontCatalogCandidates,
  replaceStorefrontTierSlots,
} from "@/lib/storefront/assortment-service";
import {
  applySuggestedStorefrontAssortment,
  getStorefrontAssortmentSettings,
  setStorefrontAutoSuggestEnabled,
} from "@/lib/storefront/auto-suggest";
import { isStorefrontTier } from "@/lib/storefront/tiers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminUser();
    const [tiers, candidates, settings] = await Promise.all([
      getStorefrontAssortmentAdminView(),
      listStorefrontCatalogCandidates(),
      getStorefrontAssortmentSettings(),
    ]);
    return jsonOk({
      tiers,
      candidates,
      settings: {
        autoSuggestEnabled: settings.autoSuggestEnabled,
        lastAutoAppliedAt: settings.lastAutoAppliedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    console.error(
      "[admin/storefront-assortment/get]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("دریافت چینش فروشگاهی ممکن نیست.", 500);
  }
}

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const admin = await requireAdminUser();
    const body = (await request.json()) as {
      action?: unknown;
      enabled?: unknown;
    };
    const meta = await readRequestMeta(request);

    if (body.action === "apply_suggestions") {
      const enableAuto = body.enabled === true;
      const applied = await applySuggestedStorefrontAssortment({
        actorUserId: admin.id,
        enableAuto,
      });
      await writeAuditLog({
        actorUserId: admin.id,
        action: AuditActions.STOREFRONT_ASSORTMENT_UPDATE,
        entityType: "storefront_assortment",
        entityId: "auto_suggest",
        afterData: {
          action: "apply_suggestions",
          enableAuto,
          tiers: applied.tiers,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      const [tiers, settings] = await Promise.all([
        getStorefrontAssortmentAdminView(),
        getStorefrontAssortmentSettings(),
      ]);
      return jsonOk({
        tiers,
        settings: {
          autoSuggestEnabled: settings.autoSuggestEnabled,
          lastAutoAppliedAt: settings.lastAutoAppliedAt?.toISOString() ?? null,
        },
      });
    }

    if (body.action === "set_auto_suggest") {
      if (typeof body.enabled !== "boolean") {
        return jsonError("وضعیت پیشنهاد خودکار معتبر نیست.", 400);
      }
      if (body.enabled) {
        await applySuggestedStorefrontAssortment({
          actorUserId: admin.id,
          enableAuto: true,
        });
      } else {
        await setStorefrontAutoSuggestEnabled({
          enabled: false,
          actorUserId: admin.id,
        });
      }
      await writeAuditLog({
        actorUserId: admin.id,
        action: AuditActions.STOREFRONT_ASSORTMENT_UPDATE,
        entityType: "storefront_assortment",
        entityId: "auto_suggest_toggle",
        afterData: {
          action: "set_auto_suggest",
          enabled: body.enabled,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      const [tiers, settings] = await Promise.all([
        getStorefrontAssortmentAdminView(),
        getStorefrontAssortmentSettings(),
      ]);
      return jsonOk({
        tiers,
        settings: {
          autoSuggestEnabled: settings.autoSuggestEnabled,
          lastAutoAppliedAt: settings.lastAutoAppliedAt?.toISOString() ?? null,
        },
      });
    }

    return jsonError("عملیات معتبر نیست.", 400);
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    console.error(
      "[admin/storefront-assortment/post]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("اجرای پیشنهاد خودکار ممکن نیست.", 500);
  }
}

export async function PUT(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const admin = await requireAdminUser();
    const body = (await request.json()) as {
      tier?: unknown;
      slots?: Array<{
        catalogItemId?: unknown;
        role?: unknown;
        sortOrder?: unknown;
        enabled?: unknown;
      }>;
    };
    if (!isStorefrontTier(body.tier)) {
      return jsonError("سطح چینش معتبر نیست.", 400);
    }
    if (!Array.isArray(body.slots)) {
      return jsonError("فهرست پلن‌ها معتبر نیست.", 400);
    }
    const slots = body.slots.map((slot, index) => {
      if (
        typeof slot.catalogItemId !== "string" ||
        slot.catalogItemId.length < 1
      ) {
        throw new Error("storefront_invalid_catalog_item");
      }
      if (
        slot.role !== StorefrontSlotRole.PRIMARY &&
        slot.role !== StorefrontSlotRole.RESERVE
      ) {
        throw new Error("storefront_invalid_role");
      }
      const sortOrder =
        typeof slot.sortOrder === "number" && Number.isInteger(slot.sortOrder)
          ? slot.sortOrder
          : index;
      return {
        catalogItemId: slot.catalogItemId,
        role: slot.role,
        sortOrder,
        enabled: slot.enabled !== false,
      };
    });

    await replaceStorefrontTierSlots({
      tier: body.tier,
      slots,
      actorUserId: admin.id,
    });

    const meta = await readRequestMeta(request);
    await writeAuditLog({
      actorUserId: admin.id,
      action: AuditActions.STOREFRONT_ASSORTMENT_UPDATE,
      entityType: "storefront_assortment",
      entityId: body.tier,
      afterData: {
        tier: body.tier,
        slotCount: slots.length,
        primaryCount: slots.filter((slot) => slot.role === "PRIMARY").length,
        reserveCount: slots.filter((slot) => slot.role === "RESERVE").length,
        autoSuggestDisabled: true,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const [tiers, settings] = await Promise.all([
      getStorefrontAssortmentAdminView(),
      getStorefrontAssortmentSettings(),
    ]);
    return jsonOk({
      tiers,
      settings: {
        autoSuggestEnabled: settings.autoSuggestEnabled,
        lastAutoAppliedAt: settings.lastAutoAppliedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    if (error instanceof Error) {
      if (error.message === "storefront_primary_limit") {
        return jsonError("حداکثر ۲۴ پلن اصلی برای هر چینش مجاز است.", 400);
      }
      if (error.message === "storefront_reserve_limit") {
        return jsonError("حداکثر ۱۲ پلن رزرو برای هر چینش مجاز است.", 400);
      }
      if (error.message === "storefront_duplicate_catalog_item") {
        return jsonError("هر پلن فقط یک‌بار در یک چینش قابل انتخاب است.", 400);
      }
      if (error.message === "storefront_invalid_catalog_item") {
        return jsonError("یکی از پلن‌های انتخاب‌شده معتبر نیست.", 400);
      }
      if (error.message === "storefront_invalid_role") {
        return jsonError("نقش پلن معتبر نیست.", 400);
      }
      if (error.message === "storefront_invalid_sort_order") {
        return jsonError("ترتیب نمایش معتبر نیست.", 400);
      }
    }
    console.error(
      "[admin/storefront-assortment/put]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("ذخیره چینش فروشگاهی ممکن نیست.", 500);
  }
}
