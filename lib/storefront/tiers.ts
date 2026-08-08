import type { ParchinLevel, StorefrontChinishTier } from "@prisma/client";

export const STOREFRONT_PRIMARY_LIMIT = 24;
export const STOREFRONT_RESERVE_LIMIT = 12;
/** Soft safety ceiling only — public listing shows all non-dominated plans. */
export const STOREFRONT_DISPLAY_LIMIT = 500;
export const STOREFRONT_LOW_STOCK_THRESHOLD = 12;
/** Target cards per location zone (Iran / abroad) inside each chinish tier. */
export const STOREFRONT_ZONE_TARGET = 8;

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

/** Each storefront capacity tier carries its matching billed service tier. */
export function storefrontParchinLevel(
  tier: StorefrontChinishTier,
): ParchinLevel {
  if (tier === "NO") return "PARCHIN_START";
  if (tier === "OSTOVAR") return "PARCHIN_ACTIVE";
  return "PARCHIN_STABLE";
}

export function storefrontParchinTitle(
  tier: StorefrontChinishTier,
): string {
  if (tier === "NO") return "پرچین شروع";
  if (tier === "OSTOVAR") return "پرچین استوار";
  return "پرچین کهکشان";
}

export function storefrontParchinTitleForLevel(level: ParchinLevel): string {
  if (level === "PARCHIN_START") return "پرچین شروع";
  if (level === "PARCHIN_ACTIVE") return "پرچین استوار";
  return "پرچین کهکشان";
}

/** Customer-facing copy — never expose internal threshold phrasing. */
export function storefrontTierDescription(tier: StorefrontChinishTier): string {
  if (tier === "NO") {
    return "شروع سبک و اقتصادی برای سایت، آزمایش و بار روزمره.";
  }
  if (tier === "OSTOVAR") {
    return "تعادل قدرت و قیمت برای کار پایدار و رشد کنترل‌شده.";
  }
  return "ظرفیت بالاتر برای ترافیک جدی، پردازش سنگین و مقیاس‌پذیری.";
}

export function isStorefrontTier(value: unknown): value is StorefrontChinishTier {
  return (
    value === "NO" || value === "OSTOVAR" || value === "KAHKESHAN"
  );
}
