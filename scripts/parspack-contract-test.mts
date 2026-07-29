import assert from "node:assert/strict";
import test from "node:test";

import { InfrastructureError } from "../lib/infrastructure/errors.ts";
import { ParsPackProvider } from "../lib/infrastructure/parspack/client.ts";
import {
  mapProviderHttpError,
  parseParsPackImages,
  parseParsPackNextPage,
  parseParsPackRegions,
  parseParsPackSizes,
  parseParsPackVm,
  parseVmList,
  sanitizeProviderResponse,
} from "../lib/infrastructure/parspack/mapper.ts";

const vmFixture = {
  id: "101",
  name: "abrchin-testvm01",
  region: { slug: "tehran11", name: "Tehran" },
  size: {
    slug: "irLinuxVPS4",
    memory: 4096,
    vcpus: 2,
  },
  image: { slug: "ubuntu24-cloudinit-qcow2", name: "Ubuntu 24.04" },
  status: "active",
  networks: {
    v4: [
      { type: "private", ip_address: "10.0.0.4" },
      { type: "public", ip_address: "185.1.1.1" },
    ],
  },
};

test("parses ParsPack VM envelopes and nested resource fields", () => {
  const single = parseParsPackVm({ vm: vmFixture });
  assert.deepEqual(single, {
    id: "101",
    name: "abrchin-testvm01",
    region: "tehran11",
    size: "irLinuxVPS4",
    image: "ubuntu24-cloudinit-qcow2",
    status: "active",
    ipv4: "185.1.1.1",
  });

  const list = parseVmList({ vms: [vmFixture] });
  assert.equal(list.length, 1);
  assert.equal(list[0]?.name, "abrchin-testvm01");
});

test("parses regions, sizes, images, live prices, and availability", () => {
  const regions = parseParsPackRegions({
    regions: [
      {
        slug: "tehran11",
        name: "Tehran",
        available: true,
        sizes: ["irLinuxVPS4"],
        features: ["backups"],
      },
    ],
  });
  const sizes = parseParsPackSizes({
    sizes: [
      {
        slug: "irLinuxVPS4",
        description: "2 vCPU / 4 GB",
        memory: 4096,
        vcpus: 2,
        disk: 50,
        price_hourly: 1200,
        price_monthly: "864000.00",
        regions: ["tehran11"],
        available: true,
        transfer: 1000,
      },
    ],
  });
  const images = parseParsPackImages({
    images: [
      {
        id: 24,
        slug: "ubuntu24-cloudinit-qcow2",
        name: "Ubuntu 24.04",
        distribution: "Ubuntu",
        regions: ["tehran11"],
        min_disk_size: 20,
        status: "available",
      },
    ],
  });

  assert.equal(regions[0]?.code, "tehran11");
  assert.equal(regions[0]?.available, true);
  assert.deepEqual(regions[0]?.sizeCodes, ["irLinuxVPS4"]);
  assert.equal(sizes[0]?.vcpu, 2);
  assert.equal(sizes[0]?.memoryMb, 4096);
  assert.equal(sizes[0]?.priceHourly, "1200");
  assert.equal(sizes[0]?.priceMonthly, "864000");
  assert.equal(images[0]?.code, "ubuntu24-cloudinit-qcow2");
  assert.equal(images[0]?.osFamily, "Ubuntu");
  assert.equal(
    parseParsPackNextPage({
      links: { pages: { next: "https://example.invalid/resources?page=2&per_page=200" } },
    }),
    2,
  );
});

test("uses management V1 for create and public V1 for catalog/read operations", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.endsWith("/api/v1/vms")) {
      return new Response(JSON.stringify({ vm: vmFixture }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/regions")) {
      return Response.json({ regions: [{ slug: "tehran11", name: "Tehran" }] });
    }
    if (url.includes("/sizes")) {
      return Response.json({
        sizes: [{ slug: "irLinuxVPS4", regions: ["tehran11"], available: true }],
      });
    }
    if (url.includes("/images")) {
      return Response.json({
        images: [{ slug: "ubuntu24-cloudinit-qcow2", name: "Ubuntu 24.04" }],
      });
    }
    if (url.includes("/vms?")) {
      return Response.json({ vms: [vmFixture] });
    }
    if (url.endsWith("/vms/101")) {
      return Response.json({ vm: vmFixture });
    }
    return Response.json({ message: "not found" }, { status: 404 });
  };

  const provider = new ParsPackProvider({
    managementBaseUrl: "https://my.parspack.com/cserver/api/v1",
    publicBaseUrl: "https://my.parspack.com/cserver/api/public/v1",
    token: "contract-test-token",
    timeoutMs: 1000,
    fetchImpl,
    priceCurrencyCode: "IRR",
    priceAmountUnit: "TOMAN",
  });

  const created = await provider.createInstance({
    name: "abrchin-testvm01",
    region: "tehran11",
    size: "irLinuxVPS4",
    image: "ubuntu24-cloudinit-qcow2",
    deliveryMode: "RAW",
  });
  const catalog = await provider.syncCatalog();
  const fetched = await provider.getInstance("101");
  const found = await provider.findInstanceByName("abrchin-testvm01");

  assert.equal(created.id, "101");
  assert.equal(fetched.ipv4, "185.1.1.1");
  assert.equal(found?.id, "101");
  assert.equal(catalog.regions.length, 1);
  assert.equal(catalog.sizes.length, 1);
  assert.equal(catalog.images.length, 1);
  assert.deepEqual(catalog.priceContract, {
    currencyCode: "IRR",
    amountUnit: "TOMAN",
    confirmed: true,
  });

  const createCall = calls.find((call) => call.url.endsWith("/api/v1/vms"));
  assert.ok(createCall);
  assert.equal(createCall.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(createCall.init?.body)), {
    name: "abrchin-testvm01",
    region: "tehran11",
    size: "irLinuxVPS4",
    image: "ubuntu24-cloudinit-qcow2",
  });
  const headers = new Headers(createCall.init?.headers);
  assert.equal(headers.get("Authorization"), "Bearer contract-test-token");
  assert.equal(headers.get("Accept-Language"), "en");

  assert.ok(
    calls.some((call) =>
      call.url.startsWith(
        "https://my.parspack.com/cserver/api/public/v1/regions?page=1&per_page=200",
      ),
    ),
  );
  assert.ok(
    calls.some((call) =>
      call.url.includes(
        "/api/public/v1/vms?name=abrchin-testvm01&page=1&per_page=20",
      ),
    ),
  );
});

test("invalid VM payload becomes a provider_invalid_response error", async () => {
  const provider = new ParsPackProvider({
    managementBaseUrl: "https://my.parspack.com/cserver/api/v1",
    publicBaseUrl: "https://my.parspack.com/cserver/api/public/v1",
    token: "contract-test-token",
    timeoutMs: 1000,
    fetchImpl: async () => Response.json({ vm: { status: "new" } }, { status: 201 }),
  });

  await assert.rejects(
    () =>
      provider.createInstance({
        name: "abrchin-invalid",
        region: "tehran11",
        size: "irLinuxVPS4",
        image: "ubuntu24-cloudinit-qcow2",
        deliveryMode: "RAW",
      }),
    (error: unknown) =>
      error instanceof InfrastructureError && error.code === "provider_invalid_response",
  );
});

test("maps provider http errors without treating every 403 as balance", () => {
  assert.equal(mapProviderHttpError(400, { message: "insufficient balance" }), "provider_insufficient_balance");
  assert.equal(mapProviderHttpError(401), "provider_auth_failed");
  assert.equal(mapProviderHttpError(402), "provider_insufficient_balance");
  assert.equal(mapProviderHttpError(403), "provider_auth_failed");
  assert.equal(mapProviderHttpError(404), "provider_not_found");
  assert.equal(mapProviderHttpError(408), "provider_unavailable");
  assert.equal(mapProviderHttpError(422), "provider_invalid_response");
  assert.equal(mapProviderHttpError(429), "provider_unavailable");
  assert.equal(mapProviderHttpError(503), "provider_unavailable");
});

test("sanitized provider response excludes secrets", () => {
  const safe = sanitizeProviderResponse({
    vm: {
      id: "1",
      name: "vm",
      token: "secret-token",
      password: "secret",
      status: "active",
    },
  });
  assert.equal("token" in safe, false);
  assert.equal("password" in safe, false);
  assert.equal(safe.id, "1");
});
