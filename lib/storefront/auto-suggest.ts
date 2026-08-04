import type {
  ProviderCatalogItem,
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
  STOREFRONT_PRIMARY_LIMIT,
  STOREFRONT_RESERVE_LIMIT,
  STOREFRONT_TIERS,
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

function diversifyPick(
  ranked: RankedItem[],
  limit: number,
  compare: (a: RankedItem, b: RankedItem) => number,
): RankedItem[] {
  const sorted = [...ranked].sort(compare);
  const picked: RankedItem[] = [];
  const regionCounts = new Map<string, number>();
  const sizeCounts = new Map<string, number>();

  for (const candidate of sorted) {
    if (picked.length >= limit) break;
    const regionKey = `${candidate.item.provider}:${candidate.item.regionCode}`;
    const sizeKey = `${candidate.item.provider}:${candidate.item.sizeCode}`;
    const regionCount = regionCounts.get(regionKey) ?? 0;
    const sizeCount = sizeCounts.get(sizeKey) ?? 0;
    // Keep some geographic/size diversity inside each tier.
    if (regionCount >= 6 || sizeCount >= 2) continue;
    picked.push(candidate);
    regionCounts.set(regionKey, regionCount + 1);
    sizeCounts.set(sizeKey, sizeCount + 1);
  }

  if (picked.length < limit) {
    for (const candidate of sorted) {
      if (picked.length >= limit) break;
      if (picked.some((row) => row.item.id === candidate.item.id)) continue;
      picked.push(candidate);
    }
  }
  return picked;
}

function slotsFor(
  primary: RankedItem[],
  reservePool: RankedItem[],
  usedIds: Set<string>,
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
    (a, b) => {
      if (a.hourly !== b.hourly) return a.hourly < b.hourly ? -1 : 1;
      return b.powerScore - a.powerScore;
    },
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

export function buildSuggestedStorefrontAssortment(
  items: ProviderCatalogItem[],
): Record<StorefrontChinishTier, StorefrontSlotInput[]> {
  const ranked = items
    .map(toRanked)
    .filter((row): row is RankedItem => row != null);

  const used = new Set<string>();

  // چینش نو: cheapest useful plans
  const noPrimary = diversifyPick(
    ranked.filter((row) => !used.has(row.item.id) && row.vcpu <= 4 && row.ramGb <= 8),
    STOREFRONT_PRIMARY_LIMIT,
    (a, b) => {
      if (a.economyScore !== b.economyScore) {
        return a.economyScore - b.economyScore;
      }
      return a.powerScore - b.powerScore;
    },
  );
  if (noPrimary.length < STOREFRONT_PRIMARY_LIMIT) {
    const pickedIds = new Set(noPrimary.map((row) => row.item.id));
    const extra = diversifyPick(
      ranked.filter(
        (row) => !used.has(row.item.id) && !pickedIds.has(row.item.id),
      ),
      STOREFRONT_PRIMARY_LIMIT - noPrimary.length,
      (a, b) => a.economyScore - b.economyScore,
    );
    noPrimary.push(...extra);
  }
  const noSlots = slotsFor(noPrimary, ranked, used);

  // چینش استوار: mid power / best balance score
  const ostovarPool = ranked.filter(
    (row) =>
      !used.has(row.item.id) &&
      row.vcpu >= 2 &&
      row.vcpu <= 16 &&
      row.ramGb >= 4 &&
      row.ramGb <= 64,
  );
  const ostovarPrimary = diversifyPick(
    ostovarPool,
    STOREFRONT_PRIMARY_LIMIT,
    (a, b) => {
      if (a.balanceScore !== b.balanceScore) {
        return b.balanceScore - a.balanceScore;
      }
      return a.economyScore - b.economyScore;
    },
  );
  const ostovarSlots = slotsFor(ostovarPrimary, ranked, used);

  // چینش کهکشان: strongest remaining plans
  const kahkeshanPrimary = diversifyPick(
    ranked.filter((row) => !used.has(row.item.id)),
    STOREFRONT_PRIMARY_LIMIT,
    (a, b) => {
      if (a.powerScore !== b.powerScore) return b.powerScore - a.powerScore;
      return a.economyScore - b.economyScore;
    },
  );
  const kahkeshanSlots = slotsFor(kahkeshanPrimary, ranked, used);

  return {
    NO: noSlots,
    OSTOVAR: ostovarSlots,
    KAHKESHAN: kahkeshanSlots,
  };
}

export async function getStorefrontAssortmentSettings() {
  return prisma.storefrontAssortmentSettings.upsert({
    where: { id: "default" },
    create: { id: "default", autoSuggestEnabled: false },
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
    },
    update: {
      autoSuggestEnabled: input.enabled,
      updatedById: input.actorUserId,
    },
  });
}

export async function applySuggestedStorefrontAssortment(input: {
  actorUserId: string | null;
  enableAuto?: boolean;
}) {
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
  const suggestion = buildSuggestedStorefrontAssortment(items);

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

export async function maybeAutoApplyStorefrontAssortment() {
  const settings = await getStorefrontAssortmentSettings();
  if (!settings.autoSuggestEnabled) {
    return { applied: false as const, reason: "disabled" as const };
  }
  const result = await applySuggestedStorefrontAssortment({
    actorUserId: null,
    enableAuto: true,
  });
  return { applied: true as const, result };
}
