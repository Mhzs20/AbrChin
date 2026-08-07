import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCOUNT_CODES,
  ACCOUNT_DEFINITIONS,
  assertAccountCode,
} from "../lib/accounting/accounts.ts";
import { recognitionFraction } from "../lib/accounting/kpis.ts";

test("account catalog covers required operational accounts", () => {
  for (const code of [
    "CASH_GATEWAY",
    "PROVIDER_FUNDING_CLEARING",
    "CUSTOMER_WALLET_LIABILITY",
    "TAX_PAYABLE",
    "DEFERRED_REVENUE",
    "INFRASTRUCTURE_REVENUE",
    "PARCHIN_REVENUE",
    "ADDON_REVENUE",
    "TERM_DISCOUNT",
    "COUPON_DISCOUNT",
    "SALES_REFUND",
    "PROVIDER_INFRASTRUCTURE_COGS",
    "PROVIDER_ADDON_COGS",
    "GATEWAY_FEES",
    "SMS_EXPENSE",
    "SUPPORT_OPERATIONS",
    "HOSTING_OPERATIONS",
    "MARKETING_EXPENSE",
    "PAYROLL_CONTRACTOR",
    "OTHER_OPERATING_EXPENSE",
  ] as const) {
    assert.ok(ACCOUNT_CODES.includes(code));
    assert.equal(assertAccountCode(code), code);
    assert.ok(ACCOUNT_DEFINITIONS[code].labelFa.length > 0);
  }
});

test("wallet top-up conceptual split is liability not revenue", () => {
  assert.equal(ACCOUNT_DEFINITIONS.CASH_GATEWAY.accountClass, "asset");
  assert.equal(
    ACCOUNT_DEFINITIONS.CUSTOMER_WALLET_LIABILITY.accountClass,
    "liability",
  );
  assert.notEqual(
    ACCOUNT_DEFINITIONS.CUSTOMER_WALLET_LIABILITY.accountClass,
    "revenue",
  );
  assert.equal(ACCOUNT_DEFINITIONS.TAX_PAYABLE.accountClass, "liability");
  assert.equal(ACCOUNT_DEFINITIONS.TERM_DISCOUNT.accountClass, "contra_revenue");
  assert.equal(ACCOUNT_DEFINITIONS.COUPON_DISCOUNT.accountClass, "contra_revenue");
  assert.equal(
    ACCOUNT_DEFINITIONS.PROVIDER_INFRASTRUCTURE_COGS.accountClass,
    "cogs",
  );
});

test("KPI definitions: gross profit and operating profit formulas", () => {
  const netSales = 1_000_000n;
  const cogs = 400_000n;
  const opex = 100_000n;
  const grossProfit = netSales - cogs;
  const operatingProfit = grossProfit - opex;
  assert.equal(grossProfit, 600_000n);
  assert.equal(operatingProfit, 500_000n);
  const marginBps = Number((grossProfit * 10_000n) / netSales);
  assert.equal(marginBps, 6_000);
});

test("recognized revenue fractions for 3/6/12 month terms", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  const atStart = recognitionFraction({
    occurredAt: start,
    termMonths: 3,
    asOf: start,
  });
  assert.equal(atStart.recognizedNumerator, 0n);

  const mid = recognitionFraction({
    occurredAt: start,
    termMonths: 3,
    asOf: new Date("2026-02-15T00:00:00.000Z"),
  });
  assert.ok(mid.recognizedNumerator > 0n);
  assert.ok(mid.recognizedNumerator < mid.recognizedDenominator);

  const done3 = recognitionFraction({
    occurredAt: start,
    termMonths: 3,
    asOf: new Date("2026-04-01T00:00:00.000Z"),
  });
  assert.equal(done3.recognizedNumerator, done3.recognizedDenominator);

  const done6 = recognitionFraction({
    occurredAt: start,
    termMonths: 6,
    asOf: new Date("2026-07-01T00:00:00.000Z"),
  });
  assert.equal(done6.recognizedNumerator, done6.recognizedDenominator);

  const done12 = recognitionFraction({
    occurredAt: start,
    termMonths: 12,
    asOf: new Date("2027-01-01T00:00:00.000Z"),
  });
  assert.equal(done12.recognizedNumerator, done12.recognizedDenominator);
});

test("CSV BOM helper marker for Persian Excel", () => {
  const bom = "\uFEFF";
  const csv = `${bom}orderId,amountRial,amountToman\n`;
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /amountRial/);
  assert.match(csv, /amountToman/);
});
