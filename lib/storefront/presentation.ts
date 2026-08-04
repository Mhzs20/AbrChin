import type { ParchinLevel, StorefrontChinishTier } from "@prisma/client";

import { readyServerLocation } from "@/lib/cloud-servers/catalog";

export type StorefrontLocationZone = "IRAN" | "ABROAD";

/** Ceiling step for customer-facing تومان display (1453 → 1500, 1320 → 1500). */
export const STOREFRONT_TOMAN_ROUND_STEP = 500n;

/** Public storefront treats catalog sync as fresh for a full day. */
export const STOREFRONT_DISPLAY_FRESHNESS_SECONDS = 24 * 60 * 60;

const ABROAD_LOCATION_MARKERS = [
  "toronto",
  "stockholm",
  "frankfurt",
  "amsterdam",
  "london",
  "paris",
  "istanbul",
  "eu-",
  "ca-",
  "us-",
  "ap-",
  "تورنتو",
  "استکهلم",
  "فرانکفورت",
  "آمستردام",
  "لندن",
  "پاریس",
  "استانبول",
  "کانادا",
  "سوئد",
  "آلمان",
  "هلند",
  "بریتانیا",
  "فرانسه",
  "ترکیه",
  "canada",
  "sweden",
  "germany",
  "netherlands",
  "france",
  "turkey",
] as const;

const IRAN_LOCATION_MARKERS = [
  "ایران",
  "تهران",
  "تبریز",
  "اهواز",
  "tehran",
  "tabriz",
  "ahvaz",
  "ir-",
  "سیمین",
  "فروغ",
  "بامداد",
  "شهریار",
  "قیصر",
] as const;

function locationHaystack(
  regionCode: string,
  hints?: { title?: string; locationLabel?: string },
) {
  const location = readyServerLocation(regionCode);
  return [
    regionCode,
    location.label,
    location.shortLabel,
    location.country,
    hints?.title ?? "",
    hints?.locationLabel ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

export function isStorefrontDisplayFresh(
  lastSync: Date | null | undefined,
  now = new Date(),
) {
  if (!lastSync) return false;
  return (
    now.getTime() - lastSync.getTime() <=
    STOREFRONT_DISPLAY_FRESHNESS_SECONDS * 1000
  );
}

export function storefrontCityName(regionCode: string): string {
  const location = readyServerLocation(regionCode);
  const haystack = `${location.label} ${location.shortLabel}`.toLowerCase();
  if (storefrontLocationZone(regionCode) === "IRAN") {
    if (
      haystack.includes("تهران") ||
      haystack.includes("سیمین") ||
      haystack.includes("فروغ") ||
      haystack.includes("بامداد")
    ) {
      return "تهران";
    }
    if (haystack.includes("تبریز") || haystack.includes("شهریار")) {
      return "تبریز";
    }
    if (haystack.includes("اهواز") || haystack.includes("قیصر")) {
      return "اهواز";
    }
  }
  return location.shortLabel
    .replace(/[0-9۰-۹]+/g, "")
    .replace(/[،,]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || location.shortLabel;
}

export function storefrontLocationLabel(regionCode: string): string {
  const city = storefrontCityName(regionCode);
  const zone = storefrontLocationZone(regionCode);
  if (zone === "IRAN") return `${city} ایران`;
  const country = readyServerLocation(regionCode).country;
  if (!country || country === "—" || country === "ایران") return city;
  return `${city} ${country}`;
}

/**
 * Iran vs abroad for storefront filters.
 * Named abroad cities/countries win so Canada, Stockholm, etc. never sit in
 * the Iran tab even when region metadata is incomplete.
 */
export function storefrontLocationZone(
  regionCode: string,
  hints?: { title?: string; locationLabel?: string },
): StorefrontLocationZone {
  const code = regionCode.trim().toLowerCase();
  const haystack = locationHaystack(regionCode, hints);
  const hasAbroad = ABROAD_LOCATION_MARKERS.some((marker) =>
    haystack.includes(marker),
  );
  if (hasAbroad) return "ABROAD";

  if (
    readyServerLocation(regionCode).country === "ایران" ||
    code.startsWith("ir-") ||
    code.startsWith("tehran") ||
    IRAN_LOCATION_MARKERS.some((marker) => haystack.includes(marker))
  ) {
    return "IRAN";
  }
  return "ABROAD";
}

export function storefrontServerTitle(params: {
  regionCode: string;
  index: number;
}): string {
  const city = storefrontCityName(params.regionCode);
  return `ابر ${params.index.toLocaleString("fa-IR")} ${city}`;
}

export function storefrontParchinForTier(
  tier: StorefrontChinishTier,
): ParchinLevel {
  if (tier === "NO") return "PARCHIN_START";
  if (tier === "OSTOVAR") return "PARCHIN_ACTIVE";
  return "PARCHIN_STABLE";
}

/** Display-only round-up of ریال → تومان step. Does not change billed amounts. */
export function roundUpDisplayTomanFromRial(rialValue: string | bigint): bigint {
  const rial = typeof rialValue === "bigint" ? rialValue : BigInt(rialValue);
  if (rial <= 0n) return 0n;
  const toman = rial / 10n + (rial % 10n === 0n ? 0n : 1n);
  const step = STOREFRONT_TOMAN_ROUND_STEP;
  return ((toman + step - 1n) / step) * step;
}

export function formatStorefrontToman(rialValue: string | bigint): string {
  return roundUpDisplayTomanFromRial(rialValue).toLocaleString("fa-IR");
}
