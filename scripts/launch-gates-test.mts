import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  InfrastructureOfferSource,
  InfrastructureProductKind,
  InfrastructureProvider,
} from "@prisma/client";

import { getPublicSaleDecision } from "../lib/infrastructure/public-sale-policy.ts";

const root = new URL("../", import.meta.url);
const saleKeys = [
  "PUBLIC_SALE_ENABLED",
  "ARVAN_PUBLIC_SALE_ENABLED",
  "ARVAN_READY_PUBLIC_SALE_ENABLED",
  "ARVAN_CLOUD_PUBLIC_SALE_ENABLED",
  "MANUAL_READY_PUBLIC_SALE_ENABLED",
] as const;

async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

function withSaleEnvironment(
  values: Partial<Record<(typeof saleKeys)[number], string>>,
  action: () => void,
) {
  const previous = Object.fromEntries(
    saleKeys.map((key) => [key, process.env[key]]),
  );
  try {
    for (const key of saleKeys) delete process.env[key];
    Object.assign(process.env, values);
    action();
  } finally {
    for (const key of saleKeys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const arvanRoute = {
  provider: InfrastructureProvider.ARVAN,
  offerSource: InfrastructureOfferSource.API_CATALOG,
  productKind: InfrastructureProductKind.READY_INSTANT_SERVER,
};

test("public sale and published provider routes are open by default", () => {
  withSaleEnvironment({}, () => {
    assert.deepEqual(getPublicSaleDecision(arvanRoute), {
      allowed: true,
      code: "sale_enabled",
    });
  });
});

test("an explicit emergency master closure still wins over a provider flag", () => {
  withSaleEnvironment({
    PUBLIC_SALE_ENABLED: "false",
    ARVAN_PUBLIC_SALE_ENABLED: "true",
  }, () => {
    assert.equal(getPublicSaleDecision(arvanRoute).allowed, false);
  });
});

test("the launch-wide gate cannot bypass a disabled provider gate", () => {
  withSaleEnvironment({
    PUBLIC_SALE_ENABLED: "true",
    ARVAN_PUBLIC_SALE_ENABLED: "false",
  }, () => {
    assert.deepEqual(getPublicSaleDecision(arvanRoute), {
      allowed: false,
      code: "provider_sale_disabled",
    });
  });
});

test("public sale requires both the launch-wide and provider gates", () => {
  withSaleEnvironment(
    {
      PUBLIC_SALE_ENABLED: "true",
      ARVAN_PUBLIC_SALE_ENABLED: "true",
    },
    () => {
      assert.deepEqual(getPublicSaleDecision(arvanRoute), {
        allowed: true,
        code: "sale_enabled",
      });
    },
  );
});

test("deployment templates keep sale open and provider mutations closed", async () => {
  const [development, production, compose] = await Promise.all([
    source(".env.example"),
    source(".env.production.example"),
    source("compose.production.yaml"),
  ]);
  const saleKeys = [
    "PUBLIC_SALE_ENABLED",
    "ARVAN_PUBLIC_SALE_ENABLED",
    "ARVAN_READY_PUBLIC_SALE_ENABLED",
    "ARVAN_CLOUD_PUBLIC_SALE_ENABLED",
    "MANUAL_READY_PUBLIC_SALE_ENABLED",
  ];
  const mutationKeys = ["ARVAN_MUTATIONS_ENABLED"];
  for (const key of saleKeys) {
    assert.match(development, new RegExp(`^${key}=true$`, "m"));
    assert.match(production, new RegExp(`^${key}=true$`, "m"));
    assert.ok(compose.includes(key + ": ${" + key + ":-true}"));
  }
  for (const key of mutationKeys) {
    assert.match(development, new RegExp(`^${key}=false$`, "m"));
    assert.match(production, new RegExp(`^${key}=false$`, "m"));
    assert.ok(compose.includes(key + ": ${" + key + ":-false}"));
  }
  assert.doesNotMatch(compose, /MUTATIONS_ENABLED:-true/);
});

test("public purchase entrypoints delegate to gate-checked service boundaries", async () => {
  const [ordersRoute, walletRoute, orderService, payTx, payment, activation] =
    await Promise.all([
      source("app/api/orders/route.ts"),
      source("app/api/orders/[id]/pay-with-wallet/route.ts"),
      source("lib/orders/service.ts"),
      source("lib/orders/pay-order-tx.ts"),
      source("lib/payments/order-payment.ts"),
      source("lib/billing/activation.ts"),
    ]);

  assert.match(ordersRoute, /createServiceOrderFromQuote/);
  assert.match(walletRoute, /payOrderWithWallet/);

  const createOrder = orderService.slice(
    orderService.indexOf("export async function createServiceOrderFromQuote"),
    orderService.indexOf("export async function payOrderWithWallet"),
  );
  assert.ok(
    createOrder.indexOf("assertPublicSaleEnabled") <
      createOrder.indexOf("prisma.$transaction"),
    "Order creation must be denied before its write transaction",
  );

  const payOrder = orderService.slice(
    orderService.indexOf("export async function payOrderWithWallet"),
  );
  assert.ok(
    payOrder.indexOf("assertPublicSaleEnabled") <
      payOrder.indexOf("executePayOrderWithWalletTx"),
    "Wallet checkout must be denied before ledger debit",
  );
  assert.ok(
    payTx.indexOf("assertPublicSaleEnabled") <
      payTx.indexOf("tx.providerCatalogItem.updateMany"),
    "Transactional checkout must recheck sale before inventory or ledger mutation",
  );
  assert.match(payment, /direct_order_payment_disabled/);
  assert.doesNotMatch(payment, /prisma\.orderPayment\.create/);
  assert.doesNotMatch(payment, /executePayOrderWithWalletTx/);
  assert.match(activation, /assertPublicSaleEnabled/);
});

test("GET surfaces remain read-only and expired quote refresh stays POST-only", async () => {
  const [home, catalog, quote, storefront, cloudRefresh, recommendationRefresh] =
    await Promise.all([
      source("app/page.tsx"),
      source("app/cloud-servers/page.tsx"),
      source("app/cloud-servers/quote/[id]/page.tsx"),
      source("lib/storefront/assortment-service.ts"),
      source("app/api/cloud-servers/quotes/[id]/refresh/route.ts"),
      source("app/api/recommendations/quotes/[id]/refresh/route.ts"),
    ]);
  for (const page of [home, catalog, quote]) {
    assert.doesNotMatch(
      page,
      /\b(?:createServiceOrderFromQuote|payOrderWithWallet|createOrderPaymentIntent|refreshRecommendationQuote)\s*\(/,
    );
  }
  assert.match(quote, /فروش عمومی هنوز فعال نشده است/);
  assert.match(quote, /!saleDecision\.allowed/);
  assert.match(catalog, /فروش عمومی هنوز فعال نیست/);
  const publicCatalog = storefront.slice(
    storefront.indexOf("export async function listPublicStorefrontTiers"),
    storefront.indexOf("export async function replaceStorefrontTier"),
  );
  assert.doesNotMatch(publicCatalog, /\.create\(|\.update\(|\.upsert\(|\.delete\(/);
  for (const refresh of [cloudRefresh, recommendationRefresh]) {
    assert.match(refresh, /export async function POST/);
    assert.doesNotMatch(refresh, /export async function GET/);
  }
});

test("provider lifecycle mutations fail before the first network request", async () => {
  const arvan = await source("lib/infrastructure/arvan/v1-adapter.ts");
  const arvanRequest = arvan.slice(arvan.indexOf("private async request("));
  assert.ok(
    arvanRequest.indexOf('method !== "GET" && !this.mutationsEnabled') <
      arvanRequest.indexOf("this.fetchImpl("),
  );
});
