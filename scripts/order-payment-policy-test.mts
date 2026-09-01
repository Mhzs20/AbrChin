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

test("direct order gateway payment is permanently disabled; legacy callback is read-only", async () => {
  const payment = await readFile("lib/payments/order-payment.ts", "utf8");

  assert.match(payment, /direct_order_payment_disabled/);
  assert.match(payment, /Promise<never>/);
  assert.doesNotMatch(payment, /prisma\.orderPayment\.create/);
  assert.doesNotMatch(payment, /executePayOrderWithWalletTx/);
  assert.doesNotMatch(payment, /verifyPayment/);
  assert.doesNotMatch(payment, /expectedAmountRial:\s*payment\.amount/);
  assert.match(payment, /Never verifies a gateway/);
  assert.match(payment, /prisma\.orderPayment\.findUnique/);
});

test("public checkout is wallet-only; legacy callback still reaches the order result", async () => {
  const [checkout, callback, route, walletRoute, panel] = await Promise.all([
    readFile("components/account/order-checkout-panel.tsx", "utf8"),
    readFile("lib/payments/callback-handler.ts", "utf8"),
    readFile("app/api/orders/[id]/payment/route.ts", "utf8"),
    readFile("app/api/orders/[id]/pay-with-wallet/route.ts", "utf8"),
    readFile("components/orders-panel.tsx", "utf8"),
  ]);

  assert.match(checkout, /Idempotency-Key/);
  // Founder wallet-first flow: top-up shortfall, return to the locked quote,
  // review, then explicit wallet submit — never a silent debit.
  assert.match(checkout, /\/api\/orders\/\$\{order\.id\}\/pay-with-wallet/);
  assert.match(checkout, /\/account\/wallet\/topup\?returnTo=/);
  assert.doesNotMatch(checkout, /wallet\/topups/);
  assert.doesNotMatch(checkout, /\/api\/orders\/\$\{order\.id\}\/payment/);
  assert.doesNotMatch(checkout, /window\.location\.assign\(/);
  assert.match(callback, /finalizeOrderPaymentFromCallback/);
  assert.match(callback, /\/account\/orders\/\$\{result\.order\.id\}/);
  assert.match(route, /createOrderPaymentIntent/);
  assert.match(route, /direct_order_payment_disabled/);
  assert.doesNotMatch(route, /gateway.*body/i);
  assert.doesNotMatch(route, /alreadyPaid/);
  assert.doesNotMatch(panel, /\/api\/orders\/\$\{orderId\}\/payment/);
  assert.doesNotMatch(panel, /window\.location\.assign\(/);
  // Wallet route reuses the shared audited debit path (idempotent ledger key)
  // and never talks to the gateway or provisions anything.
  assert.match(walletRoute, /payOrderWithWallet/);
  assert.match(walletRoute, /rejectCrossOrigin/);
  assert.match(walletRoute, /requireCurrentUser/);
  assert.doesNotMatch(walletRoute, /createOrderPaymentIntent/);
  assert.doesNotMatch(walletRoute, /redirectUrl/);
  assert.doesNotMatch(walletRoute, /provisioningJob|cloudInstance/);
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

test("direct order payment API never creates a gateway intent", async () => {
  const { createOrderPaymentIntent } = await import("../lib/payments/order-payment.ts");
  const { WalletError } = await import("../lib/wallet/errors.ts");
  await assert.rejects(
    () =>
      createOrderPaymentIntent({
        userId: "user_direct_pay",
        orderId: "order_direct_pay",
        idempotencyKey: "direct-order-payment-disabled-key",
      }),
    (error: unknown) =>
      error instanceof WalletError && error.code === "direct_order_payment_disabled",
  );
});
