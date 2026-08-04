import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  InfrastructureProductKind,
  InfrastructureProvider,
  ProviderCatalogStatus,
} from "@prisma/client";

import type {
  CloudProviderAdapter,
  ProviderImage,
  ProviderPlan,
} from "../lib/infrastructure/cloud-provider-adapter.ts";
import { ArvanV1Adapter } from "../lib/infrastructure/arvan/v1-adapter.ts";
import { resolveCatalogOfferAccess } from "../lib/infrastructure/catalog-visibility.ts";
import { FakeCloudProviderAdapter } from "../lib/infrastructure/fake-cloud-provider-adapter.ts";
import {
  persistProviderCatalogRegion,
  providerCatalogStatus,
} from "../lib/infrastructure/multi-provider-catalog-service.ts";
import { ParsPackProvider } from "../lib/infrastructure/parspack/client.ts";
import { parseParsPackSizes } from "../lib/infrastructure/parspack/mapper.ts";
import {
  PARSPACK_UNSCOPED_REGION_CODE,
  ParsPackV1Adapter,
} from "../lib/infrastructure/parspack/v1-adapter.ts";
import { getPublicSaleDecision } from "../lib/infrastructure/public-sale-policy.ts";
import { revalidateLockedSelection } from "../lib/infrastructure/selection-revalidation.ts";

function parsPackFetch(calls: Array<{ url: string; method: string }>): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    if (url.includes("/regions?")) {
      return Response.json({
        regions: [
          {
            slug: "tehran11",
            name: "Tehran",
            available: true,
            sizes: ["priced", "missing-price", "unavailable"],
          },
        ],
      });
    }
    if (url.includes("/sizes?")) {
      return Response.json({
        sizes: [
          {
            slug: "priced",
            description: "Priced",
            regions: ["tehran11"],
            available: true,
            vcpus: 2,
            memory: 4096,
            disk: 50,
            price_hourly: "0.42",
            price_monthly: "500000",
          },
          {
            slug: "missing-price",
            description: "Missing price",
            regions: ["tehran11"],
            available: true,
            vcpus: 1,
            memory: 1024,
            disk: 25,
          },
          {
            slug: "unavailable",
            description: "Unavailable",
            regions: ["tehran11"],
            available: false,
            vcpus: 1,
            memory: 1024,
            disk: 25,
            price_monthly: "250000",
          },
          {
            slug: "unscoped",
            description: "Provider omitted region",
            available: true,
            vcpus: 1,
            memory: 1024,
            disk: 25,
            price_monthly: "250000",
          },
        ],
      });
    }
    if (url.includes("/images?")) {
      return Response.json({
        images: [
          {
            slug: "ubuntu24",
            name: "Ubuntu 24",
            regions: ["tehran11"],
            min_disk_size: 20,
            status: "available",
          },
        ],
      });
    }
    return Response.json({ message: "not found" }, { status: 404 });
  };
}

test("ParsPack adapter normalizes exact prices, availability, and unscoped plans with GET only", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const adapter = new ParsPackV1Adapter(
    new ParsPackProvider({
      managementBaseUrl: "https://my.parspack.com/cserver/api/v1",
      publicBaseUrl: "https://my.parspack.com/cserver/api/public/v1",
      token: "test-only-token",
      timeoutMs: 1_000,
      priceCurrencyCode: "IRR",
      priceAmountUnit: "TOMAN",
      mutationsEnabled: false,
      fetchImpl: parsPackFetch(calls),
    }),
  );

  const regions = await adapter.syncRegions();
  const plans = await adapter.syncPlans("tehran11");
  const unscoped = await adapter.syncPlans(PARSPACK_UNSCOPED_REGION_CODE);

  assert.equal(calls.length, 3);
  assert.equal(calls.every((call) => call.method === "GET"), true);
  assert.deepEqual(
    regions.map((region) => region.code),
    ["tehran11", PARSPACK_UNSCOPED_REGION_CODE],
  );
  assert.equal(plans.some((plan) => plan.externalPlanId === "unscoped"), false);
  assert.equal(unscoped[0]?.externalPlanId, "unscoped");
  assert.equal(unscoped[0]?.available, true);

  const priced = plans.find((plan) => plan.externalPlanId === "priced");
  assert.ok(priced);
  assert.equal(priced.priceHourlyAmount, 420_000n);
  assert.equal(priced.priceMonthlyAmount, 500_000_000_000n);
  assert.equal(priced.priceScale, 6);
  assert.equal(priced.currencyCode, "IRR");
  assert.equal(priced.amountUnit, "TOMAN");
  assert.equal(priced.priceHourlyIrr, 5n);
  assert.equal(priced.priceMonthlyIrr, 5_000_000n);
  assert.equal(
    providerCatalogStatus(
      priced,
      InfrastructureProductKind.READY_INSTANT_SERVER,
    ),
    ProviderCatalogStatus.ACTIVE,
  );

  const missing = plans.find(
    (plan) => plan.externalPlanId === "missing-price",
  );
  assert.ok(missing);
  assert.equal(missing.available, true);
  assert.equal(
    providerCatalogStatus(
      missing,
      InfrastructureProductKind.READY_INSTANT_SERVER,
    ),
    ProviderCatalogStatus.INVALID_PRICE,
  );

  const unavailable = plans.find(
    (plan) => plan.externalPlanId === "unavailable",
  );
  assert.ok(unavailable);
  assert.equal(
    providerCatalogStatus(
      unavailable,
      InfrastructureProductKind.READY_INSTANT_SERVER,
    ),
    ProviderCatalogStatus.UNAVAILABLE,
  );
});

test("ParsPack rejects malformed catalog identity and pagination before persistence", async () => {
  assert.equal(
    parseParsPackSizes({
      sizes: [
        {
          slug: "unsafe-number",
          price_monthly: 0.42,
        },
      ],
    })[0]?.priceMonthly,
    "0.42",
  );
  assert.equal(
    parseParsPackSizes({
      sizes: [
        {
          slug: "unsafe-number",
          price_monthly: 1.000_001,
        },
      ],
    })[0]?.priceMonthly,
    "1.000001",
  );
  assert.equal(
    parseParsPackSizes({
      sizes: [
        {
          slug: "unsafe-number",
          price_monthly: 9_007_199_254_740_992,
        },
      ],
    })[0]?.priceMonthly,
    undefined,
  );
  assert.equal(
    parseParsPackSizes({
      sizes: [
        {
          slug: "unsafe-decimal",
          price_monthly: 10_000_000_000.000_001,
        },
      ],
    })[0]?.priceMonthly,
    undefined,
  );
  const malformedIdentity = new ParsPackProvider({
    managementBaseUrl: "https://my.parspack.com/cserver/api/v1",
    publicBaseUrl: "https://my.parspack.com/cserver/api/public/v1",
    token: "test-only-token",
    timeoutMs: 1_000,
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("/regions?")) {
        return Response.json({ regions: [{ name: "Missing code" }] });
      }
      if (url.includes("/sizes?")) return Response.json({ sizes: [] });
      return Response.json({ images: [] });
    },
  });
  await assert.rejects(
    () => malformedIdentity.syncCatalog(),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "provider_invalid_response",
  );

  const malformedPagination = new ParsPackProvider({
    managementBaseUrl: "https://my.parspack.com/cserver/api/v1",
    publicBaseUrl: "https://my.parspack.com/cserver/api/public/v1",
    token: "test-only-token",
    timeoutMs: 1_000,
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("/regions?")) {
        return Response.json({
          regions: [{ slug: "tehran11", name: "Tehran" }],
          links: { pages: { next: "not-a-page-link" } },
        });
      }
      if (url.includes("/sizes?")) return Response.json({ sizes: [] });
      return Response.json({ images: [] });
    },
  });
  await assert.rejects(
    () => malformedPagination.syncCatalog(),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "provider_invalid_response",
  );
});

test("catalog classification never fabricates missing Cloud prices or malformed resources", () => {
  const base: ProviderPlan = {
    externalPlanId: "cloud",
    region: "ir-thr-ba1",
    name: "Cloud",
    vcpu: 2,
    ramMb: 2048,
    diskGb: 40,
    resourceContractValid: true,
    available: true,
    priceHourlyIrr: 1_000n,
    priceMonthlyIrr: 500_000n,
    sourceMoneyUnit: "RIAL",
    rawUpdatedAt: null,
    rawPayload: {},
  };
  assert.equal(
    providerCatalogStatus(
      { ...base, priceHourlyIrr: null },
      InfrastructureProductKind.CLOUD_SERVER,
    ),
    ProviderCatalogStatus.INVALID_PRICE,
  );
  assert.equal(
    providerCatalogStatus(
      {
        ...base,
        resourceContractValid: false,
        resourceContractError: "invalid_memory",
      },
      InfrastructureProductKind.CLOUD_SERVER,
    ),
    ProviderCatalogStatus.INVALID_RESOURCE,
  );
});

test("Cloud selection revalidation requires a current positive hourly price", async () => {
  const region = "ir-thr-ba1";
  const adapter = new FakeCloudProviderAdapter({
    provider: InfrastructureProvider.ARVAN,
    plansByRegion: {
      [region]: [
        {
          externalPlanId: "cloud",
          region,
          name: "Cloud",
          vcpu: 2,
          ramMb: 2048,
          diskGb: 40,
          resourceContractValid: true,
          available: true,
          priceHourlyIrr: null,
          priceMonthlyIrr: 500_000n,
          sourceMoneyUnit: "RIAL",
          rawUpdatedAt: null,
          rawPayload: {},
        },
      ],
    },
    imagesByRegion: {
      [region]: [
        {
          externalId: "ubuntu24",
          region,
          name: "Ubuntu 24",
          operatingSystem: "Ubuntu",
          minDiskGb: 20,
          minRamMb: 512,
          available: true,
          sshKeySupported: true,
          sshPasswordSupported: true,
          rawUpdatedAt: null,
          rawPayload: {},
        },
      ],
    },
  });
  await assert.rejects(
    () =>
      revalidateLockedSelection(
        {
          provider: InfrastructureProvider.ARVAN,
          providerApiVersion: "v1",
          productKind: InfrastructureProductKind.CLOUD_SERVER,
          region,
          externalPlanId: "cloud",
          externalImageId: "ubuntu24",
        },
        adapter,
      ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "provider_price_invalid",
  );
});

test("Arvan disabled default topology remains unavailable", async () => {
  const adapter = new ArvanV1Adapter({
    apiKey: "test-only-key",
    regionCodes: ["ir-thr-ba1"],
    fetchImpl: async (input, init) => {
      assert.equal(init?.method, "GET");
      const url = String(input);
      if (url.endsWith("/servers/options")) {
        return Response.json({ network_id: "network-default" });
      }
      if (url.endsWith("/networks")) {
        return Response.json([
          {
            id: "network-default",
            name: "Default",
            status: "disabled",
            admin_state_up: true,
          },
        ]);
      }
      if (url.endsWith("/securities")) {
        return Response.json([
          {
            id: "security-default",
            name: "Default",
            real_name: "arDefault",
            status: "inactive",
          },
        ]);
      }
      return Response.json([]);
    },
  });
  assert.equal((await adapter.syncNetworks("ir-thr-ba1"))[0]?.available, false);
  assert.equal((await adapter.syncSecurity("ir-thr-ba1"))[0]?.available, false);
  await assert.rejects(
    () => adapter.resolveSelectionDefaults("ir-thr-ba1"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "provider_default_selection_missing",
  );
});

function fakeCatalogTransaction() {
  const regions = new Map<string, Record<string, unknown>>();
  const assets = new Map<string, Record<string, unknown>>();
  const items = new Map<string, Record<string, unknown>>();
  const upsert = (
    store: Map<string, Record<string, unknown>>,
    key: string,
    args: {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    },
  ) => {
    const prior = store.get(key);
    const value = prior
      ? { ...prior, ...args.update }
      : { ...args.create };
    store.set(key, value);
    return value;
  };
  const tx = {
    providerCatalogRegionState: {
      async upsert(args: {
        where: {
          provider_apiVersion_regionCode: {
            provider: string;
            apiVersion: string;
            regionCode: string;
          };
        };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) {
        const identity = args.where.provider_apiVersion_regionCode;
        return upsert(
          regions,
          `${identity.provider}:${identity.apiVersion}:${identity.regionCode}`,
          args,
        );
      },
    },
    providerCatalogAsset: {
      async upsert(args: {
        where: {
          provider_apiVersion_regionCode_kind_externalId: {
            provider: string;
            apiVersion: string;
            regionCode: string;
            kind: string;
            externalId: string;
          };
        };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) {
        const identity =
          args.where.provider_apiVersion_regionCode_kind_externalId;
        return upsert(
          assets,
          [
            identity.provider,
            identity.apiVersion,
            identity.regionCode,
            identity.kind,
            identity.externalId,
          ].join(":"),
          args,
        );
      },
      async updateMany() {
        return { count: 0 };
      },
    },
    providerCatalogItem: {
      async upsert(args: {
        where: {
          provider_apiVersion_regionCode_externalPlanId: {
            provider: string;
            apiVersion: string;
            regionCode: string;
            externalPlanId: string;
          };
        };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) {
        const identity =
          args.where.provider_apiVersion_regionCode_externalPlanId;
        return upsert(
          items,
          [
            identity.provider,
            identity.apiVersion,
            identity.regionCode,
            identity.externalPlanId,
          ].join(":"),
          args,
        );
      },
      async updateMany() {
        return { count: 0 };
      },
      async findMany() {
        return [...items.values()];
      },
    },
  };
  return { tx, regions, assets, items };
}

test("shared persistence upserts idempotently and never creates a storefront SKU", async () => {
  const fake = fakeCatalogTransaction();
  const syncedAt = new Date("2026-08-04T10:00:00.000Z");
  const image: ProviderImage = {
    externalId: "ubuntu24",
    region: "tehran11",
    name: "Ubuntu 24",
    operatingSystem: "Ubuntu",
    minDiskGb: 20,
    minRamMb: 512,
    available: true,
    sshKeySupported: null,
    sshPasswordSupported: true,
    rawUpdatedAt: null,
    rawPayload: { id: "ubuntu24" },
  };
  const input = {
    adapter: {
      provider: InfrastructureProvider.PARSPACK,
      apiVersion: "v1",
    } as CloudProviderAdapter,
    productKind: InfrastructureProductKind.READY_INSTANT_SERVER,
    region: {
      code: "tehran11",
      name: "Tehran",
      available: true,
      rawPayload: { code: "tehran11" },
    },
    plans: [
      {
        externalPlanId: "priced",
        region: "tehran11",
        name: "Priced",
        vcpu: 2,
        ramMb: 4096,
        diskGb: 50,
        resourceContractValid: true,
        available: true,
        priceHourlyAmount: 420_000n,
        priceMonthlyAmount: 500_000_000_000n,
        priceScale: 6,
        currencyCode: "IRR",
        amountUnit: "TOMAN",
        priceHourlyIrr: 5n,
        priceMonthlyIrr: 5_000_000n,
        sourceMoneyUnit: "TOMAN",
        rawUpdatedAt: null,
        rawPayload: { id: "priced" },
      },
    ],
    images: [image],
    networks: [],
    securities: [],
    syncedAt,
    catalogVersion: "parspack:v1:2026-08-04T10:00:00.000Z",
  };

  await persistProviderCatalogRegion(fake.tx as never, input);
  const firstId = [...fake.items.values()][0]?.id;
  await persistProviderCatalogRegion(fake.tx as never, input);

  assert.equal(fake.regions.size, 1);
  assert.equal(fake.assets.size, 1);
  assert.equal(fake.items.size, 1);
  assert.equal([...fake.items.values()][0]?.id, firstId);
  assert.equal(
    [...fake.items.values()][0]?.priceMonthlyAmount,
    500_000_000_000n,
  );
  assert.equal("infrastructurePlan" in fake.tx, false);
});

test("catalog remains visible while every commercial gate stays fail-closed", async () => {
  const names = [
    "PARSPACK_PUBLIC_SALE_ENABLED",
    "PARSPACK_MUTATIONS_ENABLED",
    "ARVAN_PUBLIC_SALE_ENABLED",
    "ARVAN_CLOUD_PUBLIC_SALE_ENABLED",
    "ARVAN_MUTATIONS_ENABLED",
  ] as const;
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  try {
    for (const name of names) process.env[name] = "false";
    assert.deepEqual(
      getPublicSaleDecision({
        provider: InfrastructureProvider.ARVAN,
        productKind: InfrastructureProductKind.CLOUD_SERVER,
        offerSource: "API_CATALOG",
      }),
      { allowed: false, code: "provider_sale_disabled" },
    );
    assert.deepEqual(
      resolveCatalogOfferAccess({
        catalogFresh: true,
        displayDuringProviderOutage: false,
        publicSaleEnabled: false,
        regionSaleEnabled: true,
      }),
      {
        visible: true,
        purchasable: false,
        purchaseState: "SALE_DISABLED",
      },
    );
    assert.deepEqual(
      resolveCatalogOfferAccess({
        catalogFresh: true,
        displayDuringProviderOutage: false,
        publicSaleEnabled: true,
        regionSaleEnabled: false,
      }),
      {
        visible: true,
        purchasable: false,
        purchaseState: "REGION_SALE_DISABLED",
      },
    );

    const [
      quoteService,
      activation,
      payment,
      paymentIntent,
      productionEnv,
    ] =
      await Promise.all([
      readFile("lib/recommendation/quote-service.ts", "utf8"),
      readFile("lib/billing/activation.ts", "utf8"),
      readFile("lib/orders/pay-order-tx.ts", "utf8"),
      readFile("lib/payments/order-payment.ts", "utf8"),
      readFile(".env.production.example", "utf8"),
      ]);
    assert.match(quoteService, /assertPublicSaleEnabled\(route\)/);
    assert.match(quoteService, /await requireFreshCatalog\(route\.provider\)/);
    assert.match(quoteService, /isRegionEnabledForSale/);
    assert.match(
      quoteService,
      /current\.hourlyPriceIrr !==[\s\S]*providerHourlyPriceIrr/,
    );
    assert.match(activation, /providerRegionConfig\.findFirst/);
    assert.match(activation, /saleEnabled: true/);
    assert.match(
      activation,
      /catalogItem\.providerHourlyPriceIrr !==[\s\S]*quote\.providerHourlyPriceIrr/,
    );
    assert.match(activation, /lastSyncStatus === "SUCCEEDED"/);
    assert.match(payment, /providerRegionConfig\.findFirst/);
    assert.match(payment, /saleEnabled: true/);
    assert.match(payment, /lastSyncStatus === "SUCCEEDED"/);
    assert.match(paymentIntent, /assertPublicSaleEnabled/);
    assert.match(paymentIntent, /lastSyncStatus === "SUCCEEDED"/);
    assert.match(paymentIntent, /order\.quoteExpiresAt/);
    assert.match(
      paymentIntent,
      /recommendationQuote\.amountRial !== order\.amount/,
    );
    for (const expected of [
      "PARSPACK_PUBLIC_SALE_ENABLED=false",
      "PARSPACK_MUTATIONS_ENABLED=false",
      "ARVAN_PUBLIC_SALE_ENABLED=false",
      "ARVAN_MUTATIONS_ENABLED=false",
    ]) {
      assert.match(productionEnv, new RegExp(`^${expected}$`, "m"));
    }
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("cloud-servers lists synced catalog before SKU publish while purchase stays closed", async () => {
  const [plansSource, catalogUi, cloudPage] = await Promise.all([
    readFile("lib/orders/plans.ts", "utf8"),
    readFile("components/ready-cloud-catalog.tsx", "utf8"),
    readFile("app/cloud-servers/page.tsx", "utf8"),
  ]);
  assert.match(plansSource, /providerCatalogItem\.findMany/);
  assert.match(plansSource, /SKU_UNPUBLISHED/);
  assert.match(plansSource, /purchasable: false/);
  assert.match(catalogUi, /هنوز برای فروش منتشر نشده/);
  assert.match(cloudPage, /کیف پول/);
  assert.doesNotMatch(cloudPage, /\bWallet\b/);
  assert.doesNotMatch(catalogUi, /\bMarkup\b/);
  assert.doesNotMatch(catalogUi, /\bSource:\b/);
});

test("new pricing configuration defaults fail closed outside catalog sync", async () => {
  const [schema, migration, syncSource] = await Promise.all([
    readFile("prisma/schema.prisma", "utf8"),
    readFile(
      "prisma/migrations/20260804110000_catalog_sync_pricing_fail_closed/migration.sql",
      "utf8",
    ),
    readFile(
      "lib/infrastructure/multi-provider-catalog-service.ts",
      "utf8",
    ),
  ]);
  assert.match(
    schema,
    /model ProviderPricingConfig[\s\S]*enabled\s+Boolean\s+@default\(false\)/,
  );
  assert.match(
    schema,
    /model ProductPricingConfig[\s\S]*enabled\s+Boolean\s+@default\(false\)/,
  );
  assert.equal(
    (migration.match(/ALTER COLUMN "enabled" SET DEFAULT false/g) ?? [])
      .length,
    2,
  );
  assert.equal(
    (migration.match(/WHERE "updatedById" IS NULL/g) ?? []).length,
    2,
  );
  assert.match(syncSource, /markupBasisPoints: 0,\s+enabled: false/);
  assert.match(syncSource, /"syncLeaseToken" = \$\{leaseToken\}[\s\S]*FOR UPDATE/);
  assert.match(syncSource, /renewCatalogSyncLease/);
});
