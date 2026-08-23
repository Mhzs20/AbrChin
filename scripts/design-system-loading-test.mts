/**
 * Guards the public routes against losing part of the design system.
 *
 * Regression: product.css was imported only by the admin and account layouts,
 * but public routes render the same components. The purchase CTA fell back to
 * the browser's default grey button and the parchin option cards lost their
 * grid, because no stylesheet on those pages defined their classes.
 */

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const ROOT_LAYOUT = "app/layout.tsx";

async function appStylesheets(): Promise<string[]> {
  const entries = await readdir("app", { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
    .map((entry) => entry.name)
    .sort();
}

test("the root layout loads every app-level stylesheet", async () => {
  const [layout, sheets] = await Promise.all([
    readFile(ROOT_LAYOUT, "utf8"),
    appStylesheets(),
  ]);

  assert.ok(sheets.length > 0, "expected at least one stylesheet in app/");
  for (const sheet of sheets) {
    assert.ok(
      layout.includes(`import "./${sheet}";`),
      `${ROOT_LAYOUT} must import ./${sheet} — a stylesheet loaded only by a nested layout leaves public routes unstyled`,
    );
  }
});

test("no nested layout re-imports an app-level stylesheet", async () => {
  const nested = ["app/admin/layout.tsx", "app/account/layout.tsx"];
  const sources = await Promise.all(
    nested.map(async (file) => [file, await readFile(file, "utf8")] as const),
  );

  for (const [file, source] of sources) {
    assert.doesNotMatch(
      source,
      /import\s+"\.\.\/[a-z0-9-]+\.css"/,
      `${file} must not import an app-level stylesheet — the root layout owns them, one import site only`,
    );
  }
});

test("classes used on public purchase pages have a rule in a loaded stylesheet", async () => {
  const [layout, configure, quoteButton, checkout] = await Promise.all([
    readFile(ROOT_LAYOUT, "utf8"),
    readFile("app/cloud-servers/configure/[planId]/page.tsx", "utf8"),
    readFile("components/ready-server-quote-button.tsx", "utf8"),
    readFile("components/account/order-checkout-panel.tsx", "utf8"),
  ]);

  const imported = [...layout.matchAll(/import\s+"\.\/([a-z0-9-]+\.css)";/g)].map(
    (match) => match[1],
  );
  const css = (
    await Promise.all(imported.map((sheet) => readFile(`app/${sheet}`, "utf8")))
  ).join("\n");

  // The exact classes that rendered unstyled in production.
  const required = [
    ["server-order-parchin-options", quoteButton],
    ["product-btn--primary", checkout],
    ["product-btn--quiet", configure],
    ["order-checkout", checkout],
  ] as const;

  for (const [className, source] of required) {
    assert.ok(
      source.includes(className),
      `expected ${className} to still be used by the public purchase flow`,
    );
    assert.ok(
      css.includes(`.${className}`),
      `.${className} is used on a public route but no stylesheet the root layout imports defines it`,
    );
  }
});

test("the topbar auth link never loses both its label and its icon", async () => {
  const [css, link] = await Promise.all([
    readFile("app/globals.css", "utf8"),
    readFile("components/auth-nav-link.tsx", "utf8"),
  ]);

  // The control carries both class families, so a rule written for either one
  // lands on it.
  assert.match(link, /button-compact[^"]*auth-nav-link/);
  assert.match(link, /<UserRound/);

  // Below 860px the label is hidden and the control is icon-only…
  assert.match(css, /\.auth-nav-link span \{\s*display: none;/);

  // …so no rule may hide that icon. The compact-button icon rule hid it at
  // 980px, which left an empty 40px box in the mobile topbar.
  assert.doesNotMatch(
    css,
    /\.button-compact svg\s*\{[^}]*display:\s*none/,
    "a bare .button-compact svg rule also hides the icon-only auth link",
  );
  assert.match(css, /\.button-compact:not\(\.auth-nav-link\) svg\s*\{[^}]*display:\s*none/);
});
