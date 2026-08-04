import type { ParchinLevel, StorefrontChinishTier } from "@prisma/client";

import { readyServerLocation } from "@/lib/cloud-servers/catalog";

export type StorefrontLocationZone = "IRAN" | "ABROAD";

/** Ceiling step for customer-facing تومان display (1453 → 1500, 1320 → 1500). */
export const STOREFRONT_TOMAN_ROUND_STEP = 500n;

export function storefrontCityName(regionCode: string): string {
  const location = readyServerLocation(regionCode);
  const haystack = `${location.label} ${location.shortLabel}`.toLowerCase();
  if (location.country === "ایران") {
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
  const country = readyServerLocation(regionCode).country;
  if (!country || country === "—") return city;
  return `${city} ${country}`;
}

export function storefrontLocationZone(
  regionCode: string,
): StorefrontLocationZone {
  return readyServerLocation(regionCode).country === "ایران"
    ? "IRAN"
    : "ABROAD";
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
