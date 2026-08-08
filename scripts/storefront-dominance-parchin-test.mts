import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  classifyStorefrontCapacityTier,
  DEFAULT_STOREFRONT_CAPACITY_RULES,
  parseStorefrontCapacityRules,
} from "../lib/storefront/capacity-rules.ts";
import {
  extractCatalogCommercialTraits,
  filterDominatedPlans,
  planDominates,
  type DominanceCandidate,
} from "../lib/storefront/dominance.ts";
import {
  storefrontParchinLevel,
  storefrontParchinTitle,
  storefrontTierDescription,
  storefrontTierLabel,
} from "../lib/storefront/tiers.ts";
import {
  DEFAULT_PARCHIN_SERVICE_CONTRACTS,
  defaultParchinContractForLevel,
  readParchinServiceSnapshot,
  snapshotParchinServiceContract,
  toParchinServiceContract,
} from "../lib/parchin/service-contract.ts";

function candidate(
  partial: Partial<DominanceCandidate> & Pick<DominanceCandidate, "id">,
): DominanceCandidate {
  return {
    locationKey: "تهران ایران",
    productKind: "CLOUD_SERVER",
    deliveryMode: "MANAGED",
    purchasable: true,
    vcpu: 4,
    ramGb: 8,
    diskGb: 80,
    finalMonthlyPriceRial: 1_000_000n,
    checkedAtMs: 1_000,
    traits: {
      transferKey: null,
      diskTypeKey: null,
      ipv4Key: null,
      ipv6Key: null,
    },
    ...partial,
  };
}

test("dominated plan detection removes weaker-or-equal expensive plans", () => {
  const strongCheap = candidate({
    id: "strong-cheap",
    vcpu: 8,
    ramGb: 16,
    diskGb: 160,
    finalMonthlyPriceRial: 900_000n,
    checkedAtMs: 2_000,
  });
  const weakExpensive = candidate({
    id: "weak-expensive",
    vcpu: 4,
    ramGb: 8,
    diskGb: 80,
    finalMonthlyPriceRial: 1_200_000n,
  });
  const equalResourcesCheaper = candidate({
    id: "equal-cheaper",
    vcpu: 4,
    ramGb: 8,
    diskGb: 80,
    finalMonthlyPriceRial: 800_000n,
    checkedAtMs: 3_000,
  });
  const result = filterDominatedPlans([
    weakExpensive,
    strongCheap,
    equalResourcesCheaper,
  ]);
  assert.equal(result.stats.dominatedCount >= 1, true);
  assert.ok(result.kept.some((row) => row.id === "strong-cheap"));
  assert.ok(result.kept.some((row) => row.id === "equal-cheaper"));
  assert.equal(
    result.kept.some((row) => row.id === "weak-expensive"),
    false,
  );
  assert.ok(planDominates(strongCheap, weakExpensive));
  assert.equal(planDominates(weakExpensive, strongCheap), false);
});

test("all non-dominated peers with different resources stay visible", () => {
  const a = candidate({
    id: "cpu-heavy",
    vcpu: 8,
    ramGb: 8,
    diskGb: 80,
    finalMonthlyPriceRial: 1_100_000n,
  });
  const b = candidate({
    id: "ram-heavy",
    vcpu: 4,
    ramGb: 16,
    diskGb: 80,
    finalMonthlyPriceRial: 1_100_000n,
  });
  const result = filterDominatedPlans([a, b]);
  assert.equal(result.stats.finalCount, 2);
  assert.equal(result.stats.dominatedCount, 0);
  assert.deepEqual(
    result.kept.map((row) => row.id).sort(),
    ["cpu-heavy", "ram-heavy"],
  );
});

test("equal duplicate keeps cheapest then freshest purchasable plan", () => {
  const older = candidate({
    id: "older",
    finalMonthlyPriceRial: 1_000_000n,
    checkedAtMs: 1_000,
  });
  const fresherSamePrice = candidate({
    id: "fresher",
    finalMonthlyPriceRial: 1_000_000n,
    checkedAtMs: 5_000,
  });
  const cheaper = candidate({
    id: "cheaper",
    finalMonthlyPriceRial: 900_000n,
    checkedAtMs: 2_000,
  });
  // cheaper is not equal to older (price differs) — it dominates them.
  const equalOnly = filterDominatedPlans([older, fresherSamePrice]);
  assert.equal(equalOnly.stats.duplicateCount, 1);
  assert.equal(equalOnly.kept.length, 1);
  assert.equal(equalOnly.kept[0]?.id, "fresher");

  const withCheaper = filterDominatedPlans([older, fresherSamePrice, cheaper]);
  assert.ok(withCheaper.kept.some((row) => row.id === "cheaper"));
  assert.equal(
    withCheaper.kept.some((row) => row.id === "older"),
    false,
  );
});

test("Tehran peers with different final commercial prices keep the better deal", () => {
  const tehranCheap = candidate({
    id: "thr-cheap",
    locationKey: "تهران ایران",
    vcpu: 4,
    ramGb: 8,
    diskGb: 100,
    finalMonthlyPriceRial: 2_000_000n,
  });
  const tehranExpensiveSame = candidate({
    id: "thr-expensive",
    locationKey: "تهران ایران",
    vcpu: 4,
    ramGb: 8,
    diskGb: 100,
    finalMonthlyPriceRial: 2_500_000n,
  });
  const abroad = candidate({
    id: "abroad",
    locationKey: "تورنتو کانادا",
    vcpu: 4,
    ramGb: 8,
    diskGb: 100,
    finalMonthlyPriceRial: 2_500_000n,
  });
  const result = filterDominatedPlans([
    tehranCheap,
    tehranExpensiveSame,
    abroad,
  ]);
  assert.ok(result.kept.some((row) => row.id === "thr-cheap"));
  assert.ok(result.kept.some((row) => row.id === "abroad"));
  assert.equal(
    result.kept.some((row) => row.id === "thr-expensive"),
    false,
  );
  const removal = result.removed.find(
    (row) => row.candidateId === "thr-expensive",
  );
  assert.ok(removal);
  assert.equal(removal?.reason, "DOMINATED");
  assert.equal(
    removal?.comparison?.survivor.finalMonthlyPriceRial,
    "2000000",
  );
});

test("dominance uses final commercial price axis, never invents missing traits", () => {
  const traits = extractCatalogCommercialTraits({
    transfer: "  ",
    rawPayload: { hello: "world" },
  });
  assert.equal(traits.transferKey, null);
  assert.equal(traits.diskTypeKey, null);
  assert.equal(traits.ipv4Key, null);

  const withTransfer = extractCatalogCommercialTraits({
    transfer: "5 TB",
    rawPayload: { disk_type: "NVMe", ipv4: true, ipv6: false },
  });
  assert.equal(withTransfer.transferKey, "5 tb");
  assert.equal(withTransfer.diskTypeKey, "nvme");
  assert.equal(withTransfer.ipv4Key, "yes");
  assert.equal(withTransfer.ipv6Key, "no");

  // Different recorded traffic → separate markets → both kept.
  const a = candidate({
    id: "a",
    traits: { ...withTransfer },
    finalMonthlyPriceRial: 1_000_000n,
  });
  const b = candidate({
    id: "b",
    vcpu: 2,
    ramGb: 4,
    diskGb: 40,
    finalMonthlyPriceRial: 2_000_000n,
    traits: {
      transferKey: "1 tb",
      diskTypeKey: null,
      ipv4Key: null,
      ipv6Key: null,
    },
  });
  const result = filterDominatedPlans([a, b]);
  assert.equal(result.stats.finalCount, 2);
});

test("incomplete resources never dominate another plan", () => {
  const incomplete = candidate({
    id: "incomplete",
    vcpu: 16,
    ramGb: null,
    diskGb: 200,
    finalMonthlyPriceRial: 100n,
  });
  const complete = candidate({
    id: "complete",
    vcpu: 2,
    ramGb: 4,
    diskGb: 40,
    finalMonthlyPriceRial: 9_000_000n,
  });
  assert.equal(planDominates(incomplete, complete), false);
  const result = filterDominatedPlans([incomplete, complete]);
  assert.equal(result.stats.incompleteCount, 1);
  assert.equal(result.kept.length, 1);
  assert.equal(result.kept[0]?.id, "complete");
});

test("chinish tier ignores Disk and uses vCPU + RAM only", () => {
  assert.equal(DEFAULT_STOREFRONT_CAPACITY_RULES.ostovarMinDiskGb, 0);
  assert.equal(DEFAULT_STOREFRONT_CAPACITY_RULES.kahkeshanMinDiskGb, 0);
  assert.equal(
    classifyStorefrontCapacityTier(
      { vcpu: 16, ramGb: 32, diskGb: 75 },
      DEFAULT_STOREFRONT_CAPACITY_RULES,
    ),
    "KAHKESHAN",
  );
  assert.equal(
    classifyStorefrontCapacityTier(
      { vcpu: 6, ramGb: 12, diskGb: 50 },
      DEFAULT_STOREFRONT_CAPACITY_RULES,
    ),
    "OSTOVAR",
  );
  assert.equal(
    classifyStorefrontCapacityTier(
      { vcpu: 2, ramGb: 4, diskGb: 500 },
      DEFAULT_STOREFRONT_CAPACITY_RULES,
    ),
    "NO",
  );
  const rules = parseStorefrontCapacityRules({
    ostovarMinVcpu: 6,
    ostovarMinRamGb: 12,
    kahkeshanMinVcpu: 16,
    kahkeshanMinRamGb: 32,
  });
  assert.equal(rules.ostovarMinDiskGb, 0);
  assert.equal(rules.kahkeshanMinDiskGb, 0);
  assert.throws(() =>
    parseStorefrontCapacityRules({
      ostovarMinVcpu: 16,
      ostovarMinRamGb: 32,
      kahkeshanMinVcpu: 6,
      kahkeshanMinRamGb: 12,
    }),
  );
});

test("customer-facing tier copy never exposes internal thresholds", () => {
  for (const tier of ["NO", "OSTOVAR", "KAHKESHAN"] as const) {
    const description = storefrontTierDescription(tier);
    assert.doesNotMatch(description, /کمتر از حداقل/);
    assert.doesNotMatch(description, /از حداقل/);
    assert.ok(storefrontTierLabel(tier).includes("چینش"));
  }
});

test("three production-grade Parchin contracts exist and snapshot immutably", () => {
  const start = defaultParchinContractForLevel("PARCHIN_START", {
    monthlyPriceRial: 5_000_000n,
    version: 1,
  });
  const active = defaultParchinContractForLevel("PARCHIN_ACTIVE", {
    monthlyPriceRial: 15_000_000n,
  });
  const stable = defaultParchinContractForLevel("PARCHIN_STABLE", {
    monthlyPriceRial: 50_000_000n,
  });
  assert.equal(start.subtitle, "سلامت پایه هر ماه");
  assert.equal(active.subtitle, "پایش، بکاپ و نگهداری");
  assert.equal(stable.subtitle, "عملیات Production");
  assert.ok(start.includedServices.includes("گزارش سلامت ماهانه با اقدام پیشنهادی"));
  assert.ok(start.excludedServices.includes("بکاپ مدیریت‌شده و آزمون Restore"));
  assert.ok(
    active.includedServices.includes(
      "بکاپ روزانه مدیریت‌شده با نگهداری هفت نسخه",
    ),
  );
  assert.equal(active.serviceLimits.continuousMonitoring, "included");
  assert.equal(active.serviceLimits.scheduledBackup, "included");
  assert.ok(stable.includedServices.includes("آزمون Restore ماهانه و ثبت نتیجه"));
  assert.ok(
    stable.excludedServices.some((item) => item.includes("DBA اختصاصی")),
  );
  assert.equal(stable.firstResponseTarget, "رخداد حیاتی حداکثر ۳۰ دقیقه");

  const snap = snapshotParchinServiceContract(start);
  const readBack = readParchinServiceSnapshot(snap);
  assert.ok(readBack);
  assert.equal(readBack?.version, 1);
  assert.equal(readBack?.title, "پرچین شروع");
  assert.deepEqual(readBack?.includedServices, start.includedServices);

  // Admin later edit must not mutate a prior snapshot object.
  const later = toParchinServiceContract({
    level: "PARCHIN_START",
    version: 2,
    title: "پرچین شروع جدید",
    subtitle: "تحویل امن",
    description: "متن تازه",
    priceRial: 9_000_000n,
    includedServices: ["only-new"],
    excludedServices: ["still-out"],
    active: true,
    effectiveFrom: new Date(),
  });
  assert.equal(later.version, 2);
  assert.equal(readBack?.title, "پرچین شروع");
  assert.equal(readBack?.version, 1);
  assert.equal(DEFAULT_PARCHIN_SERVICE_CONTRACTS.PARCHIN_START.version, 2);
});

test("Parchin v2 migration upgrades only untouched configs and preserves snapshots", async () => {
  const migration = await readFile(
    "prisma/migrations/20260808230000_parchin_operational_contract_v2/migration.sql",
    "utf8",
  );
  assert.match(migration, /WHERE "level" = 'PARCHIN_START' AND "version" = 1/);
  assert.match(migration, /WHERE "level" = 'PARCHIN_ACTIVE' AND "version" = 1/);
  assert.match(migration, /WHERE "level" = 'PARCHIN_STABLE' AND "version" = 1/);
  assert.match(migration, /پایش Uptime پنج‌دقیقه‌ای/);
  assert.match(migration, /آزمون Restore ماهانه/);
  assert.doesNotMatch(migration, /ServiceOrder|RecommendationQuote/);
  assert.doesNotMatch(migration, /\bDROP\b|\bTRUNCATE\b|\bDELETE\b/i);
});

test("storefront CTA opens the dedicated account configurator", async () => {
  const catalog = await readFile("components/chinish-cloud-catalog.tsx", "utf8");
  assert.match(catalog, /ساخت و تحویل کنترل‌شده توسط تیم ابرچین/);
  assert.match(catalog, /جزئیات خدمات/);
  assert.match(catalog, /ParchinDetailsDialog/);
  assert.doesNotMatch(catalog, /providerName/);
  assert.doesNotMatch(catalog, /\bARVAN\b|\bPARSPACK\b/);

  const button = await readFile(
    "components/ready-server-quote-button.tsx",
    "utf8",
  );
  assert.match(button, /انتخاب و خرید/);
  assert.match(button, /configurationPath/);
  assert.match(button, /orderSummary/);
  assert.match(button, /standalone/);
  assert.match(button, /login\?next=/);
  assert.doesNotMatch(button, /خارج از پرچین/);

  const page = await readFile(
    "app/account/order/configure/[planId]/page.tsx",
    "utf8",
  );
  assert.match(page, /requireCustomerPage/);
  assert.match(page, /ReadyServerQuoteButton/);
  assert.match(page, /standalone/);

  const dialog = await readFile(
    "components/parchin-details-dialog.tsx",
    "utf8",
  );
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal/);
  assert.match(dialog, /Escape/);
  assert.doesNotMatch(dialog, /شامل نمی‌شود|خدمات خارج از قرارداد/);
});

test("Task 2 migration is additive and backfills Parchin contracts", async () => {
  const migration = await readFile(
    "prisma/migrations/20260806210000_storefront_dominance_parchin_v3/migration.sql",
    "utf8",
  );
  assert.match(migration, /parchinServiceSnapshot/);
  assert.match(migration, /includedServices/);
  assert.match(migration, /ostovarMinDiskGb" SET DEFAULT 0/);
  assert.match(migration, /پرچین شروع/);
  assert.match(migration, /پرچین فعال/);
  assert.match(migration, /پرچین پایدار/);
  assert.doesNotMatch(migration, /\bDROP TABLE\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /DELETE FROM/i);

  const schema = await readFile("prisma/schema.prisma", "utf8");
  assert.match(schema, /parchinServiceSnapshot/);
  assert.match(schema, /includedServices\s+Json/);
  assert.match(schema, /ostovarMinDiskGb\s+Int\s+@default\(0\)/);
});

test("Tehran cheaper equal-or-better plan hides dominated weaker plan", () => {
  const a = candidate({
    id: "tehran-a",
    locationKey: "تهران ایران",
    vcpu: 1,
    ramGb: 2,
    diskGb: 40,
    finalMonthlyPriceRial: 8_000_000n,
    checkedAtMs: 2_000,
  });
  const b = candidate({
    id: "tehran-b",
    locationKey: "تهران ایران",
    vcpu: 1,
    ramGb: 1,
    diskGb: 25,
    finalMonthlyPriceRial: 9_000_000n,
    checkedAtMs: 1_000,
  });
  assert.equal(planDominates(a, b), true);
  const filtered = filterDominatedPlans([a, b]);
  assert.equal(filtered.kept.length, 1);
  assert.equal(filtered.kept[0]?.id, "tehran-a");
  assert.equal(
    filtered.removed.some((row) => row.candidateId === "tehran-b"),
    true,
  );
});

test("assortment bills the Parchin level matching each chinish", async () => {
  assert.equal(storefrontParchinLevel("NO"), "PARCHIN_START");
  assert.equal(storefrontParchinLevel("OSTOVAR"), "PARCHIN_ACTIVE");
  assert.equal(storefrontParchinLevel("KAHKESHAN"), "PARCHIN_STABLE");
  assert.equal(storefrontParchinTitle("KAHKESHAN"), "پرچین کهکشان");
  const source = await readFile(
    "lib/storefront/assortment-service.ts",
    "utf8",
  );
  assert.match(source, /billedContract/);
  assert.doesNotMatch(source, /brandingContract/);
  assert.match(source, /pricingParchinLevel = storefrontParchinLevel\(tier\)/);
  assert.match(source, /customerParchinTitle = storefrontParchinTitle\(tier\)/);
  assert.match(source, /result\.offers\.filter\(\(offer\) => offer\.purchasable\)/);
});
