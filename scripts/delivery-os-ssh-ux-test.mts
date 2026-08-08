import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  customerImageLabelFromCode,
  generateCustomerServerName,
  isCustomerSshSelfServeEnabled,
  isValidCustomerServerName,
  normalizeCustomerImageIdentity,
} from "../lib/infrastructure/image-identity.ts";

test("normalizes full OS display names and never returns naked versions", () => {
  const ubuntuVersionOnly = normalizeCustomerImageIdentity({
    name: "26.04",
    externalId: "img-2604",
    rawPayload: {
      distribution_name: "Ubuntu",
      ssh_key: true,
      ssh_password: true,
    },
  });
  assert.equal(ubuntuVersionOnly.displayName, "Ubuntu 26.04 LTS");
  assert.equal(ubuntuVersionOnly.distribution, "Ubuntu");
  assert.equal(ubuntuVersionOnly.version, "26.04");
  assert.doesNotMatch(ubuntuVersionOnly.displayName, /^26\.04$/);

  const ubuntuKnown = normalizeCustomerImageIdentity({
    name: "ubuntu24-cloudinit-qcow2",
    externalId: "ubuntu24-cloudinit-qcow2",
  });
  assert.equal(ubuntuKnown.displayName, "Ubuntu 24.04 LTS");

  const debian = normalizeCustomerImageIdentity({
    name: "Debian 13",
    externalId: "debian13",
    rawPayload: { distribution: "Debian", version: "13" },
  });
  assert.equal(debian.displayName, "Debian 13");

  const rocky = normalizeCustomerImageIdentity({
    name: "9",
    externalId: "rocky-9",
    rawPayload: { distribution_name: "Rocky Linux" },
  });
  assert.equal(rocky.displayName, "Rocky Linux 9");

  const nestedMetadata = normalizeCustomerImageIdentity({
    name: "Ubuntu",
    externalId: "provider-image-uuid",
    rawPayload: {
      metadata: {
        operating_system: "Ubuntu",
        operating_system_version: "24.04",
      },
    },
  });
  assert.equal(nestedMetadata.displayName, "Ubuntu 24.04 LTS");

  assert.equal(
    customerImageLabelFromCode("ubuntu22-cloudinit-qcow2"),
    "Ubuntu 22.04 LTS",
  );
  assert.doesNotMatch(
    customerImageLabelFromCode("ubuntu24-cloudinit-qcow2"),
    /^\d+(\.\d+)?$/,
  );
});

test("access method stays internal and SSH self-serve is disabled", async () => {
  assert.equal(isCustomerSshSelfServeEnabled(), false);

  const quoteService = await readFile(
    "lib/recommendation/quote-service.ts",
    "utf8",
  );
  const delivery = await readFile(
    "lib/recommendation/delivery-service.ts",
    "utf8",
  );
  const button = await readFile(
    "components/ready-server-quote-button.tsx",
    "utf8",
  );
  const conversation = await readFile(
    "components/conversation-builder.tsx",
    "utf8",
  );
  const labels = await readFile("lib/labels/customer.ts", "utf8");

  assert.match(quoteService, /defaultAccessMethod/);
  assert.match(quoteService, /ONE_TIME_PASSWORD/);
  assert.match(quoteService, /isCustomerSshSelfServeEnabled/);
  assert.match(
    quoteService,
    /انتخاب کلید SSH فعلاً برای خرید مستقیم در دسترس نیست/,
  );
  assert.match(delivery, /sshSelectable: false/);
  assert.match(delivery, /isCustomerSshSelfServeEnabled/);
  assert.doesNotMatch(button, /رمز عبور امن/);
  assert.doesNotMatch(button, /تنظیمات پیشرفته/);
  assert.doesNotMatch(button, /دسترسی/);
  assert.doesNotMatch(button, /نام کلید SSH ثبت‌شده/);
  assert.match(conversation, /رمز عبور امن/);
  assert.doesNotMatch(conversation, /نام کلید SSH ثبت‌شده/);
  assert.match(labels, /رمز عبور امن/);
});

test("changing OS resets the hidden delivery method without an advanced UI", async () => {
  const button = await readFile(
    "components/ready-server-quote-button.tsx",
    "utf8",
  );
  const conversation = await readFile(
    "components/conversation-builder.tsx",
    "utf8",
  );

  assert.match(button, /function applyImageSelection/);
  assert.match(button, /setAccessMethod\(defaultAccessForImage\(image\)\)/);
  assert.doesNotMatch(button, /setShowAdvanced/);
  assert.match(conversation, /setAccessMethod\([\s\S]*ONE_TIME_PASSWORD/);
  assert.match(conversation, /setSelectedDeliveryPlanId\(planId\)/);
  assert.match(conversation, /نام سرور/);
  assert.doesNotMatch(conversation, /setSshKeyName/);
});

test("server name is auto-generated and validated", () => {
  const name = generateCustomerServerName(() => 1);
  assert.match(name, /^abrchin-[a-z0-9]{4}$/);
  assert.equal(isValidCustomerServerName(name), true);
  assert.equal(isValidCustomerServerName("a"), false);
  assert.equal(isValidCustomerServerName("-bad"), false);
  assert.equal(isValidCustomerServerName("shop-main"), true);
});

test("delivery options API only exposes compatible images with customer labels", async () => {
  const quoteService = await readFile(
    "lib/recommendation/quote-service.ts",
    "utf8",
  );
  const delivery = await readFile(
    "lib/recommendation/delivery-service.ts",
    "utf8",
  );

  assert.match(quoteService, /externalId: \{ in: compatible \}/);
  assert.match(quoteService, /catalog-code:/);
  assert.match(quoteService, /lockAdminFulfilledCatalogPlan/);
  assert.match(quoteService, /normalizeCustomerImageIdentity/);
  assert.match(quoteService, /displayName: identity\.displayName/);
  assert.match(delivery, /allowedCodes\.includes\(image\.externalId\)/);
  assert.doesNotMatch(delivery, /linuxFirst\.slice\(0, 12\)/);
  assert.match(delivery, /externalId: \{ in: compatibleCodes \}/);
  assert.match(delivery, /defaultServerName: generateCustomerServerName\(\)/);
  assert.match(delivery, /serverName,/);
});

test("backend still rejects forged SSH and invalid delivery combinations", async () => {
  const quoteService = await readFile(
    "lib/recommendation/quote-service.ts",
    "utf8",
  );
  const delivery = await readFile(
    "lib/recommendation/delivery-service.ts",
    "utf8",
  );
  const route = await readFile(
    "app/api/cloud-servers/quotes/route.ts",
    "utf8",
  );

  assert.match(quoteService, /accessMethod === "SSH_KEY"/);
  assert.match(quoteService, /!isCustomerSshSelfServeEnabled\(\)/);
  assert.match(quoteService, /delivery\.accessMethod !== expectedAccessMethod/);
  assert.match(delivery, /input\.accessMethod === "SSH_KEY"/);
  assert.match(delivery, /WINDOWS_PASSWORD/);
  assert.match(route, /ONE_TIME_PASSWORD", "SSH_KEY", "WINDOWS_PASSWORD"/);
  assert.match(
    quoteService,
    /generateCustomerServerName\(\)/,
  );
});
