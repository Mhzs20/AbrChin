import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("gateway order payment persists an immutable, additive payment record", async () => {
  const [schema, migration] = await Promise.all([
    readFile("prisma/schema.prisma", "utf8"),
    readFile(
      "prisma/migrations/20260803130000_order_gateway_payments/migration.sql",
      "utf8",
    ),
  ]);

  assert.match(schema, /model OrderPayment/);
  assert.match(schema, /serviceOrderId\s+String\s+@unique/);
  assert.match(schema, /amount\s+BigInt/);
  assert.match(schema, /gatewayConfigSnapshot\s+Json\?/);
  assert.match(schema, /callbackTokenHash\s+String/);
  assert.match(migration, /CREATE TABLE "OrderPayment"/);
  assert.match(migration, /OrderPayment_serviceOrderId_key/);
  assert.doesNotMatch(migration, /\bDROP\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /DELETE FROM/i);
  assert.doesNotMatch(migration, /UPDATE "(?:ServiceOrder|Wallet|WalletLedgerEntry)"/);
});

test("callback settles the server-locked amount once and moves ambiguity to review", async () => {
  const payment = await readFile("lib/payments/order-payment.ts", "utf8");

  assert.match(payment, /expectedAmountRial:\s*payment\.amount/);
  assert.match(payment, /verified\.amountRial !== payment\.amount/);
  assert.match(payment, /prisma\.\$transaction/);
  assert.match(payment, /status:\s*\{\s*in:\s*\[OrderPaymentStatus\.CREATED, OrderPaymentStatus\.PENDING\]/);
  assert.match(payment, /idempotencyKey:\s*`order_payment_credit_\$\{payment\.id\}`/);
  assert.match(payment, /executePayOrderWithWalletTx/);
  assert.match(payment, /OrderPaymentStatus\.REVIEW/);
  assert.doesNotMatch(payment, /input\.amount/);
  assert.doesNotMatch(payment, /createInstance/);
});

test("customer receives one gateway action and direct callback reaches the order result", async () => {
  const [checkout, callback, route, retiredWalletRoute] = await Promise.all([
    readFile("components/account/order-checkout-panel.tsx", "utf8"),
    readFile("lib/payments/callback-handler.ts", "utf8"),
    readFile("app/api/orders/[id]/payment/route.ts", "utf8"),
    readFile("app/api/orders/[id]/pay-with-wallet/route.ts", "utf8"),
  ]);

  assert.match(checkout, /\/api\/orders\/\$\{createBody\.order\.id\}\/payment/);
  assert.match(checkout, /Idempotency-Key/);
  assert.match(checkout, /window\.location\.assign\(payBody\.redirectUrl\)/);
  assert.doesNotMatch(checkout, /pay-with-wallet/);
  assert.doesNotMatch(checkout, /wallet\/topups/);
  assert.match(callback, /finalizeOrderPaymentFromCallback/);
  assert.match(callback, /\/account\/orders\/\$\{result\.order\.id\}/);
  assert.match(route, /createOrderPaymentIntent/);
  assert.doesNotMatch(route, /gateway.*body/i);
  assert.match(retiredWalletRoute, /, 410\)/);
  assert.doesNotMatch(retiredWalletRoute, /payOrderWithWallet/);
});

test("successful payment cannot provision, assign inventory, or expose credentials", async () => {
  const payment = await readFile("lib/orders/pay-order-tx.ts", "utf8");

  assert.match(payment, /status:\s*InfrastructureOrderStatus\.WAITING_ADMIN_FUNDING/);
  assert.match(payment, /title:\s*"سفارش منتظر تأیید ساخت"/);
  assert.doesNotMatch(payment, /provisioningJob\.create/);
  assert.doesNotMatch(payment, /cloudInstance\.create/);
  assert.doesNotMatch(payment, /assignReservedInventoryTx/);
  assert.doesNotMatch(payment, /transferInventoryCredentialToInstanceTx/);
  assert.doesNotMatch(payment, /to:\s*"PROVISIONING_SUBMITTED"/);
});
