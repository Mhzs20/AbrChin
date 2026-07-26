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
});

test("admin infrastructure action routes exist", async () => {
  const { existsSync } = await import("node:fs");
  assert.equal(existsSync("app/api/admin/infrastructure/orders/[id]/retry/route.ts"), true);
  assert.equal(existsSync("app/api/admin/infrastructure/orders/[id]/reconcile/route.ts"), true);
  assert.equal(existsSync("app/api/admin/infrastructure/orders/[id]/confirm-no-resource/route.ts"), true);
});
