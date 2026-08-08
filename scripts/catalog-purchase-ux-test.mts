import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  storefrontParchinLevel,
  storefrontParchinTitle,
} from "../lib/storefront/tiers.ts";

test("public cards are purchasable-only and Parchin follows chinish", async () => {
  assert.equal(storefrontParchinLevel("NO"), "PARCHIN_START");
  assert.equal(storefrontParchinLevel("OSTOVAR"), "PARCHIN_ACTIVE");
  assert.equal(storefrontParchinLevel("KAHKESHAN"), "PARCHIN_STABLE");
  assert.equal(storefrontParchinTitle("KAHKESHAN"), "پرچین کهکشان");

  const assortment = await readFile(
    "lib/storefront/assortment-service.ts",
    "utf8",
  );
  const plans = await readFile("lib/orders/plans.ts", "utf8");
  assert.match(
    assortment,
    /result\.offers\.filter\(\(offer\) => offer\.purchasable\)/,
  );
  assert.match(
    assortment,
    /pricingParchinLevel = storefrontParchinLevel\(tier\)/,
  );
  assert.match(plans, /requestedParchinLevel = storefrontTier/);
  assert.match(plans, /parchinTitle: storefrontParchinTitle\(storefrontTier\)/);
});

test("configuration lives in the customer panel and keeps only four fields", async () => {
  const button = await readFile(
    "components/ready-server-quote-button.tsx",
    "utf8",
  );
  const page = await readFile(
    "app/account/order/configure/[planId]/page.tsx",
    "utf8",
  );
  const dialog = await readFile(
    "components/parchin-details-dialog.tsx",
    "utf8",
  );
  assert.match(button, /\/account\/order\/configure\//);
  assert.match(page, /requireCustomerPage/);
  assert.match(button, /سیستم‌عامل و نسخه/);
  assert.match(button, /نام سرور/);
  assert.match(button, /مدت خرید/);
  assert.match(button, /کد تخفیف/);
  assert.doesNotMatch(button, /تنظیمات پیشرفته|خارج از پرچین/);
  assert.doesNotMatch(dialog, /شامل نمی‌شود|خدمات خارج از قرارداد/);
});

test("API catalog quote locks an admin-fulfilled order without live topology", async () => {
  const quoteService = await readFile(
    "lib/recommendation/quote-service.ts",
    "utf8",
  );
  assert.match(quoteService, /lockAdminFulfilledCatalogPlan/);
  assert.match(
    quoteService,
    /if \(plan\.offerSource === "API_CATALOG"\) \{\s*return lockAdminFulfilledCatalogPlan/,
  );
  assert.match(quoteService, /topologyVerificationMode: "PROVIDER_MANAGED"/);
  assert.match(quoteService, /externalNetworkId: null/);
  assert.match(quoteService, /catalog-code:/);
});
