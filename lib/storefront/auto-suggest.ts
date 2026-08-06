import type {
  ProviderCatalogItem,
  StorefrontAssortmentStyle,
  StorefrontChinishTier,
  StorefrontSlotRole,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  catalogItemBaseHourlyPriceRial,
  catalogItemBasePriceRial,
} from "@/lib/pricing/plan-pricing";
import type { StorefrontSlotInput } from "@/lib/storefront/assortment-service";
import {
  classifyStorefrontCapacityTier,
  DEFAULT_STOREFRONT_CAPACITY_RULES,
  parseStorefrontCapacityRules,
  type StorefrontCapacityRules,
} from "@/lib/storefront/capacity-rules";
import {
  DEFAULT_STOREFRONT_ASSORTMENT_STYLE,
  DEFAULT_STOREFRONT_PRICE_BANDS,
  offerMatchesTierPriceBand,
  parseStorefrontAssortmentStyle,
  parseStorefrontPriceBands,
  priceBandsFromSettings,
  priceBandsToDbFields,
  rialToTomanNumber,
  type StorefrontPriceBands,
} from "@/lib/storefront/price-bands";
import { storefrontLocationZone } from "@/lib/storefront/presentation";
import {
  STOREFRONT_PRIMARY_LIMIT,
  STOREFRONT_RESERVE_LIMIT,
  STOREFRONT_TIERS,
  STOREFRONT_ZONE_TARGET,
} from "@/lib/storefront/tiers";

type RankedItem = {
  item: ProviderCatalogItem;
  hourly: bigint;
  monthly: bigint;
  vcpu: number;
  ramGb: number;
  diskGb: number;
  powerScore: number;
  economyScore: number;
  balanceScore: number;
};

function toRanked(item: ProviderCatalogItem): RankedItem | null {
  if (!item.active || !item.available || item.status !== "ACTIVE") return null;
  const hourly = catalogItemBaseHourlyPriceRial(item);
  const monthly = catalogItemBasePriceRial(item);
  if (
    (hourly == null || hourly <= 0n) &&
    (monthly == null || monthly <= 0n)
  ) {
    return null;
  }
  const effectiveHourly =
    hourly != null && hourly > 0n
      ? hourly
      : monthly != null && monthly > 0n
        ? monthly / 720n
        : 0n;
  if (effectiveHourly <= 0n) return null;
  const vcpu = item.vcpu ?? 0;
  const ramGb = item.ramMb == null ? 0 : Math.ceil(item.ramMb / 1024);
  const diskGb = item.diskGb ?? 0;
  if (vcpu <= 0 || ramGb <= 0) return null;
  const powerScore = vcpu * 1000 + ramGb * 10 + diskGb;
  const priceNumber = Number(effectiveHourly);
  if (!Number.isFinite(priceNumber) || priceNumber <= 0) return null;
  const economyScore = priceNumber;
  const balanceScore = powerScore / priceNumber;
  return {
    item,
    hourly: effectiveHourly,
    monthly: monthly ?? 0n,
    vcpu,
    ramGb,
    diskGb,
    powerScore,
    economyScore,
    balanceScore,
  };
}

function resourceFingerprint(row: RankedItem) {
  return `${row.vcpu}:${row.ramGb}:${row.diskGb}`;
}

function diversifyPick(
  ranked: RankedItem[],
  limit: number,
  compare: (a: RankedItem, b: RankedItem) => number,
): RankedItem[] {
  const sorted = [...ranked].sort(compare);
  const picked: RankedItem[] = [];
  const regionCounts = new Map<string, number>();
  const seenResources = new Set<string>();
  const zoneCounts = { IRAN: 0, ABROAD: 0 };

  function accept(candidate: RankedItem, enforceZoneBalance: boolean) {
    if (picked.length >= limit) return false;
    if (picked.some((row) => row.item.id === candidate.item.id)) return false;
    const regionKey = `${candidate.item.provider}:${candidate.item.regionCode}`;
    const resourcesKey = resourceFingerprint(candidate);
    const regionCount = regionCounts.get(regionKey) ?? 0;
    if (seenResources.has(resourcesKey)) return false;
    if (regionCount >= 6) return false;
    const zone = storefrontLocationZone(candidate.item.regionCode);
    if (enforceZoneBalance && zoneCounts[zone] >= STOREFRONT_ZONE_TARGET) {
      return false;
    }
    picked.push(candidate);
    seenResources.add(resourcesKey);
    regionCounts.set(regionKey, regionCount + 1);
    zoneCounts[zone] += 1;
    return true;
  }

  // Prefer balanced Iran / abroad seats first.
  for (const candidate of sorted) {
    if (picked.length >= Math.min(limit, STOREFRONT_ZONE_TARGET * 2)) break;
    accept(candidate, true);
  }
  for (const candidate of sorted) {
    if (picked.length >= limit) break;
    accept(candidate, false);
  }
  return picked;
}

function slotsFor(
  primary: RankedItem[],
  reservePool: RankedItem[],
  usedIds: Set<string>,
  compare: (a: RankedItem, b: RankedItem) => number,
): StorefrontSlotInput[] {
  const primarySlots = primary.map((row, sortOrder) => {
    usedIds.add(row.item.id);
    return {
      catalogItemId: row.item.id,
      role: "PRIMARY" as StorefrontSlotRole,
      sortOrder,
      enabled: true,
    };
  });
  const reserve = diversifyPick(
    reservePool.filter((row) => !usedIds.has(row.item.id)),
    STOREFRONT_RESERVE_LIMIT,
    compare,
  );
  const reserveSlots = reserve.map((row, sortOrder) => {
    usedIds.add(row.item.id);
    return {
      catalogItemId: row.item.id,
      role: "RESERVE" as StorefrontSlotRole,
      sortOrder,
      enabled: true,
    };
  });
  return [...primarySlots, ...reserveSlots];
}

function compareByAssortmentStyle(
  style: StorefrontAssortmentStyle,
): (a: RankedItem, b: RankedItem) => number {
  if (style === "STRONGEST") {
    return (a, b) => {
      if (a.powerScore !== b.powerScore) return b.powerScore - a.powerScore;
      return a.economyScore - b.economyScore;
    };
  }
  return (a, b) => {
    if (a.economyScore !== b.economyScore) {
      return a.economyScore - b.economyScore;
    }
    return b.powerScore - a.powerScore;
  };
}

export function buildSuggestedStorefrontAssortment(
  items: ProviderCatalogItem[],
  rules: StorefrontCapacityRules = DEFAULT_STOREFRONT_CAPACITY_RULES,
  options?: {
    priceBands?: StorefrontPriceBands;
    style?: StorefrontAssortmentStyle;
  },
): Record<StorefrontChinishTier, StorefrontSlotInput[]> {
  const priceBands = options?.priceBands ?? DEFAULT_STOREFRONT_PRICE_BANDS;
  const style = options?.style ?? DEFAULT_STOREFRONT_ASSORTMENT_STYLE;
  const compare = compareByAssortmentStyle(style);
  const ranked = items
    .map(toRanked)
    .filter((row): row is RankedItem => row != null)
    .map((row) => ({
      ...row,
      capacityTier: classifyStorefrontCapacityTier(
        { vcpu: row.vcpu, ramGb: row.ramGb, diskGb: row.diskGb },
        rules,
      ),
    }));

  const used = new Set<string>();

  function pickForTier(tier: StorefrontChinishTier) {
    // Exclusive capacity bands + Admin monthly price band for that tier.
    const band = priceBands[tier];
    const pool = ranked.filter((row) => {
      if (used.has(row.item.id) || row.capacityTier !== tier) return false;
      const monthly =
        row.monthly > 0n
          ? row.monthly
          : row.hourly > 0n
            ? row.hourly * 720n
            : 0n;
      return offerMatchesTierPriceBand(monthly, band);
    });
    const primary = diversifyPick(pool, STOREFRONT_PRIMARY_LIMIT, compare);
    return slotsFor(primary, pool, used, compare);
  }

  return {
    NO: pickForTier("NO"),
    OSTOVAR: pickForTier("OSTOVAR"),
    KAHKESHAN: pickForTier("KAHKESHAN"),
  };
}

export function toStorefrontSettingsView(
  settings: Awaited<ReturnType<typeof getStorefrontAssortmentSettings>>,
) {
  const bands = priceBandsFromSettings(settings);
  return {
    autoSuggestEnabled: settings.autoSuggestEnabled,
    lastAutoAppliedAt: settings.lastAutoAppliedAt?.toISOString() ?? null,
    capacityRules: {
      ostovarMinVcpu: settings.ostovarMinVcpu,
      ostovarMinRamGb: settings.ostovarMinRamGb,
      ostovarMinDiskGb: settings.ostovarMinDiskGb,
      kahkeshanMinVcpu: settings.kahkeshanMinVcpu,
      kahkeshanMinRamGb: settings.kahkeshanMinRamGb,
      kahkeshanMinDiskGb: settings.kahkeshanMinDiskGb,
    },
    priceDisplay: {
      showHourlyPrice: settings.showHourlyPrice,
      showDailyPrice: settings.showDailyPrice,
      showMonthlyPrice: settings.showMonthlyPrice,
    },
    assortmentStyle: settings.assortmentStyle,
    /** Admin form values in تومان (integer). Empty max = unlimited. */
    priceBandsToman: {
      NO: {
        min: rialToTomanNumber(bands.NO.minMonthlyPriceRial),
        max: toTierMaxToman(bands.NO.maxMonthlyPriceRial),
      },
      OSTOVAR: {
        min: rialToTomanNumber(bands.OSTOVAR.minMonthlyPriceRial),
        max: toTierMaxToman(bands.OSTOVAR.maxMonthlyPriceRial),
      },
      KAHKESHAN: {
        min: rialToTomanNumber(bands.KAHKESHAN.minMonthlyPriceRial),
        max: toTierMaxToman(bands.KAHKESHAN.maxMonthlyPriceRial),
      },
    },
  };
}

function toTierMaxToman(maxRial: bigint | null | undefined): number | "" {
  if (maxRial == null) return "";
  return rialToTomanNumber(maxRial);
}

export async function getStorefrontAssortmentSettings() {
  return prisma.storefrontAssortmentSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      autoSuggestEnabled: false,
      ...DEFAULT_STOREFRONT_CAPACITY_RULES,
    },
    update: {},
  });
}

export async function setStorefrontAutoSuggestEnabled(input: {
  enabled: boolean;
  actorUserId: string | null;
}) {
  return prisma.storefrontAssortmentSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      autoSuggestEnabled: input.enabled,
      updatedById: input.actorUserId,
      ...DEFAULT_STOREFRONT_CAPACITY_RULES,
    },
    update: {
      autoSuggestEnabled: input.enabled,
      updatedById: input.actorUserId,
    },
  });
}

export async function updateStorefrontPriceDisplay(input: {
  showHourlyPrice: boolean;
  showDailyPrice: boolean;
  showMonthlyPrice: boolean;
  actorUserId: string | null;
}) {
  if (
    !input.showHourlyPrice &&
    !input.showDailyPrice &&
    !input.showMonthlyPrice
  ) {
    throw new Error("storefront_price_display_empty");
  }
  return prisma.storefrontAssortmentSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      autoSuggestEnabled: false,
      ...DEFAULT_STOREFRONT_CAPACITY_RULES,
      showHourlyPrice: input.showHourlyPrice,
      showDailyPrice: input.showDailyPrice,
      showMonthlyPrice: input.showMonthlyPrice,
      updatedById: input.actorUserId,
    },
    update: {
      showHourlyPrice: input.showHourlyPrice,
      showDailyPrice: input.showDailyPrice,
      showMonthlyPrice: input.showMonthlyPrice,
      updatedById: input.actorUserId,
    },
  });
}

export async function updateStorefrontCapacityRules(input: {
  rules: StorefrontCapacityRules;
  actorUserId: string | null;
}) {
  const rules = parseStorefrontCapacityRules(input.rules);
  return prisma.storefrontAssortmentSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      autoSuggestEnabled: false,
      updatedById: input.actorUserId,
      ...rules,
    },
    update: {
      ...rules,
      updatedById: input.actorUserId,
    },
  });
}

export async function updateStorefrontPriceBandsAndStyle(input: {
  priceBands: StorefrontPriceBands;
  assortmentStyle: StorefrontAssortmentStyle;
  actorUserId: string | null;
}) {
  const bands = parseStorefrontPriceBands(priceBandsToDbFields(input.priceBands));
  const style = parseStorefrontAssortmentStyle(input.assortmentStyle);
  const dbBands = priceBandsToDbFields(bands);
  return prisma.storefrontAssortmentSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      autoSuggestEnabled: false,
      ...DEFAULT_STOREFRONT_CAPACITY_RULES,
      ...dbBands,
      assortmentStyle: style,
      updatedById: input.actorUserId,
    },
    update: {
      ...dbBands,
      assortmentStyle: style,
      updatedById: input.actorUserId,
    },
  });
}

export async function applySuggestedStorefrontAssortment(input: {
  actorUserId: string | null;
  enableAuto?: boolean;
}) {
  const settings = await getStorefrontAssortmentSettings();
  const rules: StorefrontCapacityRules = {
    ostovarMinVcpu: settings.ostovarMinVcpu,
    ostovarMinRamGb: settings.ostovarMinRamGb,
    ostovarMinDiskGb: settings.ostovarMinDiskGb,
    kahkeshanMinVcpu: settings.kahkeshanMinVcpu,
    kahkeshanMinRamGb: settings.kahkeshanMinRamGb,
    kahkeshanMinDiskGb: settings.kahkeshanMinDiskGb,
  };
  const priceBands = priceBandsFromSettings(settings);
  const items = await prisma.providerCatalogItem.findMany({
    where: {
      provider: { in: ["ARVAN", "PARSPACK"] },
      // ParsPack syncs as READY_INSTANT_SERVER; Arvan cloud as CLOUD_SERVER.
      productKind: { in: ["CLOUD_SERVER", "READY_INSTANT_SERVER"] },
      source: "API_CATALOG",
      active: true,
      available: true,
      status: "ACTIVE",
      OR: [
        { providerHourlyPriceIrr: { gt: 0n } },
        { providerMonthlyPriceIrr: { gt: 0n } },
      ],
    },
  });
  const suggestion = buildSuggestedStorefrontAssortment(items, rules, {
    priceBands,
    style: settings.assortmentStyle,
  });

  await prisma.$transaction(async (tx) => {
    for (const tier of STOREFRONT_TIERS) {
      const slots = suggestion[tier];
      await tx.storefrontAssortmentSlot.deleteMany({ where: { tier } });
      if (slots.length === 0) continue;
      await tx.storefrontAssortmentSlot.createMany({
        data: slots.map((slot) => ({
          tier,
          role: slot.role,
          sortOrder: slot.sortOrder,
          catalogItemId: slot.catalogItemId,
          enabled: true,
          updatedById: input.actorUserId,
        })),
      });
    }
    await tx.storefrontAssortmentSettings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        autoSuggestEnabled: input.enableAuto === true,
        lastAutoAppliedAt: new Date(),
        updatedById: input.actorUserId,
      },
      update: {
        ...(input.enableAuto == null
          ? {}
          : { autoSuggestEnabled: input.enableAuto }),
        lastAutoAppliedAt: new Date(),
        updatedById: input.actorUserId,
      },
    });
  });

  return {
    tiers: STOREFRONT_TIERS.map((tier) => ({
      tier,
      slotCount: suggestion[tier].length,
      primaryCount: suggestion[tier].filter((slot) => slot.role === "PRIMARY")
        .length,
      reserveCount: suggestion[tier].filter((slot) => slot.role === "RESERVE")
        .length,
    })),
  };
}

/** Public راهکار فوری list refreshes at most once per day when auto-suggest is on. */
export const STOREFRONT_AUTO_SUGGEST_INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function maybeAutoApplyStorefrontAssortment() {
  const settings = await getStorefrontAssortmentSettings();
  if (!settings.autoSuggestEnabled) {
    return { applied: false as const, reason: "disabled" as const };
  }
  if (
    settings.lastAutoAppliedAt &&
    Date.now() - settings.lastAutoAppliedAt.getTime() <
      STOREFRONT_AUTO_SUGGEST_INTERVAL_MS
  ) {
    return { applied: false as const, reason: "interval" as const };
  }
  const result = await applySuggestedStorefrontAssortment({
    actorUserId: null,
    enableAuto: true,
  });
  return { applied: true as const, result };
}
