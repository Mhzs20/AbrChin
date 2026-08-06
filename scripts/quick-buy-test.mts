import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("cloud and ready purchase routes stay provider-separated before login", async () => {
  const cloudPage = await readFile("app/cloud-servers/page.tsx", "utf8");
  const readyPage = await readFile("app/ready-servers/page.tsx", "utf8");
  const chinish = await readFile("components/chinish-cloud-catalog.tsx", "utf8");
  const siteShell = await readFile("components/site-shell.tsx", "utf8");
  const quoteButton = await readFile("components/ready-server-quote-button.tsx", "utf8");

  assert.match(cloudPage, /سرور ابری ابرچین/);
  assert.match(cloudPage, /listPublicStorefrontTiers/);
  assert.doesNotMatch(cloudPage, /listLiveReadyServerOffers/);
  assert.match(readyPage, /redirect\("\/cloud-servers"\)/);
  assert.match(siteShell, /راهکار فوری/);
  assert.doesNotMatch(siteShell, /\/ready-servers/);
  assert.doesNotMatch(siteShell, /shortLabel: "فوری"/);
  assert.match(chinish, /چینش نو|چینش استوار|چینش کهکشان/);
  // Hourly/daily lines are usage equivalents of the billed monthly amount.
  assert.match(chinish, /معادل ساعتی/);
  assert.match(chinish, /معادل روزانه/);
  assert.match(chinish, /چینش فنی/);
  assert.match(chinish, /لوکیشن ایران/);
  assert.match(chinish, /لوکیشن خارج/);
  assert.doesNotMatch(chinish, /قیمت پایه تأمین‌کننده/);
  assert.doesNotMatch(chinish, /همگام‌شده/);
  assert.doesNotMatch(chinish, /سیستم‌عامل‌های مجاز/);
  assert.match(quoteButton, /ثبت سفارش/);
  assert.match(chinish, /امن و آمادهٔ راه‌اندازی با پرچین/);
  assert.match(chinish, /زمان تحویل تقریبی: فوری/);
});

test("customer recommendation UI does not reveal infrastructure providers", async () => {
  const conversation = await readFile("components/conversation-builder.tsx", "utf8");
  const quickBuy = await readFile("components/ready-cloud-catalog.tsx", "utf8");
  const customerSurface = `${conversation}\n${quickBuy}`;

  assert.doesNotMatch(customerSurface, /پارس.?پک/);
  assert.doesNotMatch(customerSurface, /ابر آروان/);
  assert.doesNotMatch(customerSurface, /providerLabel/);
  assert.doesNotMatch(quickBuy, /providerBasePrice|basePrice/);
});

test("checkout locks the quoted amount and rejects expired quotes", async () => {
  const service = await readFile("lib/orders/service.ts", "utf8");
  const payment = await readFile("lib/orders/pay-order-tx.ts", "utf8");
  const quoteService = await readFile(
    "lib/recommendation/quote-service.ts",
    "utf8",
  );
  const ordersRoute = await readFile("app/api/orders/route.ts", "utf8");

  assert.match(service, /quoteExpiresAt/);
  assert.match(quoteService, /10 \* 60 \* 1000/);
  assert.match(service, /createServiceOrderFromQuote/);
  assert.match(service, /recommendationQuoteId/);
  assert.match(service, /quote\.session\.userId !== userId/);
  assert.match(payment, /quote_expired/);
  assert.match(payment, /quote_mismatch/);
  assert.match(payment, /samePlanConfigurationSnapshot/);
  assert.match(payment, /RecommendationQuoteStatus\.CONVERTED/);
  assert.match(payment, /const amountRial = order\.amount/);
  assert.doesNotMatch(payment, /const amountRial = plan\.salePriceRial/);
  assert.match(ordersRoute, /quoteId/);
});

test("ready-server flow supports guests and never creates infrastructure during pricing", async () => {
  const [route, quoteService, worker] = await Promise.all([
    readFile("app/api/cloud-servers/quotes/route.ts", "utf8"),
    readFile("lib/recommendation/quote-service.ts", "utf8"),
    readFile("lib/infrastructure/provisioning-service.ts", "utf8"),
  ]);
  assert.match(route, /getCurrentUser/);
  assert.doesNotMatch(route, /requireCurrentUser/);
  assert.match(quoteService, /createReadyServerQuote/);
  assert.match(quoteService, /RECOMMENDATION_QUOTE_VALIDITY_MS/);
  assert.doesNotMatch(route, /createInstance/);
  assert.doesNotMatch(quoteService, /createInstance/);
  assert.match(worker, /parseLockedProvisioningSelection/);
  assert.match(worker, /order\.providerSelectionSnapshot/);
  assert.doesNotMatch(worker, /order\.plan\.(?:regionCode|sizeCode|imageCode)/);
});

test("guided recommendation requests server-generated quotes instead of static cards", async () => {
  const conversation = await readFile("components/conversation-builder.tsx", "utf8");
  const quoteRoute = await readFile("app/api/recommendations/quotes/route.ts", "utf8");
  const quoteService = await readFile("lib/recommendation/quote-service.ts", "utf8");

  assert.match(conversation, /\/api\/recommendations\/quotes/);
  assert.match(conversation, /quotes=\{quotes\}/);
  assert.doesNotMatch(quoteRoute, /parseRecommendationInput/);
  assert.match(quoteService, /authoritativeAnswers/);
  assert.match(quoteService, /RecommendationQuoteRole/);
  assert.match(quoteService, /rankProviderOffers/);
  assert.match(quoteService, /RECOMMENDATION_QUOTE_VALIDITY_MS/);
  assert.match(quoteService, /quoteNotice/);
  assert.match(quoteService, /خرید خودکار متوقف شد/);
});

test("solutions use quick purchase and keep guided selection optional", async () => {
  const solutions = await readFile("components/solutions-explorer.tsx", "utf8");
  const quickPage = await readFile("app/cloud-servers/page.tsx", "utf8");

  assert.match(solutions, /\/cloud-servers\?project=/);
  assert.match(quickPage, /برای انتخاب مطمئن‌تر راهنمایی بگیر/);
  assert.match(quickPage, /href="\/compass"/);
});
