import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

test("public and product shells expose one canonical main target and skip link", async () => {
  const [layout, publicShell, productShell, productCss] = await Promise.all([
    source("app/layout.tsx"),
    source("components/site-shell.tsx"),
    source("components/product/index.tsx"),
    source("app/product.css"),
  ]);
  assert.match(layout, /<html lang="fa" dir="rtl">/);
  for (const shell of [publicShell, productShell]) {
    assert.match(shell, /href="#main-content"/);
    assert.match(shell, /id="main-content"/);
    assert.match(shell, /<main/);
  }
  assert.match(productCss, /\.product-skip-link:focus-visible/);
  assert.match(productCss, /outline:/);
});

test("critical forms keep explicit labels, errors and non-hidden advanced access", async () => {
  const [configurator, supportForm, login, productComponents] = await Promise.all([
    source("components/ready-server-quote-button.tsx"),
    source("components/account/support-request-create-form.tsx"),
    source("components/login-form.tsx"),
    source("components/product/index.tsx"),
  ]);
  assert.match(configurator, /<label>/);
  assert.match(configurator, /aria-invalid=/);
  assert.match(configurator, /role="alert"/);
  assert.match(supportForm, /FormField id="support-category"/);
  assert.match(supportForm, /FormField id="support-subject"/);
  assert.match(supportForm, /FormField id="support-description"/);
  assert.match(supportForm, /role="alert"/);
  assert.match(productComponents, /<label htmlFor=\{id\}>/);
  assert.match(login, /autocomplete|autoComplete/);
  assert.doesNotMatch(configurator, /SSH_KEY[^\n]*checked/);
});
