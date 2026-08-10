import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  storefrontParchinLevel,
  storefrontParchinTitle,
} from "../lib/storefront/tiers.ts";

test("public cards set a chinish minimum and allow a higher Parchin level", async () => {
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
  assert.match(plans, /minimumStorefrontParchinLevel/);
  assert.match(plans, /termOptions\.parchinLevel \?\? minimumStorefrontParchinLevel/);
  assert.match(plans, /parchinLevelRank\(requestedParchinLevel\)/);
  assert.match(plans, /storefrontParchinTitleForLevel\(requestedParchinLevel\)/);
});

test("configuration is public before Login and keeps the Parchin choice explicit", async () => {
  const button = await readFile(
    "components/ready-server-quote-button.tsx",
    "utf8",
  );
  const page = await readFile(
    "app/cloud-servers/configure/[planId]/page.tsx",
    "utf8",
  );
  const dialog = await readFile(
    "components/parchin-details-dialog.tsx",
    "utf8",
  );
  assert.match(button, /\/cloud-servers\/configure\//);
  assert.doesNotMatch(page, /requireCustomerPage/);
  assert.match(page, /پیش‌فاکتور نهایی پیش از ورود/);
  assert.match(button, /سیستم‌عامل و نسخه/);
  assert.match(button, /نام سرور/);
  assert.match(button, /مدت خرید/);
  assert.match(button, /کد تخفیف/);
  assert.match(button, /سطح پرچین/);
  assert.match(button, /requestedParchinLevel/);
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
