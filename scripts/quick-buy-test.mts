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

  assert.match(service, /quoteExpiresAt/);
  assert.match(service, /10 \* 60 \* 1000/);
  assert.match(payment, /quote_expired/);
  assert.match(payment, /const amountRial = order\.amount/);
  assert.doesNotMatch(payment, /const amountRial = plan\.salePriceRial/);
});

test("solutions use quick purchase and keep guided selection optional", async () => {
  const solutions = await readFile("components/solutions-explorer.tsx", "utf8");
  const quickPage = await readFile("app/cloud-servers/page.tsx", "utf8");

  assert.match(solutions, /\/cloud-servers\?project=/);
  assert.match(quickPage, /برای انتخاب کمک می‌خوام/);
  assert.match(quickPage, /href="\/compass"/);
});
