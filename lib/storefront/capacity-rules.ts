import type { StorefrontChinishTier } from "@prisma/client";

export type StorefrontCapacityRules = {
  ostovarMinVcpu: number;
  ostovarMinRamGb: number;
  ostovarMinDiskGb: number;
  kahkeshanMinVcpu: number;
  kahkeshanMinRamGb: number;
  kahkeshanMinDiskGb: number;
};

export const DEFAULT_STOREFRONT_CAPACITY_RULES: StorefrontCapacityRules = {
  ostovarMinVcpu: 6,
  ostovarMinRamGb: 12,
  ostovarMinDiskGb: 100,
  kahkeshanMinVcpu: 16,
  kahkeshanMinRamGb: 32,
  kahkeshanMinDiskGb: 200,
};

export function meetsCapacityFloor(
  resources: { vcpu: number; ramGb: number; diskGb: number },
  floor: { minVcpu: number; minRamGb: number; minDiskGb: number },
) {
  return (
    resources.vcpu >= floor.minVcpu &&
    resources.ramGb >= floor.minRamGb &&
    resources.diskGb >= floor.minDiskGb
  );
}

export function classifyStorefrontCapacityTier(
  resources: { vcpu: number; ramGb: number; diskGb: number },
  rules: StorefrontCapacityRules,
): StorefrontChinishTier {
  if (
    meetsCapacityFloor(resources, {
      minVcpu: rules.kahkeshanMinVcpu,
      minRamGb: rules.kahkeshanMinRamGb,
      minDiskGb: rules.kahkeshanMinDiskGb,
    })
  ) {
    return "KAHKESHAN";
  }
  if (
    meetsCapacityFloor(resources, {
      minVcpu: rules.ostovarMinVcpu,
      minRamGb: rules.ostovarMinRamGb,
      minDiskGb: rules.ostovarMinDiskGb,
    })
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
    rules.kahkeshanMinRamGb < rules.ostovarMinRamGb ||
    rules.kahkeshanMinDiskGb < rules.ostovarMinDiskGb
  ) {
    throw new Error("storefront_capacity_order_invalid");
  }
  return rules;
}
