import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { OtpPurpose, PrismaClient } from "@prisma/client";

import { hashWithSecret } from "../lib/crypto.ts";

const databaseUrl = process.env.DATABASE_URL;
const sessionSecret =
  process.env.SESSION_SECRET || "panel-e2e-session-secret-32chars";
const expectedAdminMobiles = ["09354327374", "09108387952"];
const customerMobile = "09129991122";
const otpCode = "654321";
const port = Number.parseInt(process.env.PANEL_E2E_PORT ?? "3410", 10);
const baseUrl = `http://127.0.0.1:${port}`;

function assertSafeTestDatabase(url: string) {
  const parsed = new URL(url);
  const databaseName = parsed.pathname.replace(/^\//, "").split("?")[0];
  const localHost = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  const isolated = process.env.ABRCHIN_ISOLATED_TEST === "1";
  if (!localHost || (!isolated && !/test/i.test(databaseName))) {
    throw new Error(
      "Panel E2E refuses to mutate a non-local or non-test PostgreSQL database.",
    );
  }
}

async function waitForServer(
  server: ChildProcessWithoutNullStreams,
  output: () => string,
) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Next server stopped before readiness.\n${output()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await delay(500);
  }
  throw new Error(`Next server did not become ready.\n${output()}`);
}

function sessionCookie(response: Response) {
  const raw = response.headers.get("set-cookie");
  assert.ok(raw, "verify-otp must set a session cookie");
  return raw.split(";", 1)[0];
}

test("panel role E2E: OTP, pages, APIs, and live session roles stay separated", async (t) => {
  if (!databaseUrl) {
    t.skip("DATABASE_URL not set — skipping panel role E2E");
    return;
  }

  assertSafeTestDatabase(databaseUrl);

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const testMobiles = [...expectedAdminMobiles, customerMobile];

  async function cleanup() {
    await prisma.otpChallenge.deleteMany({ where: { mobile: { in: testMobiles } } });
    await prisma.user.deleteMany({ where: { mobile: { in: testMobiles } } });
  }

  await cleanup();
  t.after(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  let serverOutput = "";
  const server = spawn(
    process.platform === "win32" ? "node_modules/.bin/next.cmd" : "node_modules/.bin/next",
    ["start", "-p", String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "development",
        DATABASE_URL: databaseUrl,
        SESSION_SECRET: sessionSecret,
        SMS_PROVIDER: "console",
        ADMIN_MOBILES: expectedAdminMobiles.join(","),
      },
      stdio: "pipe",
    },
  );
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  t.after(async () => {
    if (server.exitCode === null) {
      server.kill("SIGTERM");
      await Promise.race([once(server, "exit"), delay(10_000)]);
    }
  });

  await waitForServer(server, () => serverOutput);

  async function login(mobile: string) {
    await prisma.otpChallenge.create({
      data: {
        mobile,
        codeHash: hashWithSecret(otpCode, sessionSecret),
        purpose: OtpPurpose.LOGIN,
        expiresAt: new Date(Date.now() + 120_000),
      },
    });

    const response = await fetch(`${baseUrl}/api/auth/verify-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mobile, code: otpCode }),
      redirect: "manual",
    });
    if (response.status !== 200) {
      throw new Error(`verify-otp returned ${response.status}: ${await response.text()}`);
    }
    const payload = (await response.json()) as {
      user: { mobile: string; role: "ADMIN" | "CUSTOMER" };
    };
    return { cookie: sessionCookie(response), user: payload.user };
  }

  const firstAdmin = await login(expectedAdminMobiles[0]);
  const secondAdmin = await login(expectedAdminMobiles[1]);
  const customer = await login(customerMobile);

  assert.equal(firstAdmin.user.role, "ADMIN");
  assert.equal(secondAdmin.user.role, "ADMIN");
  assert.equal(customer.user.role, "CUSTOMER");

  // Incomplete registration must be gated away from /account.
  const incompleteAccount = await fetch(`${baseUrl}/account`, {
    headers: { cookie: customer.cookie },
    redirect: "manual",
  });
  assert.ok([303, 307, 308].includes(incompleteAccount.status));
  assert.equal(
    new URL(incompleteAccount.headers.get("location")!, baseUrl).pathname,
    "/register/complete",
  );

  await prisma.user.update({
    where: { mobile: customerMobile },
    data: {
      firstName: "مشتری",
      lastName: "آزمایشی",
      email: "panel-e2e-customer@example.com",
      displayName: "مشتری آزمایشی",
      registrationCompletedAt: new Date(),
    },
  });

  for (const admin of [firstAdmin, secondAdmin]) {
    const me = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie: admin.cookie },
    });
    assert.equal(me.status, 200);
    assert.equal(((await me.json()) as { user: { role: string } }).user.role, "ADMIN");

    const adminPage = await fetch(`${baseUrl}/admin`, {
      headers: { cookie: admin.cookie },
      redirect: "manual",
    });
    assert.equal(adminPage.status, 200);

    const accountPage = await fetch(`${baseUrl}/account`, {
      headers: { cookie: admin.cookie },
      redirect: "manual",
    });
    assert.ok([303, 307, 308].includes(accountPage.status));
    assert.equal(new URL(accountPage.headers.get("location")!, baseUrl).pathname, "/admin");
  }

  const customerAccount = await fetch(`${baseUrl}/account`, {
    headers: { cookie: customer.cookie },
    redirect: "manual",
  });
  assert.equal(customerAccount.status, 200);

  const customerAdmin = await fetch(`${baseUrl}/admin`, {
    headers: { cookie: customer.cookie },
    redirect: "manual",
  });
  assert.equal(customerAdmin.status, 200);
  assert.match(await customerAdmin.text(), /دسترسی به پنل مدیریت مجاز نیست/);

  const deniedAdminApi = await fetch(`${baseUrl}/api/admin/infrastructure/plans`, {
    headers: { cookie: customer.cookie },
  });
  assert.equal(deniedAdminApi.status, 403);

  const allowedAdminApi = await fetch(`${baseUrl}/api/admin/infrastructure/plans`, {
    headers: { cookie: firstAdmin.cookie },
  });
  assert.equal(allowedAdminApi.status, 200, await allowedAdminApi.text());

  const deniedCustomerApi = await fetch(`${baseUrl}/api/account/profile`, {
    method: "PATCH",
    headers: {
      cookie: firstAdmin.cookie,
      "content-type": "application/json",
      origin: baseUrl,
    },
    body: JSON.stringify({
      firstName: "مدیر",
      lastName: "آزمایشی",
      email: "panel-e2e-admin@example.com",
    }),
  });
  assert.equal(deniedCustomerApi.status, 403);

  const allowedCustomerApi = await fetch(`${baseUrl}/api/account/profile`, {
    method: "PATCH",
    headers: {
      cookie: customer.cookie,
      "content-type": "application/json",
      origin: baseUrl,
    },
    body: JSON.stringify({
      firstName: "مشتری",
      lastName: "آزمایشی",
      email: "panel-e2e-customer@example.com",
    }),
  });
  assert.equal(allowedCustomerApi.status, 200, await allowedCustomerApi.text());

  const customerRecord = await prisma.user.findUniqueOrThrow({
    where: { mobile: customerMobile },
  });
  await prisma.user.update({
    where: { id: customerRecord.id },
    data: { role: "ADMIN" },
  });

  const refreshedRole = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { cookie: customer.cookie },
  });
  assert.equal(refreshedRole.status, 200);
  assert.equal(
    ((await refreshedRole.json()) as { user: { role: string } }).user.role,
    "CUSTOMER",
    "stale ADMIN role without ADMIN_MOBILES allowlist must not grant admin",
  );
});
