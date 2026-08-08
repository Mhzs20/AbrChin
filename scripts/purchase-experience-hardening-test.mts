import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { RECOMMENDATION_QUOTE_VALIDITY_MS } from "../lib/recommendation/quote-service.ts";

test("quote lock copy and TTL are explicitly 60 minutes", async () => {
  assert.equal(RECOMMENDATION_QUOTE_VALIDITY_MS, 60 * 60 * 1000);
  const countdown = await readFile("components/quote-countdown.tsx", "utf8");
  const quick = await readFile("components/quick-cloud-plans.tsx", "utf8");
  assert.match(countdown, /۶۰ دقیقه/);
  assert.doesNotMatch(countdown, /۱۰ دقیقه/);
  assert.doesNotMatch(quick, /۱۰ دقیقه/);
  assert.match(quick, /۶۰ دقیقه/);
});

test("customer surfaces avoid provider/internal terminology leaks", async () => {
  const conversation = await readFile(
    "components/conversation-builder.tsx",
    "utf8",
  );
  const cloud = await readFile("components/conversation-cloud.tsx", "utf8");
  const cancel = await readFile(
    "components/account/service-cancel-panel.tsx",
    "utf8",
  );
  const catalog = await readFile(
    "components/chinish-cloud-catalog.tsx",
    "utf8",
  );
  const upgradePage = await readFile(
    "app/account/services/[id]/upgrade/page.tsx",
    "utf8",
  );
  const quoteService = await readFile(
    "lib/recommendation/quote-service.ts",
    "utf8",
  );

  assert.doesNotMatch(conversation, /Region/);
  assert.match(conversation, /موقعیت/);
  assert.doesNotMatch(cloud, /ارائه‌دهنده/);
  assert.doesNotMatch(cancel, /\bProvider\b/);
  assert.doesNotMatch(catalog, /همگام‌سازی دوبارهٔ کاتالوگ/);
  assert.doesNotMatch(upgradePage, /ارائه‌دهنده/);
  assert.doesNotMatch(quoteService, /این Image/);
});

test("top-up and checkout create paths send idempotency keys", async () => {
  const topup = await readFile("components/topup-form.tsx", "utf8");
  const checkout = await readFile(
    "components/account/order-checkout-panel.tsx",
    "utf8",
  );
  const topupRoute = await readFile(
    "app/api/wallet/topups/route.ts",
    "utf8",
  );
  assert.match(topup, /Idempotency-Key/);
  assert.match(topup, /customer-topup-create/);
  assert.match(checkout, /quote-checkout-ui/);
  assert.match(topupRoute, /idempotencyKey: readIdempotencyKey/);
});

test("checkout labels stay Persian and wallet-first", async () => {
  const checkout = await readFile(
    "components/account/order-checkout-panel.tsx",
    "utf8",
  );
  assert.match(checkout, /پردازنده/);
  assert.match(checkout, /حافظه/);
  assert.match(checkout, /دیسک/);
  assert.match(checkout, /سیستم‌عامل/);
  assert.match(checkout, /درگاه فقط برای شارژ کیف پول/);
  assert.doesNotMatch(checkout, />\s*CPU\s*</);
  assert.doesNotMatch(checkout, />\s*OS\s*</);
});

test("configuration and upgrade presentation use design-system shells", async () => {
  const css = await readFile("app/globals.css", "utf8");
  const conversationCss = await readFile("app/conversation.css", "utf8");
  const upgrade = await readFile(
    "components/account/service-upgrade-panels.tsx",
    "utf8",
  );
  const checkout = await readFile(
    "components/account/order-checkout-panel.tsx",
    "utf8",
  );
  assert.doesNotMatch(css, /service-upgrade-panel/);
  assert.doesNotMatch(css, /order-checkout\.product-card::before/);
  assert.doesNotMatch(css, /linear-gradient\(135deg, #e8f7f3/);
  assert.doesNotMatch(conversationCss, /appearance:\s*none/);
  assert.match(upgrade, /product-section/);
  assert.match(upgrade, /product-stat-grid/);
  assert.match(upgrade, /product-row-card/);
  assert.match(upgrade, /order-wallet-summary/);
  assert.match(checkout, /product-section order-checkout/);
});

test("storefront cards route to a minimal account configurator", async () => {
  const button = await readFile(
    "components/ready-server-quote-button.tsx",
    "utf8",
  );
  const page = await readFile(
    "app/account/order/configure/[planId]/page.tsx",
    "utf8",
  );
  const quoteService = await readFile(
    "lib/recommendation/quote-service.ts",
    "utf8",
  );
  assert.match(button, /\/account\/order\/configure\//);
  assert.match(page, /requireCustomerPage/);
  assert.match(button, /سیستم‌عامل و نسخه/);
  assert.match(button, /نام سرور/);
  assert.match(button, /مدت خرید/);
  assert.match(button, /کد تخفیف/);
  assert.doesNotMatch(button, /تنظیمات پیشرفته|خارج از پرچین/);
  assert.match(quoteService, /lockAdminFulfilledCatalogPlan/);
  assert.match(quoteService, /topologyVerificationMode: "PROVIDER_MANAGED"/);
});
