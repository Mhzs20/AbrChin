import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { safeCustomerReturnPath } from "../lib/customer/navigation.ts";

test("guest config creates the final quote before Login", async () => {
  const [configPage, button, catalog, quotePage] = await Promise.all([
    readFile("app/cloud-servers/configure/[planId]/page.tsx", "utf8"),
    readFile("components/ready-server-quote-button.tsx", "utf8"),
    readFile("components/chinish-cloud-catalog.tsx", "utf8"),
    readFile("app/cloud-servers/quote/[id]/page.tsx", "utf8"),
  ]);

  assert.doesNotMatch(configPage, /requireCustomerPage|getCurrentUser/);
  assert.match(configPage, /پیش‌فاکتور نهایی پیش از ورود/);
  assert.match(button, /\/cloud-servers\/configure\//);
  assert.match(button, /fetch\(`\/api\/\$\{productPath\}\/quotes`/);
  assert.match(button, /`\/\$\{productPath\}\/quote\/\$\{body\.quote\.id\}`/);
  assert.doesNotMatch(button, /requireLogin|\/login\?next=/);
  assert.doesNotMatch(catalog, /requireLogin/);
  assert.match(quotePage, /پیش‌فاکتور قفل شد/);
  assert.match(quotePage, /ورود و ادامه خرید/);
  assert.match(quotePage, /encodeURIComponent\(next\)/);
});

test("claim preserves the immutable quote and transfers only session ownership", async () => {
  const [claimRoute, sessionService, quoteService] = await Promise.all([
    readFile("app/api/recommendations/sessions/claim/route.ts", "utf8"),
    readFile("lib/recommendation/session-service.ts", "utf8"),
    readFile("lib/recommendation/quote-service.ts", "utf8"),
  ]);

  assert.match(claimRoute, /claimConversationByGuestToken/);
  assert.match(claimRoute, /clearRecommendationGuestCookie/);
  assert.match(sessionService, /userId: input\.userId/);
  assert.match(sessionService, /guestAccessTokenHash: null/);
  assert.match(sessionService, /claimedAt: new Date\(\)/);
  const claimBody = sessionService.slice(
    sessionService.indexOf("export async function claimConversationSession"),
    sessionService.indexOf("export async function claimConversationByGuestToken"),
  );
  assert.doesNotMatch(claimBody, /recommendationQuote\.(?:update|delete)/);
  assert.match(quoteService, /60 \* 60 \* 1000/);
  assert.match(quoteService, /planSnapshot/);
  assert.match(quoteService, /deliveryConfigurationSnapshot/);
});

test("Login keeps a safe exact return path and exposes claim retry without a new OTP", async () => {
  const login = await readFile("components/login-form.tsx", "utf8");

  assert.equal(
    safeCustomerReturnPath("/cloud-servers/quote/quote-123"),
    "/cloud-servers/quote/quote-123",
  );
  assert.equal(safeCustomerReturnPath("//evil.example"), null);
  assert.equal(safeCustomerReturnPath("/\\evil.example"), null);
  assert.equal(safeCustomerReturnPath("https://evil.example"), null);
  assert.match(login, /safeCustomerReturnPath/);
  assert.match(login, /claimRecoveryUser/);
  assert.match(login, /اتصال دوباره و ادامه خرید/);
  assert.match(login, /نیازی به کد تازه نیست/);
  assert.match(login, /retryClaim/);
});

test("legacy authenticated configurator redirects to the public canonical path", async () => {
  const legacy = await readFile(
    "app/account/order/configure/[planId]/page.tsx",
    "utf8",
  );
  assert.match(legacy, /\/cloud-servers\/configure\//);
  assert.match(legacy, /redirect/);
  assert.doesNotMatch(legacy, /requireCustomerPage/);
});
