import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { InfrastructureProvider } from "@prisma/client";

import {
  buildCatalogItems,
  persistProviderCatalog,
} from "../lib/infrastructure/catalog-service.ts";
import type { ProviderCatalog } from "../lib/infrastructure/types.ts";
import {
  resolveCatalogItemPricing,
  samePlanConfigurationSnapshot,
  samePriceSnapshot,
} from "../lib/pricing/plan-pricing.ts";
import { toPlanSnapshot } from "../lib/orders/plans.ts";
import {
  calculateFinalPriceRial,
  decimalToScaledInteger,
  normalizeProviderPriceContract,
  parseMarkupPercentToBasisPoints,
  providerAmountToRial,
} from "../lib/pricing/provider-pricing.ts";
import { toPublicRecommendationQuote } from "../lib/recommendation/quote-service.ts";

const syncedAt = new Date("2026-07-29T12:00:00.000Z");

function catalog(overrides?: Partial<ProviderCatalog>): ProviderCatalog {
  return {
    priceContract: {
      currencyCode: "IRR",
      amountUnit: "TOMAN",
      confirmed: true,
    },
    regions: [
      {
        code: "tehran11",
        name: "Tehran",
        available: true,
        sizeCodes: ["irLinuxVPS4"],
      },
    ],
    sizes: [
      {
        code: "irLinuxVPS4",
        name: "Linux VPS 4",
        regionCodes: ["tehran11"],
        available: true,
        vcpu: 2,
        memoryMb: 4096,
        diskGb: 50,
        priceHourly: "0.42",
        priceMonthly: "500000",
        rawUpdatedAt: "2026-07-29T11:50:00.000Z",
      },
    ],
    images: [
      {
        code: "ubuntu24-cloudinit-qcow2",
        name: "Ubuntu 24",
        regionCodes: ["tehran11"],
        minDiskGb: 20,
        status: "available",
      },
    ],
    ...overrides,
  };
}

test("normalizes only an explicitly confirmed IRR amount unit", () => {
  assert.deepEqual(
    normalizeProviderPriceContract({ currencyCode: "irr", amountUnit: "toman" }),
    { currencyCode: "IRR", amountUnit: "TOMAN", rialMultiplier: 10n },
  );
  assert.deepEqual(
    normalizeProviderPriceContract({ currencyCode: "IRR", amountUnit: "RIAL" }),
    { currencyCode: "IRR", amountUnit: "RIAL", rialMultiplier: 1n },
  );
  assert.equal(
    normalizeProviderPriceContract({ currencyCode: "IRR", amountUnit: null }),
    null,
  );
  assert.equal(
    normalizeProviderPriceContract({ currencyCode: "USD", amountUnit: "RIAL" }),
    null,
  );
});

test("uses scaled integer provider prices and deterministic round-up", () => {
  assert.equal(decimalToScaledInteger("0.42"), 420000n);
  assert.equal(decimalToScaledInteger("500000.000000"), 500000000000n);
  const contract = normalizeProviderPriceContract({
    currencyCode: "IRR",
    amountUnit: "TOMAN",
  });
  assert.ok(contract);
  assert.equal(
    providerAmountToRial({
      scaledAmount: decimalToScaledInteger("500000"),
      contract,
    }),
    5_000_000n,
  );
  assert.equal(calculateFinalPriceRial(5_000_000n, 0), 5_000_000n);
  assert.equal(calculateFinalPriceRial(5_000_000n, 2500), 6_250_000n);
  assert.equal(parseMarkupPercentToBasisPoints("12.5"), 1250);
  assert.equal(calculateFinalPriceRial(101n, 1), 102n);
});

test("builds priced catalog rows and fails closed without currency/unit", () => {
  const [item] = buildCatalogItems(catalog(), syncedAt);
  assert.ok(item);
  assert.equal(item.priceHourlyAmount, 420000n);
  assert.equal(item.priceMonthlyAmount, 500000000000n);
  assert.equal(item.currencyCode, "IRR");
  assert.equal(item.amountUnit, "TOMAN");
  assert.equal(item.available, true);
  assert.deepEqual(item.compatibleImageCodes, ["ubuntu24-cloudinit-qcow2"]);

  const [unconfirmed] = buildCatalogItems(
    catalog({
      priceContract: {
        currencyCode: null,
        amountUnit: null,
        confirmed: false,
      },
    }),
    syncedAt,
  );
  assert.equal(unconfirmed?.priceMonthlyAmount, 500000000000n);
  assert.equal(unconfirmed?.currencyCode, null);
  assert.equal(unconfirmed?.amountUnit, null);
});

type Stored = ReturnType<typeof buildCatalogItems>[number] & {
  id: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function fakeTransaction() {
  const items = new Map<string, Stored>();
  const plans = [
    {
      id: "plan-exact",
      provider: InfrastructureProvider.PARSPACK,
      regionCode: "tehran11",
      sizeCode: "irLinuxVPS4",
      imageCode: "ubuntu24-cloudinit-qcow2",
    },
    {
      id: "plan-do-not-guess",
      provider: InfrastructureProvider.PARSPACK,
      regionCode: "other-region",
      sizeCode: "irLinuxVPS4",
      imageCode: "ubuntu24-cloudinit-qcow2",
    },
  ];
  const planUpdates = new Map<string, Record<string, unknown>>();
  const readyPlans = new Map<string, Record<string, unknown>>();
  let nextId = 1;
  const key = (value: { provider: string; regionCode: string; sizeCode: string }) =>
    `${value.provider}:${value.regionCode}:${value.sizeCode}`;
  const tx = {
    providerPricingConfig: {
      async upsert() {
        return {
          id: "parspack",
          provider: InfrastructureProvider.PARSPACK,
          markupBasisPoints: 2500,
          updatedAt: syncedAt,
          updatedById: null,
        };
      },
    },
    providerCatalogItem: {
      async updateMany(args: {
        data: Partial<Stored>;
      }) {
        for (const [storedKey, item] of items) {
          if (item.available) items.set(storedKey, { ...item, ...args.data });
        }
        return { count: items.size };
      },
      async upsert(args: {
        where: { provider_regionCode_sizeCode: Stored };
        update: Partial<Stored>;
        create: ReturnType<typeof buildCatalogItems>[number];
      }) {
        const storedKey = key(args.where.provider_regionCode_sizeCode);
        const prior = items.get(storedKey);
        const value: Stored = prior
          ? { ...prior, ...args.update, updatedAt: syncedAt }
          : {
              ...args.create,
              id: `catalog-${nextId++}`,
              active: true,
              createdAt: syncedAt,
              updatedAt: syncedAt,
            };
        items.set(storedKey, value);
        return value;
      },
      async findMany() {
        return [...items.values()];
      },
      async count(args: { where: Record<string, unknown> }) {
        return [...items.values()].filter((item) => {
          const where = args.where;
          if (where.available === true && !item.available) return false;
          if (where.OR && item.available && item.active) return false;
          if (where.priceMonthlyAmount && !(item.priceMonthlyAmount && item.priceMonthlyAmount > 0n)) {
            return false;
          }
          if (typeof where.currencyCode === "string" && item.currencyCode !== where.currencyCode) {
            return false;
          }
          if (typeof where.amountUnit === "string" && item.amountUnit !== where.amountUnit) {
            return false;
          }
          return true;
        }).length;
      },
    },
    infrastructurePlan: {
      async findMany() {
        return plans;
      },
      async update(args: { where: { id: string }; data: Record<string, unknown> }) {
        planUpdates.set(args.where.id, args.data);
        return { id: args.where.id, ...args.data };
      },
      async updateMany(args: { where?: { OR?: unknown[] } }) {
        if (args.where?.OR) return { count: 0 };
        for (const [code, plan] of readyPlans) {
          readyPlans.set(code, { ...plan, active: false });
        }
        return { count: readyPlans.size };
      },
      async upsert(args: {
        where: { code: string };
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }) {
        const value = readyPlans.has(args.where.code)
          ? { ...readyPlans.get(args.where.code), ...args.update }
          : args.create;
        readyPlans.set(args.where.code, value);
        return value;
      },
    },
  };
  return { tx, items, planUpdates, readyPlans };
}

test("catalog persistence upserts idempotently, preserves missing rows, and never guesses mapping", async () => {
  const fake = fakeTransaction();
  const first = await persistProviderCatalog(fake.tx as never, catalog(), syncedAt);
  const firstId = [...fake.items.values()][0]?.id;
  assert.equal(first.catalogItemCount, 1);
  assert.equal(first.pricedItemCount, 1);
  assert.equal(first.mappedPlanCount, 1);
  assert.equal(first.unmappedPlanCount, 1);
  assert.equal(first.readyPlanCount, 1);
  assert.equal(fake.readyPlans.size, 1);
  assert.equal([...fake.readyPlans.values()][0]?.deliveryMode, "MANAGED");
  assert.equal([...fake.readyPlans.values()][0]?.parchinIncluded, true);
  assert.equal(fake.planUpdates.get("plan-exact")?.catalogMappingStatus, "MAPPED");
  assert.equal(fake.planUpdates.get("plan-do-not-guess")?.active, false);

  await persistProviderCatalog(fake.tx as never, catalog(), syncedAt);
  assert.equal(fake.items.size, 1);
  assert.equal(fake.readyPlans.size, 1);
  assert.equal([...fake.items.values()][0]?.id, firstId);

  const missing = await persistProviderCatalog(
    fake.tx as never,
    catalog({ sizes: [] }),
    new Date("2026-07-29T13:00:00.000Z"),
  );
  assert.equal(fake.items.size, 1);
  assert.equal([...fake.items.values()][0]?.available, false);
  assert.equal(missing.unavailableItemCount, 1);
  assert.equal([...fake.readyPlans.values()][0]?.active, false);
});

test("price and availability revalidation compare immutable snapshots", () => {
  const [raw] = buildCatalogItems(catalog(), syncedAt);
  assert.ok(raw);
  const item = {
    ...raw,
    id: "catalog-1",
    active: true,
    createdAt: syncedAt,
    updatedAt: syncedAt,
  };
  const current = resolveCatalogItemPricing(item as never, {
    markupBasisPoints: 2500,
  });
  assert.ok(current);
  assert.equal(
    samePriceSnapshot(current, {
      catalogItemId: current.catalogItemId,
      providerBasePriceRialSnapshot: current.providerBasePriceRial,
      markupBasisPointsSnapshot: current.markupBasisPoints,
      finalPriceRialSnapshot: current.finalPriceRial,
      currencySnapshot: current.currency,
    }),
    true,
  );
  assert.equal(
    samePriceSnapshot(current, {
      catalogItemId: current.catalogItemId,
      providerBasePriceRialSnapshot: current.providerBasePriceRial,
      markupBasisPointsSnapshot: 2600,
      finalPriceRialSnapshot: current.finalPriceRial,
      currencySnapshot: current.currency,
    }),
    false,
  );
  assert.equal(
    resolveCatalogItemPricing({ ...item, available: false } as never, {
      markupBasisPoints: 2500,
    }),
    null,
  );
  const plan = {
    provider: "PARSPACK",
    regionCode: "tehran11",
    sizeCode: "irLinuxVPS4",
    imageCode: "ubuntu24-cloudinit-qcow2",
    deliveryMode: "MANAGED",
    parchinIncluded: true,
  } as const;
  const configurationSnapshot = {
    provider: "PARSPACK",
    catalogItemId: current.catalogItemId,
    regionCode: "tehran11",
    sizeCode: "irLinuxVPS4",
    imageCode: "ubuntu24-cloudinit-qcow2",
    deliveryMode: "MANAGED",
    vcpu: current.vcpu,
    ramGb: current.ramGb,
    storageGb: current.storageGb,
    parchinIncluded: true,
  };
  assert.equal(
    samePlanConfigurationSnapshot(plan as never, current, configurationSnapshot),
    true,
  );
  assert.equal(
    samePlanConfigurationSnapshot(
      { ...plan, imageCode: "debian13-cloudinit-qcow2" } as never,
      current,
      configurationSnapshot,
    ),
    false,
  );
});

test("customer quote response excludes provider and base price", () => {
  const publicQuote = toPublicRecommendationQuote({
    id: "quote-1",
    role: "RECOMMENDED",
    amountRial: 6_250_000n,
    renewalAmountRial: 6_250_000n,
    reasons: ["fit"],
    planSnapshot: {
      title: "Cloud",
      provider: "PARSPACK",
      providerBasePriceRialSnapshot: "5000000",
      deliveryMode: "RAW",
      vcpu: 2,
      ramGb: 4,
      storageGb: 50,
    },
    expiresAt: new Date("2026-07-29T12:10:00.000Z"),
  });
  const serialized = JSON.stringify(publicQuote);
  assert.doesNotMatch(serialized, /PARSPACK|providerBasePrice/i);
  assert.equal(publicQuote.amountRial, "6250000");
});

test("quote snapshot is complete and expires exactly after ten minutes", () => {
  const createdAt = new Date("2026-07-29T12:00:00.000Z");
  const expiresAt = new Date("2026-07-29T12:10:00.000Z");
  const snapshot = toPlanSnapshot(
    {
      id: "plan-1",
      code: "CLOUD_1",
      title: "Cloud",
      description: null,
      provider: "PARSPACK",
      regionCode: "tehran11",
      sizeCode: "irLinuxVPS4",
      imageCode: "ubuntu24-cloudinit-qcow2",
      deliveryMode: "RAW",
      deliveryEstimateMinutes: 15,
      parchinIncluded: true,
      pricing: {
        catalogItemId: "catalog-1",
        providerBasePriceRial: 5_000_000n,
        markupBasisPoints: 2500,
        finalPriceRial: 6_250_000n,
        currency: "IRR",
        providerPriceCheckedAt: syncedAt,
        vcpu: 2,
        ramGb: 4,
        storageGb: 50,
        available: true,
      },
    } as never,
    { createdAt, expiresAt },
  );
  assert.equal(snapshot.catalogItemId, "catalog-1");
  assert.equal(snapshot.regionCode, "tehran11");
  assert.equal(snapshot.sizeCode, "irLinuxVPS4");
  assert.equal(snapshot.imageCode, "ubuntu24-cloudinit-qcow2");
  assert.equal(snapshot.providerBasePriceRialSnapshot, "5000000");
  assert.equal(snapshot.markupBasisPointsSnapshot, 2500);
  assert.equal(snapshot.finalPriceRialSnapshot, "6250000");
  assert.equal(snapshot.currency, "IRR");
  assert.equal(
    new Date(snapshot.expiresAt).getTime() - new Date(snapshot.createdAt).getTime(),
    10 * 60 * 1000,
  );
});

test("pricing and renewal paths require auth, preserve paid orders, and never create a VM", async () => {
  const [adminRoute, paySource, renewalSource, pricingSource] = await Promise.all([
    readFile("app/api/admin/infrastructure/providers/markup/route.ts", "utf8"),
    readFile("lib/orders/pay-order-tx.ts", "utf8"),
    readFile("lib/subscriptions/service.ts", "utf8"),
    readFile("lib/pricing/provider-pricing.ts", "utf8"),
  ]);
  assert.match(adminRoute, /requireAdminUser/);
  assert.ok(
    paySource.indexOf("if (order.status === ServiceOrderStatus.PAID)") <
      paySource.indexOf("const currentPricing = resolvePlanPricing"),
  );
  assert.match(renewalSource, /ServiceRenewalQuote|serviceRenewalQuote/);
  assert.match(renewalSource, /providerBasePriceRialSnapshot/);
  assert.doesNotMatch(renewalSource, /if \(subscription\.autoRenew\)/);
  assert.doesNotMatch(pricingSource, /createInstance/);
});
