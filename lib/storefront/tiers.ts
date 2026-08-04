import type { StorefrontChinishTier } from "@prisma/client";

export const STOREFRONT_PRIMARY_LIMIT = 24;
export const STOREFRONT_RESERVE_LIMIT = 12;
export const STOREFRONT_DISPLAY_LIMIT = 24;
export const STOREFRONT_LOW_STOCK_THRESHOLD = 12;

export const STOREFRONT_TIERS = [
  "NO",
  "OSTOVAR",
  "KAHKESHAN",
] as const satisfies readonly StorefrontChinishTier[];

export type StorefrontTierCode = (typeof STOREFRONT_TIERS)[number];

export function storefrontTierLabel(tier: StorefrontChinishTier): string {
  if (tier === "NO") return "چینش نو";
  if (tier === "OSTOVAR") return "چینش استوار";
  return "چینش کهکشان";
}

export function storefrontTierDescription(tier: StorefrontChinishTier): string {
  if (tier === "NO") {
    return "کمتر از حداقل استوار — شروع کنترل‌شده برای سایت، آزمایش و بار روزمره.";
  }
  if (tier === "OSTOVAR") {
    return "از حداقل استوار تا زیر حداقل کهکشان — تعادل قدرت و قیمت برای کار پایدار.";
  }
  return "از حداقل کهکشان به بالا — ظرفیت بالاتر برای ترافیک جدی و رشد سریع.";
}

export function isStorefrontTier(value: unknown): value is StorefrontChinishTier {
  return (
    value === "NO" || value === "OSTOVAR" || value === "KAHKESHAN"
  );
}
