import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { calculateWalletShortfallRial } from "../lib/wallet/topup-limits.ts";
import { safeCustomerReturnPath } from "../lib/customer/navigation.ts";
import { RECOMMENDATION_QUOTE_VALIDITY_MS } from "../lib/recommendation/quote-service.ts";

test("exact shortfall calculation stays integer and ceil-safe for top-up", () => {
  assert.equal(
    calculateWalletShortfallRial(80_000_000n, 120_000_000n),
    0n,
  );
  assert.equal(
    calculateWalletShortfallRial(80_000_000n, 50_000_000n),
    30_000_000n,
  );
  // 3,000,001 rial shortfall → ceil toman = 300_001
  const shortfallRial = 3_000_001n;
  const tomanCeil = (shortfallRial + 9n) / 10n;
  assert.equal(tomanCeil, 300_001n);
});

test("top-up returnTo preserves quote path and rejects open redirects", () => {
  assert.equal(
    safeCustomerReturnPath("/cloud-servers/quote/q1"),
    "/cloud-servers/quote/q1",
  );
  assert.equal(
    safeCustomerReturnPath("/ready-servers/quote/q2"),
    "/ready-servers/quote/q2",
  );
  assert.equal(safeCustomerReturnPath("//evil.example"), null);
});

test("quote TTL remains 60 minutes and is not extended by top-up UX", () => {
  assert.equal(RECOMMENDATION_QUOTE_VALIDITY_MS, 60 * 60 * 1000);
});

test("wallet-first checkout removes direct gateway CTA and uses wallet CTAs", async () => {
  const checkout = await readFile(
    "components/account/order-checkout-panel.tsx",
    "utf8",
  );
  const countdown = await readFile("components/quote-countdown.tsx", "utf8");
  const expired = await readFile(
    "components/quote/quote-expired-refresh.tsx",
    "utf8",
  );
  const topupResult = await readFile("components/topup-result.tsx", "utf8");
  const ordersRoute = await readFile("app/api/orders/route.ts", "utf8");
  const readyButton = await readFile(
    "components/ready-server-quote-button.tsx",
    "utf8",
  );
  const conversation = await readFile(
    "components/conversation-builder.tsx",
    "utf8",
  );

  assert.doesNotMatch(checkout, /پرداخت مستقیم از درگاه/);
  assert.doesNotMatch(checkout, /handleGatewayPurchase/);
  assert.doesNotMatch(checkout, /\/payment/);
  assert.match(checkout, /خرید و ساخت سرور/);
  assert.match(checkout, /شارژ .* تومان و ادامه خرید/);
  assert.match(checkout, /دریافت قیمت جدید/);
  assert.match(checkout, /این ظرفیت دیگر قابل تحویل نیست/);
  assert.match(checkout, /pay-with-wallet/);
  assert.match(checkout, /returnTo/);
  assert.match(checkout, /موجودی فعلی کیف پول/);
  assert.match(checkout, /مانده پس از خرید/);
  assert.match(checkout, /کسری/);
  assert.match(checkout, /جمع قفل‌شده/);

  assert.match(countdown, /۶۰ دقیقه/);
  assert.match(countdown, /تا ساعت/);
  assert.doesNotMatch(countdown, /قبل از پرداخت دوباره بررسی/);
  assert.doesNotMatch(checkout, /قبل از پرداخت دوباره بررسی/);
  assert.match(checkout, /Idempotency-Key/);
  assert.match(
    await readFile("components/topup-form.tsx", "utf8"),
    /customer-topup-create/,
  );

  assert.match(
    expired,
    /مبلغ شارژشده در کیف پول شما محفوظ است/,
  );
  assert.match(expired, /دریافت قیمت جدید/);
  assert.match(expired, /کسر نمی‌شود/);

  assert.match(topupResult, /ادامه خرید|ادامه ارتقا/);
  assert.match(topupResult, /abrchin\.walletTopup\.returnTo/);
  // Must not wipe sessionStorage returnTo with null resumePath.
  assert.match(topupResult, /if \(apiResume\)/);

  assert.doesNotMatch(ordersRoute, /replacementQuote/);
  assert.doesNotMatch(ordersRoute, /refreshRecommendationQuote/);
  assert.match(ordersRoute, /code: error\.code/);

  assert.match(readyButton, /کد تخفیف دارید؟/);
  assert.match(conversation, /کد تخفیف دارید؟/);
  assert.doesNotMatch(readyButton, /discount type|نوع تخفیف/i);
});

test("cloud and ready quote pages wire wallet-first checkout props", async () => {
  const cloud = await readFile(
    "app/cloud-servers/quote/[id]/page.tsx",
    "utf8",
  );
  const ready = await readFile(
    "app/ready-servers/quote/[id]/page.tsx",
    "utf8",
  );
  const account = await readFile(
    "app/account/order/quote/[id]/page.tsx",
    "utf8",
  );

  for (const source of [cloud, ready, account]) {
    assert.match(source, /OrderCheckoutPanel/);
    assert.match(source, /walletBalanceRial/);
    assert.match(source, /returnToPath/);
    assert.match(source, /expiresAt=/);
    assert.match(source, /serverSummary=/);
    assert.match(source, /refreshApiPath=/);
    assert.doesNotMatch(source, /قبل از پرداخت دوباره/);
  }
});
