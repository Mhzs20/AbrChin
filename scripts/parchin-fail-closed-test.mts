import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isParchinConfigSellable } from "../lib/parchin/sellable.ts";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Parchin sale requires active config plus operational evidence", () => {
  const previous = process.env.ABRCHIN_ISOLATED_TEST;
  delete process.env.ABRCHIN_ISOLATED_TEST;
  try {
    assert.equal(
      isParchinConfigSellable(
        { active: true, operationalEvidenceApprovedAt: null },
        { allowTestBypass: false },
      ),
      false,
    );
    assert.equal(
      isParchinConfigSellable({
        active: true,
        operationalEvidenceApprovedAt: new Date(),
      }),
      true,
    );
    assert.equal(
      isParchinConfigSellable({ active: false, operationalEvidenceApprovedAt: new Date() }),
      false,
    );
    process.env.ABRCHIN_ISOLATED_TEST = "1";
    assert.equal(
      isParchinConfigSellable({ active: true, operationalEvidenceApprovedAt: null }),
      true,
    );
    delete process.env.ABRCHIN_ISOLATED_TEST;
    assert.equal(
      isParchinConfigSellable(
        { active: true, operationalEvidenceApprovedAt: null },
        { allowTestBypass: false },
      ),
      false,
    );
  } finally {
    if (previous === undefined) delete process.env.ABRCHIN_ISOLATED_TEST;
    else process.env.ABRCHIN_ISOLATED_TEST = previous;
  }
});

test("public Parchin surfaces fail closed on database errors and missing evidence", async () => {
  const page = await source("app/support/page.tsx");
  const availability = await source("lib/parchin/availability.ts");
  const selector = await source("components/support-selector.tsx");
  const pay = await source("lib/orders/pay-order-tx.ts");
  const orders = await source("lib/orders/service.ts");
  assert.match(page, /loadPublicParchinCatalog/);
  assert.doesNotMatch(page, /\.catch\(\s*\(\)\s*=>\s*\[\]/);
  assert.doesNotMatch(page, /monthlyPriceRial: "0"/);
  assert.match(availability, /database_failure/);
  assert.match(availability, /pendingCard/);
  assert.match(selector, /is-unavailable/);
  assert.match(selector, /برای فروش عمومی آماده نیست/);
  assert.match(pay, /isParchinConfigSellable/);
  assert.match(orders, /isParchinConfigSellable/);
  assert.doesNotMatch(selector, /active: true/);
});
