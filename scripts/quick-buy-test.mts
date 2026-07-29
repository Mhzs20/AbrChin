import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("quick cloud purchase route exists and exposes price before login", async () => {
  const page = await readFile("app/cloud-servers/page.tsx", "utf8");
  const cards = await readFile("components/quick-cloud-plans.tsx", "utf8");

  assert.match(page, /خرید سریع سرور ابری/);
  assert.match(cards, /ماه اول/);
  assert.match(cards, /تمدید/);
  assert.match(cards, /انتخاب این چینش/);
  assert.match(cards, /اقتصادی/);
  assert.match(cards, /پیشنهاد ابرچین/);
  assert.match(cards, /آماده رشد/);
  assert.match(cards, /۱۰ دقیقه/);
  assert.match(cards, /قیمت:/);
  assert.match(cards, /عملکرد:/);
  assert.match(cards, /رشد:/);
  assert.match(cards, /ریسک:/);
});

test("customer recommendation UI does not reveal infrastructure providers", async () => {
  const conversation = await readFile("components/conversation-builder.tsx", "utf8");
  const quickBuy = await readFile("components/quick-cloud-plans.tsx", "utf8");
  const customerSurface = `${conversation}\n${quickBuy}`;

  assert.doesNotMatch(customerSurface, /پارس.?پک/);
  assert.doesNotMatch(customerSurface, /ابر آروان/);
  assert.doesNotMatch(customerSurface, /providerLabel/);
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
  assert.match(payment, /RecommendationQuoteStatus\.CONVERTED/);
  assert.match(payment, /const amountRial = order\.amount/);
  assert.doesNotMatch(payment, /const amountRial = plan\.salePriceRial/);
  assert.match(ordersRoute, /quoteId/);
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
