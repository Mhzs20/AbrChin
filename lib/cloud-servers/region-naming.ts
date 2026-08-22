/**
 * Automatic, customer-safe region naming.
 *
 * Any region code a provider ships tomorrow must resolve to a sellable Persian
 * name without a deploy and without leaking provider identity. Three layers,
 * first match wins:
 *
 *   1. The curated presentation maps (catalog.ts / arvan regions.ts) — exact
 *      names for the regions we already know.
 *   2. This module's code parser — reads the city out of the region code
 *      itself (`ir-mhd-x1` → مشهد, `shiraz2` → شیراز ۲) and assigns the next
 *      free number for that city by looking at the display names already
 *      stored in ProviderRegionConfig. The number is persisted there once and
 *      never recomputed, so it survives re-syncs, render order and new
 *      neighbours.
 *   3. A generic fail-safe — «ایران N» for ir-* codes, «بین‌الملل N» for the
 *      rest. Ugly but safe; the admin renames it in مناطق فروش and the plan
 *      titles follow on the next sync.
 *
 * A provider's own label or the raw region code must never become a customer
 * display name. That is the whole point of this module.
 */

export type InferredRegionCity = {
  city: string;
  country: string | null;
  zone: "IRAN" | "ABROAD";
};

/** Token → city. Tokens are matched against `-`/digit-separated code parts. */
const CITY_TOKENS: Record<string, InferredRegionCity> = {
  // Iran
  thr: { city: "تهران", country: "ایران", zone: "IRAN" },
  tehran: { city: "تهران", country: "ایران", zone: "IRAN" },
  tbz: { city: "تبریز", country: "ایران", zone: "IRAN" },
  tabriz: { city: "تبریز", country: "ایران", zone: "IRAN" },
  ahz: { city: "اهواز", country: "ایران", zone: "IRAN" },
  ahvaz: { city: "اهواز", country: "ایران", zone: "IRAN" },
  southwest: { city: "اهواز", country: "ایران", zone: "IRAN" },
  mhd: { city: "مشهد", country: "ایران", zone: "IRAN" },
  mashhad: { city: "مشهد", country: "ایران", zone: "IRAN" },
  shz: { city: "شیراز", country: "ایران", zone: "IRAN" },
  shiraz: { city: "شیراز", country: "ایران", zone: "IRAN" },
  esf: { city: "اصفهان", country: "ایران", zone: "IRAN" },
  isf: { city: "اصفهان", country: "ایران", zone: "IRAN" },
  isfahan: { city: "اصفهان", country: "ایران", zone: "IRAN" },
  krj: { city: "کرج", country: "ایران", zone: "IRAN" },
  karaj: { city: "کرج", country: "ایران", zone: "IRAN" },
  qom: { city: "قم", country: "ایران", zone: "IRAN" },
  kish: { city: "کیش", country: "ایران", zone: "IRAN" },
  // Abroad
  frankfurt: { city: "فرانکفورت", country: "آلمان", zone: "ABROAD" },
  fra: { city: "فرانکفورت", country: "آلمان", zone: "ABROAD" },
  amsterdam: { city: "آمستردام", country: "هلند", zone: "ABROAD" },
  ams: { city: "آمستردام", country: "هلند", zone: "ABROAD" },
  london: { city: "لندن", country: "بریتانیا", zone: "ABROAD" },
  istanbul: { city: "استانبول", country: "ترکیه", zone: "ABROAD" },
  ist: { city: "استانبول", country: "ترکیه", zone: "ABROAD" },
  paris: { city: "پاریس", country: "فرانسه", zone: "ABROAD" },
  stockholm: { city: "استکهلم", country: "سوئد", zone: "ABROAD" },
  toronto: { city: "تورنتو", country: "کانادا", zone: "ABROAD" },
  dubai: { city: "دبی", country: "امارات", zone: "ABROAD" },
  dxb: { city: "دبی", country: "امارات", zone: "ABROAD" },
  vienna: { city: "وین", country: "اتریش", zone: "ABROAD" },
  helsinki: { city: "هلسینکی", country: "فنلاند", zone: "ABROAD" },
  eu: { city: "اروپا", country: null, zone: "ABROAD" },
  europe: { city: "اروپا", country: null, zone: "ABROAD" },
  us: { city: "آمریکا", country: null, zone: "ABROAD" },
  asia: { city: "آسیا", country: null, zone: "ABROAD" },
};

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

function toFaDigits(value: number): string {
  return String(value).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]!);
}

function faToLatinDigits(value: string): string {
  return value.replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)));
}

/** `ir-thr-si1` → ["ir","thr","si","1"]; `tehran12` → ["tehran","12"]. */
function codeParts(regionCode: string): string[] {
  return regionCode
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .flatMap((part) => part.split(/(?<=[a-z])(?=[0-9])|(?<=[0-9])(?=[a-z])/))
    .filter(Boolean);
}

/**
 * Layer 2: read the city out of the region code. Returns null when no token
 * matches — the caller then falls to layer 3.
 */
export function inferRegionCity(
  regionCode: string,
): (InferredRegionCity & { preferredNumber: number | null }) | null {
  const parts = codeParts(regionCode);
  for (const part of parts) {
    const hit = CITY_TOKENS[part];
    if (!hit) continue;
    // A trailing number in the code (tehran12, frankfurt2) is the provider's
    // own site index — prefer it when free so the name tracks the code.
    const afterCity = parts.slice(parts.indexOf(part) + 1);
    const numeric = afterCity.find((p) => /^[0-9]+$/.test(p));
    return {
      ...hit,
      preferredNumber: numeric ? Number(numeric) : null,
    };
  }
  return null;
}

/** Layer 3: the fail-safe category. Never the raw code, never a Latin word. */
export function fallbackRegionCity(regionCode: string): InferredRegionCity {
  const code = regionCode.trim().toLowerCase();
  return code.startsWith("ir")
    ? { city: "ایران", country: null, zone: "IRAN" }
    : { city: "بین‌الملل", country: null, zone: "ABROAD" };
}

/**
 * Numbers already taken for a city, read from existing display names such as
 * «تهران ۲، ایران» / «تهران ۴» / «فرانکفورت، آلمان» (unnumbered = 1).
 */
export function usedCityNumbers(
  city: string,
  existingDisplayNames: string[],
): Set<number> {
  const used = new Set<number>();
  const pattern = new RegExp(`^${city}(?:\\s+([۰-۹0-9]+))?\\s*(?:،|$)`);
  for (const name of existingDisplayNames) {
    const match = pattern.exec(name.trim());
    if (!match) continue;
    used.add(match[1] ? Number(faToLatinDigits(match[1])) : 1);
  }
  return used;
}

/**
 * Deterministic next name for a brand-new region of a city. Pure — pass in
 * every display name already stored (across providers, so آروان and پارس‌پک
 * can never both mint «تهران ۶»).
 */
export function nextRegionDisplayName(
  inferred: InferredRegionCity & { preferredNumber?: number | null },
  existingDisplayNames: string[],
): string {
  const used = usedCityNumbers(inferred.city, existingDisplayNames);
  let number =
    inferred.preferredNumber && !used.has(inferred.preferredNumber)
      ? inferred.preferredNumber
      : null;
  if (number == null) {
    number = 1;
    while (used.has(number)) number += 1;
  }
  // The first site of a city keeps the bare city name; numbering starts the
  // moment a second site appears, matching the curated names already stored.
  const cityPart =
    number === 1 && used.size === 0
      ? inferred.city
      : `${inferred.city} ${toFaDigits(number)}`;
  return inferred.country ? `${cityPart}، ${inferred.country}` : cityPart;
}

/**
 * The one entry point discovery uses for a region with no curated name.
 * Layer 2 then layer 3 — never the provider's label, never the raw code.
 */
export function assignRegionDisplayName(
  regionCode: string,
  existingDisplayNames: string[],
): string {
  const inferred = inferRegionCity(regionCode) ?? {
    ...fallbackRegionCity(regionCode),
    preferredNumber: null,
  };
  return nextRegionDisplayName(inferred, existingDisplayNames);
}

/** «تهران ۴، ایران» → «تهران ۴» — the short label used inside server titles. */
export function regionShortLabelFromDisplayName(displayName: string): string {
  return displayName.split("،")[0]!.trim();
}
