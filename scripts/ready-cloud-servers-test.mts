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
  assert.equal(first, "READY_SERVER_TEHRAN11_IRLINUXVPS4");
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

test("provider catalog sync never creates, publishes, or purchases a server SKU", async () => {
  const [catalog, plans, quoteRoute, quoteService] = await Promise.all([
    readFile("lib/infrastructure/catalog-service.ts", "utf8"),
    readFile("lib/orders/plans.ts", "utf8"),
    readFile("app/api/cloud-servers/quotes/route.ts", "utf8"),
    readFile("lib/recommendation/quote-service.ts", "utf8"),
  ]);
  const source = `${catalog}\n${plans}\n${quoteRoute}\n${quoteService}`;
  assert.doesNotMatch(source, /\.createInstance\(/);
  assert.doesNotMatch(source, /payOrderWithWallet/);
  assert.doesNotMatch(catalog, /materializeReadyServerPlans/);
  assert.doesNotMatch(catalog, /infrastructurePlan\.upsert/);
  assert.doesNotMatch(catalog, /publicationStatus:\s*[\s\S]{0,60}PUBLISHED/);
});

test("ready catalog supports Arvan fixed offers and manual Admin delivery", async () => {
  const [routing, plans, payment, delivery] = await Promise.all([
    readFile("lib/infrastructure/provider-routing.ts", "utf8"),
    readFile("lib/orders/plans.ts", "utf8"),
    readFile("lib/orders/pay-order-tx.ts", "utf8"),
    readFile("lib/infrastructure/manual-ready-delivery.ts", "utf8"),
  ]);
  // Both product kinds route to Arvan now that it is the only provider, and
  // the module refuses anything else — the ready-server branch that used to
  // allow a second provider is gone.
  assert.match(routing, /InfrastructureProvider\.ARVAN/);
  assert.match(routing, /resolvedProvider !== InfrastructureProvider\.ARVAN/);
  assert.match(routing, /provider_route_mismatch/);
  assert.match(plans, /offerSource === "MANUAL_ADMIN"/);
  assert.match(payment, /manualAvailableUnits: \{ decrement: 1 \}/);
  assert.match(delivery, /operation: "MANUAL_PROVISION"/);
  assert.match(delivery, /operation: "APPROVE_PROVISION"/);
  assert.match(delivery, /WAITING_ADMIN_DELIVERY_APPROVAL/);
  assert.match(delivery, /ONE_TIME_ENCRYPTED_CREDENTIAL/);
  assert.doesNotMatch(delivery, /createServer|createInstance/);
});
