import { storefrontLocationLabel } from "@/lib/storefront/presentation";

/**
 * Dominated-plan detection for the public catalog.
 *
 * A dominates B in the same comparable market when A is at least as strong on
 * vCPU/RAM/Disk, A is at most as expensive on the final commercial monthly
 * price, and at least one of those four axes is strictly better. Incomplete
 * resource rows never dominate. Among exact equals, keep the cheapest then
 * freshest purchasable plan.
 *
 * Provider identity is intentionally ignored: customers never see the supplier
 * name, so a weaker/expensive twin must not survive just because it came from
 * a different provider. Meaningful recorded commercial traits (traffic, disk
 * type, IPv4/IPv6) split the market so those plans are not compared.
 */

export type DominanceComparableTraits = {
  /** Normalized transfer / traffic string when the catalog has a real value. */
  transferKey: string | null;
  /** Disk type when a trusted catalog field exists (never invented). */
  diskTypeKey: string | null;
  /** IPv4 availability when known from provider payload. */
  ipv4Key: string | null;
  /** IPv6 availability when known from provider payload. */
  ipv6Key: string | null;
};

export type DominanceCandidate = {
  id: string;
  /** Customer-facing location key (city/country), not provider region id alone. */
  locationKey: string;
  productKind: string;
  deliveryMode: string;
  /** True when the plan can enter a new sale (priced + purchasable). */
  purchasable: boolean;
  vcpu: number | null;
  ramGb: number | null;
  diskGb: number | null;
  /** Final commercial monthly price in Rial from the Task-1 engine. */
  finalMonthlyPriceRial: bigint;
  /** Catalog freshness clock for equal-plan tie-break. */
  checkedAtMs: number;
  traits: DominanceComparableTraits;
};

export type DominanceRemovalReason =
  | "DOMINATED"
  | "DUPLICATE_EQUAL"
  | "INCOMPLETE_RESOURCES"
  | "NOT_PURCHASABLE";

export type DominanceRemoval = {
  candidateId: string;
  reason: DominanceRemovalReason;
  dominatedById?: string;
  detail: string;
  comparison?: {
    survivorId: string;
    removedId: string;
    survivor: {
      vcpu: number | null;
      ramGb: number | null;
      diskGb: number | null;
      finalMonthlyPriceRial: string;
    };
    removed: {
      vcpu: number | null;
      ramGb: number | null;
      diskGb: number | null;
      finalMonthlyPriceRial: string;
    };
  };
};

export type DominanceFilterResult<T extends DominanceCandidate> = {
  kept: T[];
  removed: DominanceRemoval[];
  stats: {
    rawCount: number;
    incompleteCount: number;
    notPurchasableCount: number;
    duplicateCount: number;
    dominatedCount: number;
    finalCount: number;
  };
};

export function normalizeTransferTrait(
  transfer: string | null | undefined,
): string | null {
  if (transfer == null) return null;
  const trimmed = transfer.trim();
  if (!trimmed || trimmed === "0" || /^n\/?a$/i.test(trimmed)) return null;
  return trimmed.toLowerCase().replace(/\s+/g, " ");
}

/**
 * Extract optional commercial traits from a catalog raw payload without
 * inventing values the provider did not supply.
 */
export function extractCatalogCommercialTraits(input: {
  transfer?: string | null;
  rawPayload?: unknown;
}): DominanceComparableTraits {
  const transferKey = normalizeTransferTrait(input.transfer);
  let diskTypeKey: string | null = null;
  let ipv4Key: string | null = null;
  let ipv6Key: string | null = null;

  const payload =
    input.rawPayload &&
    typeof input.rawPayload === "object" &&
    !Array.isArray(input.rawPayload)
      ? (input.rawPayload as Record<string, unknown>)
      : null;

  if (payload) {
    const diskType =
      readStringField(payload, [
        "disk_type",
        "diskType",
        "storage_type",
        "storageType",
        "volume_type",
        "volumeType",
      ]) ??
      readNestedString(payload, ["disk", "type"]) ??
      readNestedString(payload, ["storage", "type"]);
    if (diskType) diskTypeKey = diskType.toLowerCase();

    const ipv4 =
      readBoolishField(payload, ["ipv4", "has_ipv4", "hasIpv4", "public_ipv4"]) ??
      readNestedBoolish(payload, ["network", "ipv4"]);
    if (ipv4 != null) ipv4Key = ipv4 ? "yes" : "no";

    const ipv6 =
      readBoolishField(payload, ["ipv6", "has_ipv6", "hasIpv6", "public_ipv6"]) ??
      readNestedBoolish(payload, ["network", "ipv6"]);
    if (ipv6 != null) ipv6Key = ipv6 ? "yes" : "no";
  }

  return { transferKey, diskTypeKey, ipv4Key, ipv6Key };
}

function readStringField(
  payload: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readNestedString(
  payload: Record<string, unknown>,
  path: [string, string],
): string | null {
  const nested = payload[path[0]];
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
    return null;
  }
  const value = (nested as Record<string, unknown>)[path[1]];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBoolishField(
  payload: Record<string, unknown>,
  keys: string[],
): boolean | null {
  for (const key of keys) {
    const parsed = coerceBoolish(payload[key]);
    if (parsed != null) return parsed;
  }
  return null;
}

function readNestedBoolish(
  payload: Record<string, unknown>,
  path: [string, string],
): boolean | null {
  const nested = payload[path[0]];
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
    return null;
  }
  return coerceBoolish((nested as Record<string, unknown>)[path[1]]);
}

function coerceBoolish(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "enabled", "available"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "disabled", "unavailable"].includes(normalized)) {
      return false;
    }
  }
  return null;
}

export function dominanceMarketKey(candidate: DominanceCandidate): string {
  const traits = candidate.traits;
  return [
    candidate.locationKey,
    candidate.productKind,
    candidate.deliveryMode,
    traits.transferKey ?? "transfer:unset",
    traits.diskTypeKey ?? "disk:unset",
    traits.ipv4Key ?? "ipv4:unset",
    traits.ipv6Key ?? "ipv6:unset",
  ].join("|");
}

export function hasCompleteResources(candidate: DominanceCandidate): boolean {
  return (
    candidate.vcpu != null &&
    candidate.vcpu > 0 &&
    candidate.ramGb != null &&
    candidate.ramGb > 0 &&
    candidate.diskGb != null &&
    candidate.diskGb > 0
  );
}

/**
 * True when A dominates B (same market assumed by caller).
 * Incomplete A never dominates.
 */
export function planDominates(
  a: DominanceCandidate,
  b: DominanceCandidate,
): boolean {
  if (!hasCompleteResources(a) || !hasCompleteResources(b)) return false;
  const vcpuGe = a.vcpu! >= b.vcpu!;
  const ramGe = a.ramGb! >= b.ramGb!;
  const diskGe = a.diskGb! >= b.diskGb!;
  const priceLe = a.finalMonthlyPriceRial <= b.finalMonthlyPriceRial;
  if (!(vcpuGe && ramGe && diskGe && priceLe)) return false;
  return (
    a.vcpu! > b.vcpu! ||
    a.ramGb! > b.ramGb! ||
    a.diskGb! > b.diskGb! ||
    a.finalMonthlyPriceRial < b.finalMonthlyPriceRial
  );
}

function resourcesEqual(a: DominanceCandidate, b: DominanceCandidate): boolean {
  return (
    a.vcpu === b.vcpu &&
    a.ramGb === b.ramGb &&
    a.diskGb === b.diskGb &&
    a.finalMonthlyPriceRial === b.finalMonthlyPriceRial
  );
}

/** Prefer cheaper, then fresher, then stable id. */
export function compareDominancePreference(
  a: DominanceCandidate,
  b: DominanceCandidate,
): number {
  if (a.finalMonthlyPriceRial !== b.finalMonthlyPriceRial) {
    return a.finalMonthlyPriceRial < b.finalMonthlyPriceRial ? -1 : 1;
  }
  if (a.checkedAtMs !== b.checkedAtMs) {
    return a.checkedAtMs > b.checkedAtMs ? -1 : 1;
  }
  return a.id.localeCompare(b.id);
}

/** Default public catalog sort: final price, RAM, CPU, Disk. */
export function comparePublicCatalogOffers(
  a: DominanceCandidate,
  b: DominanceCandidate,
): number {
  if (a.finalMonthlyPriceRial !== b.finalMonthlyPriceRial) {
    return a.finalMonthlyPriceRial < b.finalMonthlyPriceRial ? -1 : 1;
  }
  const ramA = a.ramGb ?? 0;
  const ramB = b.ramGb ?? 0;
  if (ramA !== ramB) return ramA - ramB;
  const cpuA = a.vcpu ?? 0;
  const cpuB = b.vcpu ?? 0;
  if (cpuA !== cpuB) return cpuA - cpuB;
  const diskA = a.diskGb ?? 0;
  const diskB = b.diskGb ?? 0;
  if (diskA !== diskB) return diskA - diskB;
  return a.id.localeCompare(b.id);
}

function comparisonPayload(survivor: DominanceCandidate, removed: DominanceCandidate) {
  return {
    survivorId: survivor.id,
    removedId: removed.id,
    survivor: {
      vcpu: survivor.vcpu,
      ramGb: survivor.ramGb,
      diskGb: survivor.diskGb,
      finalMonthlyPriceRial: survivor.finalMonthlyPriceRial.toString(),
    },
    removed: {
      vcpu: removed.vcpu,
      ramGb: removed.ramGb,
      diskGb: removed.diskGb,
      finalMonthlyPriceRial: removed.finalMonthlyPriceRial.toString(),
    },
  };
}

/**
 * Filter dominated / duplicate plans. Non-purchasable and incomplete rows are
 * reported for Admin diagnostics but never kept in the public set.
 */
export function filterDominatedPlans<T extends DominanceCandidate>(
  candidates: T[],
): DominanceFilterResult<T> {
  const removed: DominanceRemoval[] = [];
  const incomplete: T[] = [];
  const notPurchasable: T[] = [];
  const eligible: T[] = [];

  for (const candidate of candidates) {
    if (!candidate.purchasable) {
      notPurchasable.push(candidate);
      removed.push({
        candidateId: candidate.id,
        reason: "NOT_PURCHASABLE",
        detail: "پلن برای فروش عمومی قابل خرید نیست.",
      });
      continue;
    }
    if (!hasCompleteResources(candidate)) {
      incomplete.push(candidate);
      removed.push({
        candidateId: candidate.id,
        reason: "INCOMPLETE_RESOURCES",
        detail: "منبع ناقص است و وارد Dominance نمی‌شود.",
      });
      continue;
    }
    eligible.push(candidate);
  }

  const byMarket = new Map<string, T[]>();
  for (const candidate of eligible) {
    const key = dominanceMarketKey(candidate);
    const bucket = byMarket.get(key) ?? [];
    bucket.push(candidate);
    byMarket.set(key, bucket);
  }

  const kept: T[] = [];
  let duplicateCount = 0;
  let dominatedCount = 0;

  for (const bucket of byMarket.values()) {
    const sorted = [...bucket].sort(compareDominancePreference);
    const survivors: T[] = [];

    for (const candidate of sorted) {
      const equalSurvivor = survivors.find((s) => resourcesEqual(s, candidate));
      if (equalSurvivor) {
        duplicateCount += 1;
        removed.push({
          candidateId: candidate.id,
          reason: "DUPLICATE_EQUAL",
          dominatedById: equalSurvivor.id,
          detail:
            "پلن کاملاً یکسان؛ ارزان‌ترین و تازه‌ترین قابل‌خرید نگه داشته شد.",
          comparison: comparisonPayload(equalSurvivor, candidate),
        });
        continue;
      }

      const dominator = survivors.find((s) => planDominates(s, candidate));
      if (dominator) {
        dominatedCount += 1;
        removed.push({
          candidateId: candidate.id,
          reason: "DOMINATED",
          dominatedById: dominator.id,
          detail:
            "پلن مغلوب: منابع برابر/ضعیف‌تر با قیمت نهایی برابر/گران‌تر.",
          comparison: comparisonPayload(dominator, candidate),
        });
        continue;
      }

      // Drop any earlier survivor that this candidate now dominates.
      for (let i = survivors.length - 1; i >= 0; i -= 1) {
        const previous = survivors[i]!;
        if (planDominates(candidate, previous)) {
          dominatedCount += 1;
          removed.push({
            candidateId: previous.id,
            reason: "DOMINATED",
            dominatedById: candidate.id,
            detail:
              "پلن مغلوب: منابع برابر/ضعیف‌تر با قیمت نهایی برابر/گران‌تر.",
            comparison: comparisonPayload(candidate, previous),
          });
          survivors.splice(i, 1);
        }
      }
      survivors.push(candidate);
    }

    kept.push(...survivors);
  }

  kept.sort(comparePublicCatalogOffers);

  return {
    kept,
    removed,
    stats: {
      rawCount: candidates.length,
      incompleteCount: incomplete.length,
      notPurchasableCount: notPurchasable.length,
      duplicateCount,
      dominatedCount,
      finalCount: kept.length,
    },
  };
}

export function locationKeyForRegion(regionCode: string): string {
  return storefrontLocationLabel(regionCode);
}
