import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  InfrastructureProductKind,
  InfrastructureProvider,
  type InfrastructurePlan,
  type ProviderCatalogItem,
} from "@prisma/client";

import { validateProviderEnvironment } from "../lib/env.ts";

import {
  ArvanV1Adapter,
  normalizeArvanV1BaseUrl,
  normalizeArvanPlanResources,
  redactProviderData,
} from "../lib/infrastructure/arvan/v1-adapter.ts";
import {
  arvanRegionPresentation,
  parseArvanRegionCodes,
  requireArvanRegionCodes,
} from "../lib/infrastructure/arvan/regions.ts";
import { FakeCloudProviderAdapter } from "../lib/infrastructure/fake-cloud-provider-adapter.ts";
import {
  ProviderCatalogSyncError,
  settleProviderCatalogSyncTasks,
} from "../lib/infrastructure/catalog-sync-observability.ts";
import { submitProvisioningOnce } from "../lib/infrastructure/provisioning-orchestrator.ts";
import { catalogRamMbToPlanRamGb } from "../lib/infrastructure/multi-provider-catalog-service.ts";
import {
  assertProviderRoute,
  catalogExternalKey,
  isProviderLockedSnapshot,
  resolveProviderRoute,
} from "../lib/infrastructure/provider-routing.ts";
import {
  assertPublicSaleEnabled,
  getPublicSaleDecision,
} from "../lib/infrastructure/public-sale-policy.ts";
import {
  irrToDisplayToman,
  normalizeProviderMoney,
} from "../lib/pricing/provider-money.ts";
import {
  calculateQuotePricing,
  multiplyBpsRoundUp,
  serializeQuoteLineItems,
} from "../lib/pricing/quote-line-items.ts";
import {
  resolvePlanPricing,
  type EffectivePlan,
} from "../lib/pricing/plan-pricing.ts";
import {
  canTransitionProductFlow,
  productFlowStates,
} from "../lib/product-flow/state-machine.ts";
import {
  toPublicRecommendationQuote,
} from "../lib/recommendation/quote-service.ts";
import {
  assertParchinLevelAllowed,
  recommendedParchinLevel,
} from "../lib/parchin/recommendation.ts";
import { getRecommendationQuestionOrder } from "../lib/recommendation/questions.ts";
import { classifyWorkload } from "../lib/recommendation/workload-classification.ts";

test("product kinds have one immutable server-side provider route", () => {
  assert.deepEqual(
    resolveProviderRoute(InfrastructureProductKind.CLOUD_SERVER),
    {
      productKind: InfrastructureProductKind.CLOUD_SERVER,
      provider: InfrastructureProvider.ARVAN,
      apiVersion: "v1",
    },
  );
  assert.equal(
    resolveProviderRoute(InfrastructureProductKind.READY_INSTANT_SERVER)
      .provider,
    InfrastructureProvider.PARSPACK,
  );
  assert.throws(() =>
    assertProviderRoute({
      productKind: InfrastructureProductKind.CLOUD_SERVER,
      provider: InfrastructureProvider.PARSPACK,
      apiVersion: "v1",
    }),
  );
  assert.throws(() =>
    assertProviderRoute({
      productKind: InfrastructureProductKind.READY_INSTANT_SERVER,
      provider: InfrastructureProvider.ARVAN,
      apiVersion: "v1",
    }),
  );
});

test("worker catalog task results retain provider metadata and only log safe codes", async () => {
  const entries: Array<Record<string, unknown>> = [];
  const secret = "must-never-be-logged";
  const results = await settleProviderCatalogSyncTasks(
    [
      {
        provider: InfrastructureProvider.ARVAN,
        apiVersion: "v1",
        operation: "catalog_sync",
        promise: Promise.resolve({ ok: true }),
      },
      {
        provider: InfrastructureProvider.PARSPACK,
        apiVersion: "v1",
        operation: "catalog_sync",
        promise: Promise.reject(
          Object.assign(
            new ProviderCatalogSyncError({
              provider: InfrastructureProvider.PARSPACK,
              apiVersion: "v1",
              operation: "catalog_sync",
              code: "provider_auth_failed",
            }),
            { unsafeResponse: secret },
          ),
        ),
      },
    ],
    (entry) => entries.push(entry),
  );
  assert.deepEqual(results.map((result) => result.status), [
    "fulfilled",
    "rejected",
  ]);
  assert.deepEqual(entries, [
    {
      event: "provider_catalog_sync",
      provider: InfrastructureProvider.ARVAN,
      apiVersion: "v1",
      operation: "catalog_sync",
      syncStatus: "SUCCEEDED",
    },
    {
      event: "provider_catalog_sync",
      provider: InfrastructureProvider.PARSPACK,
      apiVersion: "v1",
      operation: "catalog_sync",
      syncStatus: "FAILED",
      safeErrorCode: "provider_auth_failed",
    },
  ]);
  assert.equal(JSON.stringify(entries).includes(secret), false);
});

test("Arvan catalog identity includes API version and Region", () => {
  const first = catalogExternalKey({
    provider: InfrastructureProvider.ARVAN,
    apiVersion: "v1",
    region: "ir-thr-ba1",
    externalPlanId: "g6-64-32-0",
  });
  assert.equal(first, "arvan:v1:ir-thr-ba1:g6-64-32-0");
  assert.notEqual(
    first,
    catalogExternalKey({
      provider: InfrastructureProvider.ARVAN,
      apiVersion: "v1",
      region: "eu-west1-a",
      externalPlanId: "g6-64-32-0",
    }),
  );
});

test("provider and API version remain locked in quote and paid-order snapshots", async () => {
  assert.equal(
    isProviderLockedSnapshot({
      productKind: InfrastructureProductKind.CLOUD_SERVER,
      provider: InfrastructureProvider.ARVAN,
      providerApiVersion: "v1",
    }),
    true,
  );
  assert.equal(
    isProviderLockedSnapshot({
      productKind: InfrastructureProductKind.CLOUD_SERVER,
      provider: InfrastructureProvider.PARSPACK,
      providerApiVersion: "v1",
    }),
    false,
  );
  const payment = await readFile(
    new URL("../lib/orders/pay-order-tx.ts", import.meta.url),
    "utf8",
  );
  assert.match(payment, /assertProviderRoute/);
  assert.match(payment, /providerSelectionSnapshot/);
  assert.match(payment, /assertPublicSaleEnabled/);
  assert.doesNotMatch(payment, /providerSwap|fallbackProvider/i);
});

test("Arvan public sale is fail-closed and independent for inventory", () => {
  const previousSale = process.env.ARVAN_PUBLIC_SALE_ENABLED;
  const previousMutations = process.env.ARVAN_MUTATIONS_ENABLED;
  try {
    delete process.env.ARVAN_PUBLIC_SALE_ENABLED;
    process.env.ARVAN_MUTATIONS_ENABLED = "true";
    assert.deepEqual(
      getPublicSaleDecision({
        provider: InfrastructureProvider.ARVAN,
        offerSource: "PREPROVISIONED_INVENTORY",
      }),
      { allowed: false, code: "provider_sale_disabled" },
    );

    process.env.ARVAN_PUBLIC_SALE_ENABLED = "true";
    process.env.ARVAN_MUTATIONS_ENABLED = "false";
    assert.deepEqual(
      getPublicSaleDecision({
        provider: InfrastructureProvider.ARVAN,
        offerSource: "API_CATALOG",
      }),
      { allowed: false, code: "provider_provisioning_not_enabled" },
    );
    assert.equal(
      getPublicSaleDecision({
        provider: InfrastructureProvider.ARVAN,
        offerSource: "PREPROVISIONED_INVENTORY",
      }).allowed,
      true,
    );
  } finally {
    if (previousSale === undefined) delete process.env.ARVAN_PUBLIC_SALE_ENABLED;
    else process.env.ARVAN_PUBLIC_SALE_ENABLED = previousSale;
    if (previousMutations === undefined) delete process.env.ARVAN_MUTATIONS_ENABLED;
    else process.env.ARVAN_MUTATIONS_ENABLED = previousMutations;
  }
});

test("ParsPack public sale is fail-closed and independent from connectivity", () => {
  const previousSale = process.env.PARSPACK_PUBLIC_SALE_ENABLED;
  const previousEnabled = process.env.PARSPACK_ENABLED;
  try {
    delete process.env.PARSPACK_PUBLIC_SALE_ENABLED;
    process.env.PARSPACK_ENABLED = "true";
    assert.deepEqual(
      getPublicSaleDecision({
        provider: InfrastructureProvider.PARSPACK,
        offerSource: "API_CATALOG",
      }),
      { allowed: false, code: "provider_sale_disabled" },
    );
    assert.throws(
      () =>
        assertPublicSaleEnabled({
          provider: InfrastructureProvider.PARSPACK,
          offerSource: "API_CATALOG",
        }),
      /فروش عمومی سرورهای فوری.*مبلغی برداشت نشد/,
    );

    process.env.PARSPACK_PUBLIC_SALE_ENABLED = "true";
    process.env.PARSPACK_ENABLED = "false";
    assert.deepEqual(
      getPublicSaleDecision({
        provider: InfrastructureProvider.PARSPACK,
        offerSource: "API_CATALOG",
      }),
      { allowed: true, code: "sale_enabled" },
    );
  } finally {
    if (previousSale === undefined) {
      delete process.env.PARSPACK_PUBLIC_SALE_ENABLED;
    } else {
      process.env.PARSPACK_PUBLIC_SALE_ENABLED = previousSale;
    }
    if (previousEnabled === undefined) delete process.env.PARSPACK_ENABLED;
    else process.env.PARSPACK_ENABLED = previousEnabled;
  }
});

test("provider money normalization is explicit, BigInt-only and exact", () => {
  assert.equal(
    normalizeProviderMoney(InfrastructureProvider.ARVAN, "5000000", "IRR"),
    5_000_000n,
  );
  assert.equal(
    normalizeProviderMoney(InfrastructureProvider.PARSPACK, "500000", "TOMAN"),
    5_000_000n,
  );
  assert.throws(() =>
    normalizeProviderMoney(InfrastructureProvider.ARVAN, "10.5", "IRR"),
  );
  assert.deepEqual(irrToDisplayToman(6_250_009n), {
    toman: 625_000n,
    remainderIrr: 9n,
  });
});

test("markup, Parchin and tax are deterministic independent line items", () => {
  assert.equal(multiplyBpsRoundUp(101n, 1), 1n);
  const zero = calculateQuotePricing({
    providerMonthlyPriceIrr: 5_000_000n,
    providerMarkupBps: 0,
    productMarkupBps: 0,
    parchinLevel: "PARCHIN_START",
    parchinPriceIrr: 0n,
    taxBps: 0,
  });
  assert.equal(zero.finalPriceIrr, 5_000_000n);

  const priced = calculateQuotePricing({
    providerMonthlyPriceIrr: 5_000_000n,
    providerMarkupBps: 2500,
    productMarkupBps: 12,
    parchinLevel: "PARCHIN_ACTIVE",
    parchinPriceIrr: 1_000_000n,
    providerAddons: [
      { code: "ipv4", label: "IPv4", amountIrr: 100_000n },
    ],
    taxBps: 1000,
  });
  assert.equal(priced.markupAmountIrr, 1_256_000n);
  assert.equal(priced.taxAmountIrr, 735_600n);
  assert.equal(priced.finalPriceIrr, 8_091_600n);
  assert.deepEqual(
    serializeQuoteLineItems(priced.lineItems).map((item) => item.type),
    [
      "PROVIDER_INFRASTRUCTURE",
      "INFRASTRUCTURE_MARKUP",
      "PARCHIN",
      "PROVIDER_ADDON",
      "TAX",
    ],
  );
});

function pricedPlan(status: ProviderCatalogItem["status"]): EffectivePlan {
  const now = new Date("2026-07-30T10:00:00.000Z");
  const item = {
    id: "catalog",
    provider: InfrastructureProvider.ARVAN,
    apiVersion: "v1",
    productKind: InfrastructureProductKind.CLOUD_SERVER,
    regionCode: "ir-thr-ba1",
    sizeCode: "g6",
    externalPlanId: "g6",
    externalKey: "arvan:v1:ir-thr-ba1:g6",
    sizeName: "g6",
    compatibleImageCodes: ["ubuntu"],
    vcpu: 2,
    ramMb: 4096,
    diskGb: 50,
    transfer: null,
    available: status === "ACTIVE",
    active: true,
    status,
    priceHourlyAmount: 10_000n,
    priceMonthlyAmount: 5_000_000n,
    priceScale: 0,
    currencyCode: "IRR",
    amountUnit: "RIAL",
    providerHourlyPriceIrr: 10_000n,
    providerMonthlyPriceIrr: 5_000_000n,
    lastSyncedAt: now,
    lastSeenAt: now,
    rawUpdatedAt: null,
    rawPayload: {},
    payloadHash: "hash",
    catalogVersion: "v",
    unavailableAt: null,
    createdAt: now,
    updatedAt: now,
  } as ProviderCatalogItem;
  const plan = {
    id: "plan",
    code: "CLOUD",
    title: "Cloud",
    description: null,
    provider: InfrastructureProvider.ARVAN,
    providerApiVersion: "v1",
    productKind: InfrastructureProductKind.CLOUD_SERVER,
    regionCode: item.regionCode,
    sizeCode: item.sizeCode,
    imageCode: "ubuntu",
    deliveryMode: "MANAGED",
    vcpu: 2,
    ramGb: 4,
    storageGb: 50,
    salePriceRial: 1n,
    renewalPriceRial: 1n,
    estimatedProviderCostRial: 1n,
    deliveryEstimateMinutes: 15,
    parchinIncluded: true,
    minimumParchinLevel: "PARCHIN_ACTIVE",
    active: true,
    sortOrder: 0,
    catalogItemId: item.id,
    catalogMappingStatus: "MAPPED",
    catalogMappedAt: now,
    createdAt: now,
    updatedAt: now,
    updatedById: null,
    catalogItem: item,
  } as InfrastructurePlan & { catalogItem: ProviderCatalogItem };
  return plan;
}

test("stale, unavailable, invalid-price and insufficient-Parchin offers fail closed", () => {
  for (const status of [
    "STALE",
    "UNAVAILABLE",
    "INVALID_PRICE",
    "DISABLED",
  ] as const) {
    assert.equal(
      resolvePlanPricing(pricedPlan(status), { markupBasisPoints: 0 }),
      null,
    );
  }
  assert.equal(
    resolvePlanPricing(pricedPlan("ACTIVE"), { markupBasisPoints: 0 }, {
      parchinLevel: "PARCHIN_START",
      parchinPriceRial: 0n,
    }),
    null,
  );
  assert.ok(
    resolvePlanPricing(pricedPlan("ACTIVE"), { markupBasisPoints: 0 }, {
      parchinLevel: "PARCHIN_ACTIVE",
      parchinPriceRial: 100n,
    }),
  );
});

test("Arvan v1 adapter maps regional catalog and uses price_per_month", async () => {
  const methods: string[] = [];
  const urls: string[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    urls.push(url);
    methods.push(init?.method ?? "GET");
    let body: unknown;
    if (url.endsWith("/sizes")) {
      body = [
        {
          id: "same-plan",
          name: "Regional",
          cpu_count: 2,
          memory: 4,
          disk: 50,
          price_per_hour: "7000",
          price_per_month: "4999999",
        },
      ];
    } else if (url.includes("/images?")) {
      body = [
        {
          name: "linux",
          images: [
            {
              id: "ubuntu",
              name: "Ubuntu",
              distribution_name: "Ubuntu",
              disk: 20,
              ram: 1024,
              ssh_key: true,
              ssh_password: true,
            },
          ],
        },
      ];
    } else if (url.endsWith("/servers/options")) {
      body = { network_id: "net" };
    } else if (url.endsWith("/networks")) {
      body = [{ id: "net", name: "public", admin_state_up: true }];
    } else if (url.endsWith("/securities")) {
      body = [{ id: "sec", name: "default", real_name: "arDefault" }];
    } else {
      body = [];
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "x-request-id": "safe-request-id" },
    });
  };
  const adapter = new ArvanV1Adapter({
    apiKey: "test-only-secret",
    regionCodes: ["ir-thr-ba1"],
    baseUrl: "https://napi.arvancloud.ir/ecc/v1/regions",
    fetchImpl: fakeFetch,
  });
  const regions = await adapter.syncRegions();
  const plans = await adapter.syncPlans("ir-thr-ba1");
  const images = await adapter.syncImages("ir-thr-ba1");
  const defaults = await adapter.resolveSelectionDefaults("ir-thr-ba1");
  assert.equal(regions.length, 1);
  assert.equal(plans[0]?.ramMb, 4096);
  assert.equal(plans[0]?.priceMonthlyIrr, 4_999_999n);
  assert.notEqual(
    plans[0]?.priceMonthlyIrr,
    (plans[0]?.priceHourlyIrr ?? 0n) * 720n,
  );
  assert.equal(images[0]?.externalId, "ubuntu");
  assert.deepEqual(
    {
      network: defaults.externalNetworkId,
      security: defaults.externalSecurityId,
    },
    { network: "net", security: "sec" },
  );
  assert.equal(methods.every((method) => method === "GET"), true);
  assert.equal(urls.some((url) => url.includes("/v3")), false);
  assert.equal(
    urls.some(
      (url) =>
        url.endsWith("/ecc/v1/details") ||
        url.endsWith("/ecc/v1/regions"),
    ),
    false,
  );
  assert.deepEqual(regions, [
    {
      code: "ir-thr-ba1",
      name: "ir-thr-ba1",
      available: true,
      rawPayload: {
        code: "ir-thr-ba1",
        source: "database_configuration",
      },
    },
  ]);
  assert.equal(
    urls.some((url) => url.endsWith("/servers/options")),
    true,
  );
});

test("Arvan regions accept validated database input with presentation-only labels", async () => {
  assert.deepEqual(
    parseArvanRegionCodes(
      " ir-thr-si1,ir-thr-fr1,ir-thr-si1, eu-west1-a ",
    ),
    ["ir-thr-si1", "ir-thr-fr1", "eu-west1-a"],
  );
  assert.throws(() => requireArvanRegionCodes(""));
  assert.throws(() => parseArvanRegionCodes("ir-thr-si1,../unsafe"));
  const emptyAdapter = new ArvanV1Adapter({
    apiKey: "test-only",
    regionCodes: [],
  });
  await assert.rejects(
    () => emptyAdapter.syncRegions(),
    /No enabled provider region is configured/,
  );
  assert.equal(
    arvanRegionPresentation("ir-thr-si1").label,
    "سیمین، غرب تهران",
  );
  assert.equal(
    arvanRegionPresentation("eu-west1-a").label,
    "گوته، آلمان",
  );
});

test("Arvan Env regions are optional bootstrap but invalid CSV still fails closed", () => {
  const names = [
    "ARVAN_ENABLED",
    "ARVAN_API_KEY",
    "ARVAN_API_BASE_URL",
    "ARVAN_API_VERSION",
    "ARVAN_REGION_CODES",
    "PARSPACK_ENABLED",
  ] as const;
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  try {
    process.env.ARVAN_ENABLED = "true";
    process.env.ARVAN_API_KEY = "test-only";
    process.env.ARVAN_API_BASE_URL =
      "https://napi.arvancloud.ir/ecc/v1";
    process.env.ARVAN_API_VERSION = "v1";
    process.env.PARSPACK_ENABLED = "false";
    process.env.ARVAN_REGION_CODES = "";
    assert.equal(validateProviderEnvironment().arvanRegionCodesCsv, "");
    process.env.ARVAN_REGION_CODES = "ir-thr-si1,unsafe/path";
    assert.throws(() => validateProviderEnvironment());
    process.env.ARVAN_REGION_CODES =
      "ir-thr-si1, ir-thr-si1,eu-west1-a";
    assert.deepEqual(
      parseArvanRegionCodes(validateProviderEnvironment().arvanRegionCodesCsv),
      ["ir-thr-si1", "eu-west1-a"],
    );
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("Arvan RAM and disk contracts normalize real GB fixtures and fail closed on disagreement", () => {
  for (const memory of [1, 2, 4, 8, 32, 64]) {
    const normalized = normalizeArvanPlanResources({
      memory,
      disk: 50,
    });
    assert.equal(normalized.valid, true);
    assert.equal(normalized.ramMb, memory * 1024);
    assert.equal(normalized.diskGb, 50);
  }
  const bytesPreferred = normalizeArvanPlanResources({
    memory: 32,
    memory_in_bytes: 32 * 1024 * 1024 * 1024,
    disk: 80,
    disk_in_bytes: 80 * 1024 * 1024 * 1024,
  });
  assert.equal(bytesPreferred.valid, true);
  assert.equal(bytesPreferred.ramMb, 32 * 1024);
  assert.equal(bytesPreferred.diskGb, 80);
  assert.equal(catalogRamMbToPlanRamGb(bytesPreferred.ramMb), 32);

  const mismatch = normalizeArvanPlanResources({
    memory: 32,
    memory_in_bytes: 64 * 1024 * 1024 * 1024,
    disk: 80,
  });
  assert.equal(mismatch.valid, false);
  assert.equal(mismatch.error, "memory_unit_mismatch");
});

test("Arvan v3 is rejected before any network call and mutations default disabled", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    return new Response("{}", { status: 200 });
  };
  assert.throws(() =>
    normalizeArvanV1BaseUrl("https://napi.arvancloud.ir/ecc/v3"),
  );
  assert.throws(
    () =>
      new ArvanV1Adapter({
        apiKey: "secret",
        regionCodes: ["ir-thr-ba1"],
        baseUrl: "https://napi.arvancloud.ir/ecc/v3",
        fetchImpl: fakeFetch,
      }),
  );
  const adapter = new ArvanV1Adapter({
    apiKey: "secret",
    regionCodes: ["ir-thr-ba1"],
    fetchImpl: fakeFetch,
  });
  await assert.rejects(() =>
    adapter.createServer({
      productKind: InfrastructureProductKind.CLOUD_SERVER,
      region: "ir-thr-ba1",
      externalPlanId: "g6",
      externalImageId: "ubuntu",
      externalNetworkId: "network",
      externalSecurityId: "security",
      accessMethod: "ONE_TIME_PASSWORD",
      name: "abrchin-order-1",
      orderPublicId: "order",
      idempotencyKey: "idempotency",
    }),
  );
  assert.equal(calls, 0);
});

test("provider secrets are recursively redacted", () => {
  const redacted = redactProviderData({
    authorization: "Apikey secret",
    nested: { token: "secret", status: "ok" },
  });
  assert.deepEqual(redacted, {
    authorization: "[REDACTED]",
    nested: { token: "[REDACTED]", status: "ok" },
  });
  assert.equal(JSON.stringify(redacted).includes("secret"), false);
});

test("timeout after create never submits a blind duplicate and reconciles by name", async () => {
  const adapter = new FakeCloudProviderAdapter({
    createBehavior: "timeout_after_accept",
  });
  const create = {
    productKind: InfrastructureProductKind.CLOUD_SERVER,
    region: "ir-thr-ba1",
    externalPlanId: "g6",
    externalImageId: "ubuntu",
    externalNetworkId: "network",
    externalSecurityId: "security",
    accessMethod: "ONE_TIME_PASSWORD" as const,
    name: "abrchin-public-order-1",
    orderPublicId: "public-order",
    idempotencyKey: "create-order-attempt-1",
  };
  const first = await submitProvisioningOnce({
    adapter,
    attempt: {
      paid: true,
      providerLocked: true,
      createSentAt: null,
      providerTaskId: null,
      providerResourceId: null,
      noResourceConfirmedAt: null,
    },
    create,
  });
  assert.equal(first.state, "RECONCILING");
  const second = await submitProvisioningOnce({
    adapter,
    attempt: {
      paid: true,
      providerLocked: true,
      createSentAt: new Date(),
      providerTaskId: null,
      providerResourceId: null,
      noResourceConfirmedAt: null,
    },
    create,
  });
  assert.equal(second.state, "EXISTING_RESOURCE");
  assert.equal(adapter.createCalls.length, 1);
  await assert.rejects(() =>
    submitProvisioningOnce({
      adapter,
      attempt: {
        paid: false,
        providerLocked: true,
        createSentAt: null,
        providerTaskId: null,
        providerResourceId: null,
        noResourceConfirmedAt: null,
      },
      create,
    }),
  );
});

test("successful Region sync only stales unseen rows and never hard-deletes catalog history", async () => {
  const source = await readFile(
    new URL(
      "../lib/infrastructure/multi-provider-catalog-service.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /Only a fully successful Region may make unseen records stale/);
  assert.match(source, /status: ProviderCatalogStatus\.STALE/);
  assert.doesNotMatch(source, /providerCatalogItem\.delete(?:Many)?\(/);
});

test("customer quote serialization never exposes provider or base price", () => {
  const publicQuote = toPublicRecommendationQuote({
    id: "quote",
    role: "RECOMMENDED",
    amountRial: 1000n,
    renewalAmountRial: 1000n,
    reasons: [],
    planSnapshot: {
      title: "Cloud",
      provider: "ARVAN",
      providerBasePriceRialSnapshot: "500",
      deliveryMode: "MANAGED",
      parchinIncluded: true,
    },
    expiresAt: new Date("2026-07-30T11:00:00.000Z"),
  });
  const serialized = JSON.stringify(publicQuote);
  assert.equal(serialized.includes("ARVAN"), false);
  assert.equal(serialized.includes("providerBasePrice"), false);
});

test("conversation discovery stays adaptive and between three and five questions", () => {
  for (const answers of [
    {},
    { project: "migration" as const, stage: "migration" as const },
    { project: "data" as const, stage: "active" as const },
    { project: "commerce" as const, stage: "growing" as const },
  ]) {
    const order = getRecommendationQuestionOrder(answers);
    assert.ok(order.length >= 3);
    assert.ok(order.length <= 5);
  }
});

test("editing an answer invalidates only dependent quotes and preserves the conversation", async () => {
  const source = await readFile(
    new URL("../lib/recommendation/session-service.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /recommendationQuote\.updateMany/);
  assert.match(source, /RecommendationQuoteStatus\.INVALIDATED/);
  assert.match(source, /recommendationSession\.update/);
  assert.doesNotMatch(source, /recommendationSession\.delete(?:Many)?\(/);
});

test("customer catalog routes enforce Arvan cloud and ParsPack ready products", async () => {
  const source = await readFile(
    new URL("../lib/orders/plans.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /provider: "ARVAN",[\s\S]*productKind: "CLOUD_SERVER"/,
  );
  assert.match(
    source,
    /provider: "PARSPACK",[\s\S]*productKind: "READY_INSTANT_SERVER"/,
  );
});

test("recommendation enforces a risk-based minimum Parchin level", () => {
  assert.equal(
    recommendedParchinLevel({
      project: "site",
      stage: "idea",
      usage: "light",
      criticality: "low",
    }),
    "PARCHIN_START",
  );
  assert.equal(
    recommendedParchinLevel({
      project: "data",
      stage: "active",
      usage: "daily",
      criticality: "medium",
    }),
    "PARCHIN_ACTIVE",
  );
  assert.equal(
    recommendedParchinLevel({
      project: "commerce",
      stage: "growing",
      usage: "busy",
      criticality: "high",
    }),
    "PARCHIN_STABLE",
  );
  assert.throws(() =>
    assertParchinLevelAllowed("PARCHIN_START", "PARCHIN_ACTIVE"),
  );
  assert.doesNotThrow(() =>
    assertParchinLevelAllowed("PARCHIN_STABLE", "PARCHIN_ACTIVE"),
  );
});

test("technology is internal support classification and never a priced package", () => {
  assert.equal(classifyWorkload({ project: "commerce" }), "ECOMMERCE");
  assert.equal(classifyWorkload({ project: "api" }), "API");
  assert.equal(
    classifyWorkload({ project: "data", architecture: "data_heavy" }),
    "DATABASE",
  );
});

test("authoritative product state machine has recovery paths without dead ends", () => {
  for (const required of [
    "DRAFT",
    "UNDERSTANDING_CONFIRMED",
    "REQUIREMENTS_COMPLETE",
    "RECOMMENDED",
    "PARCHIN_SELECTED",
    "DELIVERY_CONFIGURED",
    "QUOTED",
    "AUTH_REQUIRED",
    "AWAITING_PAYMENT",
    "PAID",
    "PROVISIONING_SUBMITTED",
    "PROVISIONING",
    "HEALTH_CHECKING",
    "DELIVERED",
    "ACTIVE",
    "PROVISIONING_RETRYABLE",
    "PROVISIONING_RECONCILING",
    "PROVISIONING_MANUAL_REVIEW",
  ]) {
    assert.equal(productFlowStates.includes(required as never), true);
  }
  assert.equal(
    canTransitionProductFlow("PROVISIONING", "PROVISIONING_RECONCILING"),
    true,
  );
  assert.equal(
    canTransitionProductFlow(
      "PROVISIONING_RETRYABLE",
      "PROVISIONING_SUBMITTED",
    ),
    true,
  );
});
