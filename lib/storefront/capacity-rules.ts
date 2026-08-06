import type { StorefrontChinishTier } from "@prisma/client";

/**
 * Chinish capacity tiers are classified by vCPU + RAM only.
 * Disk remains a displayed/filterable attribute but never moves a plan between
 * نو / استوار / کهکشان. Legacy `*MinDiskGb` columns stay in the DB for
 * forward-compatible Admin settings and are ignored by classification.
 */
export type StorefrontCapacityRules = {
  ostovarMinVcpu: number;
  ostovarMinRamGb: number;
  /** Legacy / unused for tier classification (Disk is not a tier axis). */
  ostovarMinDiskGb: number;
  kahkeshanMinVcpu: number;
  kahkeshanMinRamGb: number;
  /** Legacy / unused for tier classification (Disk is not a tier axis). */
  kahkeshanMinDiskGb: number;
};

export const DEFAULT_STOREFRONT_CAPACITY_RULES: StorefrontCapacityRules = {
  ostovarMinVcpu: 6,
  ostovarMinRamGb: 12,
  ostovarMinDiskGb: 0,
  kahkeshanMinVcpu: 16,
  kahkeshanMinRamGb: 32,
  kahkeshanMinDiskGb: 0,
};

export function meetsCapacityFloor(
  resources: { vcpu: number; ramGb: number },
  floor: { minVcpu: number; minRamGb: number },
) {
  return resources.vcpu >= floor.minVcpu && resources.ramGb >= floor.minRamGb;
}

export function classifyStorefrontCapacityTier(
  resources: { vcpu: number; ramGb: number; diskGb?: number },
  rules: StorefrontCapacityRules,
): StorefrontChinishTier {
  if (
    meetsCapacityFloor(
      { vcpu: resources.vcpu, ramGb: resources.ramGb },
      {
        minVcpu: rules.kahkeshanMinVcpu,
        minRamGb: rules.kahkeshanMinRamGb,
      },
    )
  ) {
    return "KAHKESHAN";
  }
  if (
    meetsCapacityFloor(
      { vcpu: resources.vcpu, ramGb: resources.ramGb },
      {
        minVcpu: rules.ostovarMinVcpu,
        minRamGb: rules.ostovarMinRamGb,
      },
    )
  ) {
    return "OSTOVAR";
  }
  return "NO";
}

export function parseStorefrontCapacityRules(
  input: Partial<Record<keyof StorefrontCapacityRules, unknown>>,
): StorefrontCapacityRules {
  function read(key: keyof StorefrontCapacityRules, fallback: number) {
    const value = input[key];
    if (value === undefined || value === null) return fallback;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw new Error("storefront_invalid_capacity_rule");
    }
    return value;
  }
  const rules: StorefrontCapacityRules = {
    ostovarMinVcpu: read(
      "ostovarMinVcpu",
      DEFAULT_STOREFRONT_CAPACITY_RULES.ostovarMinVcpu,
    ),
    ostovarMinRamGb: read(
      "ostovarMinRamGb",
      DEFAULT_STOREFRONT_CAPACITY_RULES.ostovarMinRamGb,
    ),
    // Disk thresholds are retained for migration/admin compatibility only.
    ostovarMinDiskGb: read(
      "ostovarMinDiskGb",
      DEFAULT_STOREFRONT_CAPACITY_RULES.ostovarMinDiskGb,
    ),
    kahkeshanMinVcpu: read(
      "kahkeshanMinVcpu",
      DEFAULT_STOREFRONT_CAPACITY_RULES.kahkeshanMinVcpu,
    ),
    kahkeshanMinRamGb: read(
      "kahkeshanMinRamGb",
      DEFAULT_STOREFRONT_CAPACITY_RULES.kahkeshanMinRamGb,
    ),
    kahkeshanMinDiskGb: read(
      "kahkeshanMinDiskGb",
      DEFAULT_STOREFRONT_CAPACITY_RULES.kahkeshanMinDiskGb,
    ),
  };
  if (
    rules.kahkeshanMinVcpu < rules.ostovarMinVcpu ||
    rules.kahkeshanMinRamGb < rules.ostovarMinRamGb
  ) {
    throw new Error("storefront_capacity_order_invalid");
  }
  return rules;
}
