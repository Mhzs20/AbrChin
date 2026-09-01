import { StorefrontSlotRole } from "@prisma/client";

import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import {
  jsonError,
  jsonOk,
  rejectCrossOrigin,
} from "@/lib/http";
import { PricingUnavailableError } from "@/lib/pricing/plan-pricing";
import { readRequestMeta } from "@/lib/session";
import { WalletError } from "@/lib/wallet/errors";
import {
  getStorefrontAssortmentAdminView,
  listStorefrontCatalogCandidates,
  replaceStorefrontTierSlots,
} from "@/lib/storefront/assortment-service";
import {
  applySuggestedStorefrontAssortment,
  getStorefrontAssortmentSettings,
  setStorefrontAutoSuggestEnabled,
  toStorefrontSettingsView,
  updateStorefrontCapacityRules,
  updateStorefrontPriceBandsAndStyle,
  updateStorefrontPriceDisplay,
} from "@/lib/storefront/auto-suggest";
import { parseStorefrontCapacityRules } from "@/lib/storefront/capacity-rules";
import {
  parseStorefrontAssortmentStyle,
  tomanToRial,
} from "@/lib/storefront/price-bands";
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
      settings: toStorefrontSettingsView(settings),
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
      capacityRules?: unknown;
      priceDisplay?: unknown;
      assortmentStyle?: unknown;
      priceBandsToman?: unknown;
    };
    const meta = await readRequestMeta(request);

    if (body.action === "set_price_bands_style") {
      const rawBands = body.priceBandsToman;
      if (!rawBands || typeof rawBands !== "object" || Array.isArray(rawBands)) {
        return jsonError("باند قیمت معتبر نیست.", 400);
      }
      const bands = rawBands as Record<string, Record<string, unknown>>;
      function readToman(tier: string, edge: "min" | "max"): number | null {
        const row = bands[tier];
        if (!row || typeof row !== "object") {
          throw new Error("storefront_invalid_price_band");
        }
        const value = row[edge];
        if (edge === "max" && (value === "" || value == null)) return null;
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
          throw new Error("storefront_invalid_price_band");
        }
        return value;
      }
      try {
        const style = parseStorefrontAssortmentStyle(body.assortmentStyle);
        const noMin = readToman("NO", "min") ?? 0;
        const noMax = readToman("NO", "max");
        const ostovarMin = readToman("OSTOVAR", "min") ?? 0;
        const ostovarMax = readToman("OSTOVAR", "max");
        const kahkeshanMin = readToman("KAHKESHAN", "min") ?? 0;
        const kahkeshanMax = readToman("KAHKESHAN", "max");
        await updateStorefrontPriceBandsAndStyle({
          assortmentStyle: style,
          priceBands: {
            NO: {
              minMonthlyPriceRial: tomanToRial(noMin),
              maxMonthlyPriceRial:
                noMax == null ? null : tomanToRial(noMax),
            },
            OSTOVAR: {
              minMonthlyPriceRial: tomanToRial(ostovarMin),
              maxMonthlyPriceRial:
                ostovarMax == null ? null : tomanToRial(ostovarMax),
            },
            KAHKESHAN: {
              minMonthlyPriceRial: tomanToRial(kahkeshanMin),
              maxMonthlyPriceRial:
                kahkeshanMax == null ? null : tomanToRial(kahkeshanMax),
            },
          },
          actorUserId: admin.id,
        });
        const current = await getStorefrontAssortmentSettings();
        if (current.autoSuggestEnabled) {
          await applySuggestedStorefrontAssortment({
            actorUserId: admin.id,
            enableAuto: true,
          });
        }
        await writeAuditLog({
          actorUserId: admin.id,
          action: AuditActions.STOREFRONT_ASSORTMENT_UPDATE,
          entityType: "storefront_assortment",
          entityId: "price_bands_style",
          afterData: {
            action: "set_price_bands_style",
            assortmentStyle: style,
            priceBandsToman: {
              NO: { min: noMin, max: noMax },
              OSTOVAR: { min: ostovarMin, max: ostovarMax },
              KAHKESHAN: { min: kahkeshanMin, max: kahkeshanMax },
            },
            autoSuggestReapplied: current.autoSuggestEnabled,
          },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.startsWith("storefront_invalid_price_band") ||
            error.message === "storefront_price_band_order_invalid" ||
            error.message === "storefront_invalid_assortment_style")
        ) {
          return jsonError("باند قیمت یا سبک چینش معتبر نیست.", 400);
        }
        throw error;
      }
      const [tiers, settings] = await Promise.all([
        getStorefrontAssortmentAdminView(),
        getStorefrontAssortmentSettings(),
      ]);
      return jsonOk({
        tiers,
        settings: toStorefrontSettingsView(settings),
      });
    }

    if (body.action === "set_price_display") {
      const display = body.priceDisplay;
      if (!display || typeof display !== "object" || Array.isArray(display)) {
        return jsonError("نمایش قیمت معتبر نیست.", 400);
      }
      const record = display as Record<string, unknown>;
      try {
        await updateStorefrontPriceDisplay({
          showHourlyPrice: record.showHourlyPrice === true,
          showDailyPrice: record.showDailyPrice === true,
          showMonthlyPrice: record.showMonthlyPrice === true,
          actorUserId: admin.id,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "storefront_price_display_empty"
        ) {
          return jsonError("حداقل یک نوع قیمت باید روشن باشد.", 400);
        }
        throw error;
      }
      const priceDisplay = {
        showHourlyPrice: record.showHourlyPrice === true,
        showDailyPrice: record.showDailyPrice === true,
        showMonthlyPrice: record.showMonthlyPrice === true,
      };
      await writeAuditLog({
        actorUserId: admin.id,
        action: AuditActions.STOREFRONT_ASSORTMENT_UPDATE,
        entityType: "storefront_assortment",
        entityId: "price_display",
        afterData: {
          action: "set_price_display",
          priceDisplay,
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
        settings: toStorefrontSettingsView(settings),
      });
    }

    if (body.action === "set_capacity_rules") {
      if (
        !body.capacityRules ||
        typeof body.capacityRules !== "object" ||
        Array.isArray(body.capacityRules)
      ) {
        return jsonError("قواعد ظرفیت معتبر نیست.", 400);
      }
      const rules = parseStorefrontCapacityRules(
        body.capacityRules as Record<string, unknown>,
      );
      await updateStorefrontCapacityRules({
        rules,
        actorUserId: admin.id,
      });
      const current = await getStorefrontAssortmentSettings();
      if (current.autoSuggestEnabled) {
        await applySuggestedStorefrontAssortment({
          actorUserId: admin.id,
          enableAuto: true,
        });
      }
      await writeAuditLog({
        actorUserId: admin.id,
        action: AuditActions.STOREFRONT_ASSORTMENT_UPDATE,
        entityType: "storefront_assortment",
        entityId: "capacity_rules",
        afterData: {
          action: "set_capacity_rules",
          rules,
          autoSuggestReapplied: current.autoSuggestEnabled,
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
        settings: toStorefrontSettingsView(settings),
      });
    }

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
        settings: toStorefrontSettingsView(settings),
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
        settings: toStorefrontSettingsView(settings),
      });
    }

    return jsonError("عملیات معتبر نیست.", 400);
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    if (error instanceof Error) {
      if (error.message === "storefront_invalid_capacity_rule") {
        return jsonError("مقادیر ظرفیت باید عدد صحیح نامنفی باشند.", 400);
      }
      if (error.message === "storefront_capacity_order_invalid") {
        return jsonError(
          "حداقل ظرفیت کهکشان نباید از استوار کمتر باشد.",
          400,
        );
      }
    }
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
      settings: toStorefrontSettingsView(settings),
    });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    if (error instanceof PricingUnavailableError) {
      return jsonError(error.message, 409, { code: error.code });
    }
    if (error instanceof WalletError && error.code === "forbidden") {
      return jsonError(error.message, 403, { code: error.code });
    }
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
