import assert from "node:assert/strict";
import test from "node:test";

import {
  AccountingQuality,
  OperatingExpenseCategory,
  PrismaClient,
  UserRole,
} from "@prisma/client";

import { allowAdminMobile } from "./test-admin-allowlist.mts";

import { runAccountingBackfill } from "../lib/accounting/backfill.ts";
import {
  createDraftExpense,
  postExpense,
  reverseExpense,
} from "../lib/accounting/expenses.ts";
import { postJournalEntry } from "../lib/accounting/journal.ts";
import { computeAccountingKpis } from "../lib/accounting/kpis.ts";
import {
  postServicePurchaseCompleted,
  postWalletTopUpSucceeded,
} from "../lib/accounting/posting.ts";

const databaseUrl = process.env.DATABASE_URL;
const db =
  process.env.ABRCHIN_ISOLATED_TEST === "1" && databaseUrl
    ? new PrismaClient()
    : null;

async function sumDebitCredit(entryId: string) {
  const lines = await db!.accountingJournalLine.findMany({
    where: { journalEntryId: entryId },
  });
  return {
    debit: lines.reduce((s, l) => s + l.debitRial, 0n),
    credit: lines.reduce((s, l) => s + l.creditRial, 0n),
    lines,
  };
}

test("balanced journal entry + debit equals credit", async (t) => {
  if (!db) {
    t.skip("requires isolated PostgreSQL");
    return;
  }
  const entry = await postJournalEntry({
    eventType: "test_balanced",
    referenceType: "test",
    referenceId: `bal-${Date.now()}`,
    idempotencyKey: `test-balanced:${Date.now()}`,
    occurredAt: new Date(),
    lines: [
      { accountCode: "CASH_GATEWAY", debitRial: 10_000n, creditRial: 0n },
      {
        accountCode: "CUSTOMER_WALLET_LIABILITY",
        debitRial: 0n,
        creditRial: 10_000n,
      },
    ],
  });
  const totals = await sumDebitCredit(entry.id);
  assert.equal(totals.debit, totals.credit);
  assert.equal(totals.debit, 10_000n);
});

test("wallet top-up is liability; retry does not duplicate", async (t) => {
  if (!db) {
    t.skip("requires isolated PostgreSQL");
    return;
  }
  const id = `topup-${Date.now()}`;
  const payload = {
    id,
    amount: 250_000n,
    verifiedAt: new Date(),
    createdAt: new Date(),
  };
  const first = await postWalletTopUpSucceeded(payload);
  const second = await postWalletTopUpSucceeded(payload);
  assert.equal(first.id, second.id);
  const lines = await db.accountingJournalLine.findMany({
    where: { journalEntryId: first.id },
  });
  assert.ok(lines.some((l) => l.accountCode === "CASH_GATEWAY" && l.debitRial > 0n));
  assert.ok(
    lines.some(
      (l) =>
        l.accountCode === "CUSTOMER_WALLET_LIABILITY" && l.creditRial > 0n,
    ),
  );
  assert.ok(!lines.some((l) => l.accountCode === "INFRASTRUCTURE_REVENUE"));
  const totals = await sumDebitCredit(first.id);
  assert.equal(totals.debit, totals.credit);
});

test("service purchase posts sale splits, tax liability, COGS; retry safe", async (t) => {
  if (!db) {
    t.skip("requires isolated PostgreSQL");
    return;
  }
  const suffix = Date.now().toString(36);
  const user = await db.user.create({
    data: {
      mobile: `0912${suffix.slice(-7).padStart(7, "0")}`,
      role: UserRole.CUSTOMER,
    },
  });
  // 500k + 350k + 100k + 50k + 95k tax = 1_095_000
  const order = await db.serviceOrder.create({
    data: {
      userId: user.id,
      title: "Test server",
      amount: 1_095_000n,
      termMonths: 1,
      status: "PAID",
      paidAt: new Date(),
      currency: "IRR",
      provider: "ARVAN",
      productKind: "CLOUD_SERVER",
      parchinLevel: "PARCHIN_START",
      planSnapshot: {
        providerBasePriceRialSnapshot: "500000",
        markupAmountRialSnapshot: "350000",
        parchinPriceRialSnapshot: "100000",
        taxAmountRialSnapshot: "95000",
        termMonths: 1,
        lineItemsSnapshot: [
          { type: "PROVIDER_INFRASTRUCTURE", amountIrr: "500000", label: "infra" },
          { type: "INFRASTRUCTURE_MARKUP", amountIrr: "350000", label: "markup" },
          { type: "PARCHIN", amountIrr: "100000", label: "parchin" },
          { type: "PROVIDER_ADDON", amountIrr: "50000", label: "addon" },
          { type: "TAX", amountIrr: "95000", label: "tax" },
        ],
      },
    },
  });
  const posted = await postServicePurchaseCompleted(order);
  const again = await postServicePurchaseCompleted(order);
  assert.equal(posted.id, again.id);
  const lines = await db.accountingJournalLine.findMany({
    where: { journalEntryId: posted.id },
  });
  const codes = new Set(lines.map((l) => l.accountCode));
  assert.ok(codes.has("INFRASTRUCTURE_REVENUE"));
  assert.ok(codes.has("PARCHIN_REVENUE"));
  assert.ok(codes.has("ADDON_REVENUE"));
  assert.ok(codes.has("TAX_PAYABLE"));
  assert.ok(codes.has("PROVIDER_INFRASTRUCTURE_COGS"));
  assert.equal(posted.quality, AccountingQuality.FINAL);
  const totals = await sumDebitCredit(posted.id);
  assert.equal(totals.debit, totals.credit);
});

test("draft expense excluded; posted included; reversal works", async (t) => {
  if (!db) {
    t.skip("requires isolated PostgreSQL");
    return;
  }
  const suffix = Date.now().toString(36);
  const adminMobile = `0913${suffix.slice(-7).padStart(7, "0")}`;
  const restoreAllowlist = allowAdminMobile(adminMobile);
  t.after(restoreAllowlist);
  const admin = await db.user.create({
    data: {
      mobile: adminMobile,
      role: UserRole.ADMIN,
    },
  });
  const expenseDate = new Date();
  const draft = await createDraftExpense({
    date: expenseDate,
    amountRial: 80_000n,
    category: OperatingExpenseCategory.HOSTING_OPERATIONS,
    title: "Hosting bill",
    description: "test",
    actorUserId: admin.id,
    idempotencyKey: `opex-create-${suffix}`,
  });
  const draftReplay = await createDraftExpense({
    date: expenseDate,
    amountRial: 80_000n,
    category: OperatingExpenseCategory.HOSTING_OPERATIONS,
    title: "Hosting bill",
    description: "test",
    actorUserId: admin.id,
    idempotencyKey: `opex-create-${suffix}`,
  });
  assert.equal(draft.id, draftReplay.id);
  assert.equal(draft.status, "DRAFT");
  const beforePost = await computeAccountingKpis({
    from: new Date(Date.now() - 86_400_000),
    to: new Date(Date.now() + 86_400_000),
    view: "booked",
  });
  const posted = await postExpense({
    expenseId: draft.id,
    actorUserId: admin.id,
  });
  assert.equal(posted.status, "POSTED");
  const afterPost = await computeAccountingKpis({
    from: new Date(Date.now() - 86_400_000),
    to: new Date(Date.now() + 86_400_000),
    view: "booked",
  });
  assert.ok(afterPost.operatingExpenseRial >= beforePost.operatingExpenseRial + 80_000n);
  const reversed = await reverseExpense({
    expenseId: draft.id,
    actorUserId: admin.id,
    reason: "correction",
  });
  assert.equal(reversed.status, "REVERSED");
});

test("missing provider cost → NEEDS_RECONCILIATION", async (t) => {
  if (!db) {
    t.skip("requires isolated PostgreSQL");
    return;
  }
  const suffix = Date.now().toString(36);
  const user = await db.user.create({
    data: {
      mobile: `0914${suffix.slice(-7).padStart(7, "0")}`,
      role: UserRole.CUSTOMER,
    },
  });
  const order = await db.serviceOrder.create({
    data: {
      userId: user.id,
      title: "Missing cost",
      amount: 100_000n,
      termMonths: 1,
      status: "PAID",
      paidAt: new Date(),
      currency: "IRR",
      planSnapshot: {
        lineItemsSnapshot: [
          { type: "INFRASTRUCTURE_MARKUP", amountIrr: "100000", label: "m" },
        ],
      },
    },
  });
  const posted = await postServicePurchaseCompleted(order);
  assert.equal(posted.quality, AccountingQuality.NEEDS_RECONCILIATION);
  const { buildOrderProfitabilityRows } = await import(
    "../lib/accounting/reports.ts"
  );
  const rows = await buildOrderProfitabilityRows({
    orderStatus: "PAID" as never,
  });
  const row = rows.find((item) => item.orderId === order.id);
  assert.ok(row);
  assert.equal(row!.missingProviderCost || row!.quality === "NEEDS_RECONCILIATION", true);
  assert.equal(row!.grossProfitRial, null);
  assert.equal(row!.effectiveMarginBps, null);
});

test("backfill idempotency", async (t) => {
  if (!db) {
    t.skip("requires isolated PostgreSQL");
    return;
  }
  const first = await runAccountingBackfill({ dryRun: false });
  const second = await runAccountingBackfill({ dryRun: false });
  assert.ok(Array.isArray(first.errors));
  assert.ok(Array.isArray(second.errors));
  assert.equal(second.errors.length, 0);
});

test("compiled accounting backfill dry-run works without test-resolve-hook", async (t) => {
  if (!db || !databaseUrl) {
    t.skip("requires isolated PostgreSQL");
    return;
  }
  const { existsSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  const { resolve } = await import("node:path");
  const artifact = resolve("dist/accounting/accounting-backfill.js");
  if (!existsSync(artifact)) {
    t.skip("accounting backfill artifact not built yet");
    return;
  }

  const beforeJournals = await db.accountingJournalEntry.count();
  const result = spawnSync(process.execPath, [artifact, "--dry-run"], {
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
    maxBuffer: 5 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    result.stderr || result.stdout || "compiled backfill failed",
  );
  const payload = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(payload.ok, true);
  assert.equal(payload.dryRun, true);
  assert.equal(typeof payload.recordsScanned, "number");
  assert.equal(typeof payload.entriesToCreate, "number");
  assert.equal(typeof payload.alreadyPosted, "number");
  assert.equal(typeof payload.needsReconciliation, "number");
  assert.equal(typeof payload.errorCount, "number");
  assert.ok(Array.isArray(payload.errors));
  const afterJournals = await db.accountingJournalEntry.count();
  assert.equal(
    afterJournals,
    beforeJournals,
    "dry-run must create zero journal entries",
  );
});
