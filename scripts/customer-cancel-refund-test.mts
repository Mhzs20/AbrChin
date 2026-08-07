import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { computePrepaidCancellationPreview } from "../lib/orders/prepaid-cancellation.ts";

test("prepaid cancel preview uses straight-line recognition and exact refund math", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  // Exactly 25% through a 1-month (30-day) term.
  const asOf = new Date(start.getTime() + 7.5 * 24 * 60 * 60 * 1000);
  const preview = computePrepaidCancellationPreview({
    originalPaidRial: 80_000_000n,
    termMonths: 1,
    serviceStartedAt: start,
    asOf,
    walletBalanceRial: 10_000_000n,
  });
  assert.equal(preview.originalPaidRial, 80_000_000n);
  assert.equal(preview.consumedRial, 20_000_000n);
  assert.equal(preview.nonRefundableRial, 0n);
  assert.equal(preview.refundableRial, 60_000_000n);
  assert.equal(preview.walletBalanceAfterRefundRial, 70_000_000n);
});

test("fully elapsed prepaid term refunds zero and keeps original paid immutable", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  const asOf = new Date(start.getTime() + 40 * 24 * 60 * 60 * 1000);
  const preview = computePrepaidCancellationPreview({
    originalPaidRial: 8_000_000n,
    termMonths: 1,
    serviceStartedAt: start,
    asOf,
    walletBalanceRial: 0n,
  });
  assert.equal(preview.consumedRial, 8_000_000n);
  assert.equal(preview.refundableRial, 0n);
  assert.equal(preview.walletBalanceAfterRefundRial, 0n);
});

test("policy-defined non-refundable amount reduces refundable base only", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  const preview = computePrepaidCancellationPreview({
    originalPaidRial: 10_000_000n,
    termMonths: 1,
    serviceStartedAt: start,
    asOf: start,
    nonRefundableRial: 1_000_000n,
    walletBalanceRial: 0n,
  });
  assert.equal(preview.consumedRial, 0n);
  assert.equal(preview.nonRefundableRial, 1_000_000n);
  assert.equal(preview.refundableRial, 9_000_000n);
});

test("cancel UX and lifecycle wiring stay wallet-only and idempotent", async () => {
  const cancelService = await readFile(
    "lib/orders/customer-cancel-service.ts",
    "utf8",
  );
  const panel = await readFile(
    "components/account/service-cancel-panel.tsx",
    "utf8",
  );
  const route = await readFile(
    "app/api/account/instances/[id]/cancel/route.ts",
    "utf8",
  );
  const fulfill = await readFile(
    "app/api/admin/resource-changes/[id]/fulfill-manually/route.ts",
    "utf8",
  );
  const posting = await readFile("lib/accounting/posting.ts", "utf8");
  const changeButtons = await readFile(
    "components/account/service-change-request-buttons.tsx",
    "utf8",
  );

  assert.match(cancelService, /CANCEL_REQUESTED/);
  assert.match(cancelService, /TERMINATING/);
  assert.match(cancelService, /TERMINATED/);
  assert.match(cancelService, /REFUND_CREDITED/);
  assert.match(cancelService, /order_cancel_refund_/);
  assert.match(cancelService, /payg_cancel_not_supported/);
  assert.match(cancelService, /LedgerType\.REFUND/);
  assert.match(cancelService, /completeCancellationAfterTermination/);
  assert.doesNotMatch(cancelService, /createOrderPaymentIntent|\/payment/);

  assert.match(panel, /لغو سرویس و بازگشت/);
  assert.match(panel, /اعتبار خرید/);
  assert.match(panel, /مصرف‌شده/);
  assert.match(panel, /مبلغ قابل بازگشت/);
  assert.match(panel, /سرویس لغو شد/);
  assert.match(panel, /account\/transactions/);

  assert.match(route, /previewCustomerServiceCancellation/);
  assert.match(route, /requestCustomerServiceCancellation/);
  assert.match(route, /Idempotency-Key/);

  assert.match(fulfill, /completeCancellationAfterTermination/);
  assert.match(posting, /postPrepaidCancellationRefund/);
  assert.match(posting, /SALES_REFUND/);
  assert.match(posting, /CUSTOMER_WALLET_LIABILITY/);

  assert.doesNotMatch(changeButtons, /درخواست حذف/);
  assert.match(changeButtons, /لغو سرویس/);
});
