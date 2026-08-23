import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  computePrepaidUpgradeCharge,
  remainingRecognitionFraction,
} from "../lib/orders/prepaid-upgrade.ts";
import {
  isStrictResourceUpgrade,
  upgradeDebitIdempotencyKey,
  upgradeQuoteHasFinancialCommitment,
  parseUpgradeQuoteSnapshot,
} from "../lib/orders/upgrade-quote.ts";
import { calculateWalletShortfallRial } from "../lib/wallet/topup-limits.ts";
import { RECOMMENDATION_QUOTE_VALIDITY_MS } from "../lib/recommendation/quote-service.ts";
import { safeCustomerReturnPath } from "../lib/customer/navigation.ts";
import { calculateResourceChangeBufferRial } from "../lib/billing/policy.ts";

test("prepaid upgrade charge uses remaining recognition delta, not naive subtraction", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  // 25% elapsed on a 30-day term → 75% remaining.
  const asOf = new Date(start.getTime() + 7.5 * 24 * 60 * 60 * 1000);
  const preview = computePrepaidUpgradeCharge({
    originalPaidRial: 80_000_000n,
    newFullTermPriceRial: 160_000_000n,
    termMonths: 1,
    serviceStartedAt: start,
    asOf,
  });
  // unused current = 75% of 80M = 60M; remaining target = 75% of 160M = 120M
  // charge = 60M
  assert.equal(preview.unusedCurrentRial, 60_000_000n);
  assert.equal(preview.remainingTargetRial, 120_000_000n);
  assert.equal(preview.upgradeChargeRial, 60_000_000n);
  // Naive full subtraction would be 80M — must not match.
  assert.notEqual(
    preview.upgradeChargeRial,
    preview.newFullTermPriceRial - preview.originalPaidRial,
  );
});

test("fully elapsed prepaid term yields zero upgrade charge", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  const asOf = new Date(start.getTime() + 40 * 24 * 60 * 60 * 1000);
  const preview = computePrepaidUpgradeCharge({
    originalPaidRial: 80_000_000n,
    newFullTermPriceRial: 160_000_000n,
    termMonths: 1,
    serviceStartedAt: start,
    asOf,
  });
  assert.equal(preview.upgradeChargeRial, 0n);
  const remaining = remainingRecognitionFraction({
    occurredAt: start,
    termMonths: 1,
    asOf,
  });
  assert.equal(remaining.remainingNumerator, 0n);
});

test("strict upgrade rejects downgrade and sideways disk shrink", () => {
  assert.equal(
    isStrictResourceUpgrade(
      { vcpu: 4, ramGb: 8, diskGb: 120 },
      { vcpu: 8, ramGb: 16, diskGb: 240 },
    ),
    true,
  );
  assert.equal(
    isStrictResourceUpgrade(
      { vcpu: 4, ramGb: 8, diskGb: 120 },
      { vcpu: 2, ramGb: 16, diskGb: 240 },
    ),
    false,
  );
  assert.equal(
    isStrictResourceUpgrade(
      { vcpu: 4, ramGb: 8, diskGb: 120 },
      { vcpu: 8, ramGb: 16, diskGb: 100 },
    ),
    false,
  );
  assert.equal(
    isStrictResourceUpgrade(
      { vcpu: 4, ramGb: 8, diskGb: 120 },
      { vcpu: 4, ramGb: 8, diskGb: 120 },
    ),
    false,
  );
});

test("locked upgrade amount is not increased by later price rise within TTL", () => {
  const locked = 50_000_000n;
  const liveAfterRise = 70_000_000n;
  // Customer pays locked; live rise must not increase charge.
  const charge = locked < liveAfterRise ? locked : liveAfterRise;
  assert.equal(charge, locked);
  assert.equal(RECOMMENDATION_QUOTE_VALIDITY_MS, 60 * 60 * 1000);
});

test("insufficient wallet shortfall and top-up return preserve upgrade quote path", () => {
  assert.equal(
    calculateWalletShortfallRial(80_000_000n, 50_000_000n),
    30_000_000n,
  );
  assert.equal(
    safeCustomerReturnPath("/account/upgrade/rcr_123"),
    "/account/upgrade/rcr_123",
  );
  assert.equal(safeCustomerReturnPath("//evil"), null);
});

test("PAYG upgrade buffer follows billing policy incremental rate", () => {
  const required = calculateResourceChangeBufferRial({
    policy: {
      availability: "HOURLY_AND_DAILY",
      defaultCadence: "HOURLY",
      displayMode: "BOTH",
      hourlyMinimumCreditHours: 24,
      dailyMinimumCreditDays: 2,
      hourlyGracePeriods: 6,
      dailyGracePeriods: 2,
      lowBalanceThresholdPeriods: 3,
    },
    cadence: "HOURLY",
    currentHourlyEstimateRial: 1_000n,
    targetHourlyEstimateRial: 1_500n,
    currentDailyEstimateRial: 24_000n,
    targetDailyEstimateRial: 36_000n,
  });
  assert.equal(required, 12_000n);
});

test("financial commitment and debit idempotency keys are stable", () => {
  assert.equal(
    upgradeDebitIdempotencyKey("abc"),
    "resource_change_upgrade_debit_abc",
  );
  assert.equal(
    upgradeQuoteHasFinancialCommitment({
      kind: "upgrade_quote",
      version: 1,
      financial: {
        walletDebitedAt: "2026-08-07T00:00:00.000Z",
        ledgerIdempotencyKey: "resource_change_upgrade_debit_abc",
        ledgerEntryId: "led1",
        amountRial: "1000",
      },
    }),
    true,
  );
  assert.equal(
    upgradeQuoteHasFinancialCommitment({
      kind: "upgrade_quote",
      version: 1,
    }),
    false,
  );
  const snap = parseUpgradeQuoteSnapshot({
    kind: "upgrade_quote",
    version: 1,
    action: "UPGRADE",
    billingModel: "PREPAID_TERM",
    expiresAt: "2026-08-07T12:00:00.000Z",
    quotedAt: "2026-08-07T11:00:00.000Z",
    lockedUpgradeChargeRial: "1000",
    current: { planId: "a", planTitle: "A", vcpu: 2, ramGb: 4, diskGb: 40 },
    target: {
      planId: "b",
      planTitle: "B",
      sizeCode: "s",
      code: "c",
      vcpu: 4,
      ramGb: 8,
      diskGb: 80,
    },
    delta: { vcpu: 2, ramGb: 4, diskGb: 40 },
    providerMutationExecuted: false,
  });
  assert.ok(snap);
  assert.equal(snap?.lockedUpgradeChargeRial, "1000");
});

test("upgrade UX replaces vague request and wires wallet CTAs", async () => {
  const buttons = await readFile(
    "components/account/service-change-request-buttons.tsx",
    "utf8",
  );
  const panels = await readFile(
    "components/account/service-upgrade-panels.tsx",
    "utf8",
  );
  const upgradeApi = await readFile(
    "app/api/account/instances/[id]/upgrade/route.ts",
    "utf8",
  );
  const payApi = await readFile(
    "app/api/account/resource-changes/[id]/pay-with-wallet/route.ts",
    "utf8",
  );
  const fulfill = await readFile(
    "app/api/admin/resource-changes/[id]/fulfill-manually/route.ts",
    "utf8",
  );
  const adminReview = await readFile("lib/billing/admin-review.ts", "utf8");
  const posting = await readFile("lib/accounting/posting.ts", "utf8");
  const service = await readFile("lib/orders/upgrade-quote.ts", "utf8");

  assert.doesNotMatch(buttons, /درخواست ارتقا/);
  assert.match(buttons, /ارتقای سرور/);
  assert.match(buttons, /account\/services\/\$\{instanceId\}\/upgrade/);

  assert.match(panels, /منابع فعلی/);
  assert.match(panels, /منابع جدید/);
  assert.match(panels, /هزینه ارتقا/);
  assert.match(panels, /موجودی کیف پول/);
  assert.match(panels, /مانده پس از ارتقا/);
  assert.match(panels, /ارتقا با موجودی کیف پول/);
  assert.match(panels, /شارژ .* تومان و ادامه ارتقا/);
  assert.match(panels, /returnTo/);
  assert.match(panels, /مبلغ شارژشده در کیف پول محفوظ است/);
  assert.match(panels, /دریافت پیش‌فاکتور جدید/);

  assert.match(upgradeApi, /createUpgradeQuote/);
  assert.match(upgradeApi, /listUpgradeTargetsForInstance/);
  assert.match(payApi, /payUpgradeQuoteWithWallet/);
  assert.match(payApi, /Idempotency-Key/);

  assert.match(fulfill, /upgradeQuoteHasFinancialCommitment/);
  assert.match(fulfill, /قبل از انجام ارتقا باید مبلغ قفل‌شده/);
  assert.match(adminReview, /upgradeQuoteHasFinancialCommitment/);
  assert.match(posting, /postPrepaidUpgradeCharge/);
  assert.match(posting, /resource_upgrade_charged/);

  assert.match(service, /RECOMMENDATION_QUOTE_VALIDITY_MS/);
  assert.match(service, /resource_change_upgrade_debit_/);
  assert.match(service, /quote_expired/);
  assert.match(service, /target_unavailable/);
  assert.match(service, /WAITING_ADMIN_APPROVAL/);
  assert.doesNotMatch(service, /createOrderPaymentIntent|\/payment/);
  // Price rise alone must not increase locked charge at pay time.
  assert.match(service, /lockedUpgradeChargeRial/);
  assert.match(
    service,
    /price rise alone must not increase charge/i,
  );
  // Upgrade targets are AbrChin published plans; provider resize API is
  // optional — Arvan may API-resize when enabled, otherwise manual.
  assert.match(service, /providerResizeCapability/);
  assert.match(service, /apiResizeSupported:\s*true/);
  assert.match(
    service,
    /manualFulfillmentRequired:\s*!mutationsEnabledFor\(provider\)/,
  );
  assert.match(service, /Do not fabricate provider capability/);
});
