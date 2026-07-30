import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("cloud and ready purchase routes stay provider-separated before login", async () => {
  const cloudPage = await readFile("app/cloud-servers/page.tsx", "utf8");
  const readyPage = await readFile("app/ready-servers/page.tsx", "utf8");
  const cards = await readFile("components/ready-cloud-catalog.tsx", "utf8");
  const quoteButton = await readFile("components/ready-server-quote-button.tsx", "utf8");

  assert.match(cloudPage, /سرورهای ابری قابل انتخاب/);
  assert.match(cloudPage, /listLiveCloudServerOffers/);
  assert.doesNotMatch(cloudPage, /listLiveReadyServerOffers/);
  assert.match(readyPage, /سرورهای آماده/);
  assert.match(readyPage, /listLiveReadyServerOffers/);
  assert.doesNotMatch(readyPage, /listLiveCloudServerOffers/);
  assert.match(cards, /ماهانه و تمدید فعلی/);
  assert.match(quoteButton, /دریافت Quote/);
  assert.match(cards, /همه موقعیت‌ها/);
  assert.match(cards, /۱۰ دقیقه/);
  assert.match(cards, /سطح پرچین/);
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
  const ordersRoute = await readFile("app/api/orders/route.ts", "utf8");

  assert.match(service, /quoteExpiresAt/);
  assert.match(service, /10 \* 60 \* 1000/);
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
  assert.match(worker, /serviceOrder\.planSnapshot/);
});

test("guided recommendation requests server-generated quotes instead of static cards", async () => {
  const conversation = await readFile("components/conversation-builder.tsx", "utf8");
  const quoteRoute = await readFile("app/api/recommendations/quotes/route.ts", "utf8");
  const quoteService = await readFile("lib/recommendation/quote-service.ts", "utf8");

  assert.match(conversation, /\/api\/recommendations\/quotes/);
  assert.match(conversation, /quotes=\{quotes\}/);
  assert.match(quoteRoute, /parseRecommendationInput/);
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
  assert.match(quickPage, /برای انتخاب کمک می‌خوام/);
  assert.match(quickPage, /href="\/compass"/);
});
