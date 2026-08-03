import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalCustomerPurchasePath,
  safeCustomerReturnPath,
} from "../lib/customer/navigation.ts";

test("legacy account order route has one canonical configurator destination", () => {
  assert.equal(
    canonicalCustomerPurchasePath("/account/order"),
    "/cloud-servers",
  );
  assert.equal(
    canonicalCustomerPurchasePath("/cloud-servers"),
    "/cloud-servers",
  );
});

test("wallet resume accepts local activation routes and rejects redirect injection", () => {
  assert.equal(
    safeCustomerReturnPath("/cloud-servers/quote/quote-1"),
    "/cloud-servers/quote/quote-1",
  );
  assert.equal(safeCustomerReturnPath("//evil.example"), null);
  assert.equal(safeCustomerReturnPath("https://evil.example"), null);
  assert.equal(safeCustomerReturnPath("/\\evil"), null);
});
