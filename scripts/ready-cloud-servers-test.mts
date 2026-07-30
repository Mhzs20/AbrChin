import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isReadyServerPlanCode,
  readyServerPlanCode,
  selectReadyServerImage,
} from "../lib/cloud-servers/catalog.ts";
import { buildCatalogItems } from "../lib/infrastructure/catalog-service.ts";

test("ready-server codes are deterministic per Region and Size", () => {
  const first = readyServerPlanCode("tehran11", "irLinuxVPS4");
  assert.equal(first, "READY_PARSPACK_TEHRAN11_IRLINUXVPS4");
  assert.equal(first, readyServerPlanCode("tehran11", "irLinuxVPS4"));
  assert.notEqual(first, readyServerPlanCode("tehran3", "irLinuxVPS4"));
  assert.equal(isReadyServerPlanCode(first), true);
});

test("ready servers choose a controlled Linux image and exclude control panels", () => {
  assert.equal(
    selectReadyServerImage([
      "windows2025-qcow2",
      "debian13-cloudinit-qcow2",
      "ubuntu24-cloudinit-qcow2",
    ]),
    "ubuntu24-cloudinit-qcow2",
  );
  assert.equal(
    selectReadyServerImage(["windows2025-qcow2", "mikrotik7-qcow2", "cp-cpanel"]),
    null,
  );
});

test("one shared cloud size becomes one sellable item per compatible region", () => {
  const items = buildCatalogItems({
    priceContract: {
      currencyCode: "IRR",
      amountUnit: "TOMAN",
      confirmed: true,
    },
    regions: [
      { code: "tehran2", name: "Tehran 2", available: true, sizeCodes: ["shared"] },
      { code: "tehran3", name: "Tehran 3", available: true, sizeCodes: ["shared"] },
      { code: "tehran11", name: "Tehran 11", available: true, sizeCodes: ["shared"] },
    ],
    sizes: [
      {
        code: "shared",
        name: "Cloud",
        available: true,
        vcpu: 2,
        memoryMb: 4096,
        diskGb: 50,
        priceHourly: "100",
        priceMonthly: "500000",
      },
    ],
    images: [
      {
        code: "ubuntu24-cloudinit-qcow2",
        name: "Ubuntu",
        status: "available",
      },
    ],
  });
  assert.deepEqual(
    items.map((item) => item.regionCode).sort(),
    ["tehran11", "tehran2", "tehran3"],
  );
  assert.equal(items.every((item) => item.available), true);
});

test("ready-server pricing never creates a VM or performs a payment", async () => {
  const [catalog, plans, quoteRoute, quoteService] = await Promise.all([
    readFile("lib/infrastructure/catalog-service.ts", "utf8"),
    readFile("lib/orders/plans.ts", "utf8"),
    readFile("app/api/cloud-servers/quotes/route.ts", "utf8"),
    readFile("lib/recommendation/quote-service.ts", "utf8"),
  ]);
  const source = `${catalog}\n${plans}\n${quoteRoute}\n${quoteService}`;
  assert.doesNotMatch(source, /\.createInstance\(/);
  assert.doesNotMatch(source, /payOrderWithWallet/);
  assert.match(catalog, /materializeReadyServerPlans/);
  assert.match(catalog, /DeliveryMode\.MANAGED/);
  assert.match(catalog, /parchinIncluded: true/);
});
