import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  deriveDisplayName,
  normalizeEmail,
  validatePersonName,
} from "../lib/identity/names.ts";

test("normalizeEmail trims and lowercases", () => {
  const ok = normalizeEmail("  Alex@Example.COM ");
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.email, "alex@example.com");
});

test("normalizeEmail rejects invalid formats", () => {
  assert.equal(normalizeEmail("").ok, false);
  assert.equal(normalizeEmail("not-an-email").ok, false);
  assert.equal(normalizeEmail("@x.com").ok, false);
});

test("validatePersonName accepts Persian and Latin names", () => {
  assert.equal(validatePersonName("علی", "نام").ok, true);
  assert.equal(validatePersonName("Reza", "نام").ok, true);
  assert.equal(validatePersonName("  مریم  ", "نام").ok, true);
  assert.equal(validatePersonName("", "نام").ok, false);
  assert.equal(validatePersonName("   ", "نام خانوادگی").ok, false);
  assert.equal(validatePersonName("A", "نام").ok, true);
});

test("deriveDisplayName joins first and last", () => {
  assert.equal(deriveDisplayName("علی", "محمدی"), "علی محمدی");
});

test("customer money surfaces use product-money not product-tech", async () => {
  const shell = await readFile("components/product/customer-shell.tsx", "utf8");
  assert.match(shell, /product-money/);
  assert.match(shell, /formatTomanFa\(BigInt\(walletBalanceRial\)\)/);
  assert.ok(!shell.includes('className="product-tech">{formatTomanFa'));

  const moneyDisplay = await readFile("components/product/index.tsx", "utf8");
  const moneyFn = moneyDisplay.slice(
    moneyDisplay.indexOf("export function MoneyDisplay"),
    moneyDisplay.indexOf("export function TechnicalValue"),
  );
  assert.match(moneyFn, /product-money/);
  assert.doesNotMatch(moneyFn, /product-tech/);

  const productCss = await readFile("app/product.css", "utf8");
  assert.match(productCss, /\.product-money\s*\{/);
  assert.match(productCss, /Mikhak/);
  const moneyCss = productCss.slice(
    productCss.indexOf(".product-money"),
    productCss.indexOf(".product-money") + 200,
  );
  assert.doesNotMatch(moneyCss, /monospace/);

  const moneyTs = await readFile("lib/money.ts", "utf8");
  assert.match(moneyTs, /toLocaleString\("fa-IR"\)/);

  for (const path of [
    "components/account/order-checkout-panel.tsx",
    "components/account/service-cancel-panel.tsx",
    "components/account/service-upgrade-panels.tsx",
    "components/wallet-panel.tsx",
    "components/transactions-panel.tsx",
  ]) {
    const source = await readFile(path, "utf8");
    assert.ok(
      !/className="product-tech"[^>]*>[\s\S]{0,40}formatTomanFa/.test(source),
      `${path} must not wrap money in product-tech`,
    );
  }

  // Technical identifiers may still use product-tech (mobile / IP / IDs).
  const profile = await readFile("components/account/profile-panel.tsx", "utf8");
  assert.match(profile, /product-tech/);
  assert.match(profile, /user\.mobile/);
});

test("checkout quote page splits money out of product-tech badges", async () => {
  const quotePage = await readFile(
    "app/account/order/quote/[id]/page.tsx",
    "utf8",
  );
  assert.match(quotePage, /product-money/);
  assert.match(quotePage, /formatTomanFa\(quoteRecord\.amountRial\)/);
  assert.ok(
    !/className="product-tech">\s*\{quote\.termMonths[\s\S]{0,80}formatTomanFa/.test(
      quotePage,
    ),
  );
});
