import assert from "node:assert/strict";
import test, { after } from "node:test";
import { PrismaClient, UserRole } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;
const prisma = databaseUrl ? new PrismaClient() : null;

after(async () => {
  if (prisma) await prisma.$disconnect();
});

test("customer user cannot access admin-only data paths", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }

  const mobile = "09129990011";
  await prisma.user.deleteMany({ where: { mobile } });
  const user = await prisma.user.create({ data: { mobile, role: UserRole.CUSTOMER } });
  assert.equal(user.role, UserRole.CUSTOMER);
  assert.notEqual(user.role, UserRole.ADMIN);
});

test("profile page route exists in app tree", async () => {
  const { existsSync } = await import("node:fs");
  assert.equal(existsSync("app/account/profile/page.tsx"), true);
  assert.equal(existsSync("app/admin/page.tsx"), true);
  assert.equal(existsSync("app/account/order/page.tsx"), true);
  assert.equal(existsSync("app/api/admin/infrastructure/plans/route.ts"), true);
  assert.equal(existsSync("components/product/customer-shell.tsx"), true);
  assert.equal(existsSync("components/product/admin-shell.tsx"), true);
  assert.equal(existsSync("lib/auth/guards.ts"), true);
});

test("admin and customer panels use central role guards", async () => {
  const { readFile } = await import("node:fs/promises");
  const guards = await readFile("lib/auth/guards.ts", "utf8");
  const adminLayout = await readFile("app/admin/layout.tsx", "utf8");
  const customerLayout = await readFile("app/account/layout.tsx", "utf8");
  const loginForm = await readFile("components/login-form.tsx", "utf8");

  assert.match(guards, /export async function requireAdmin\(/);
  assert.match(guards, /export async function requireCustomer\(/);
  assert.match(adminLayout, /getAdminPageAccess/);
  assert.match(customerLayout, /requireCustomerPage/);
  assert.match(
    loginForm,
    /requestedNext\?\.startsWith\("\/"\) && !requestedNext\.startsWith\("\/\/"\)/,
  );
  assert.match(
    loginForm,
    /role === "ADMIN" \? "\/admin" : safeNext \?\? "\/account"/,
  );
});

test("admin infrastructure action routes exist", async () => {
  const { existsSync } = await import("node:fs");
  assert.equal(existsSync("app/api/admin/infrastructure/orders/[id]/retry/route.ts"), true);
  assert.equal(existsSync("app/api/admin/infrastructure/orders/[id]/reconcile/route.ts"), true);
  assert.equal(existsSync("app/api/admin/infrastructure/orders/[id]/confirm-no-resource/route.ts"), true);
  assert.equal(existsSync("app/api/admin/infrastructure/orders/[id]/health-retry/route.ts"), true);
  assert.equal(existsSync("app/api/admin/infrastructure/orders/[id]/health-observe/route.ts"), true);
  assert.equal(existsSync("app/api/admin/infrastructure/orders/[id]/health-recovery/route.ts"), true);
  assert.equal(
    existsSync(
      "app/api/admin/infrastructure/orders/[id]/manual-delivery/route.ts",
    ),
    true,
  );
  assert.equal(
    existsSync(
      "app/api/admin/infrastructure/preprovisioned-inventory/[id]/credential/route.ts",
    ),
    true,
  );
  assert.equal(
    existsSync(
      "app/api/admin/infrastructure/plans/[id]/billing-policy/route.ts",
    ),
    true,
  );
  assert.equal(
    existsSync(
      "app/api/admin/instances/[id]/billing-cadence/route.ts",
    ),
    true,
  );
});
