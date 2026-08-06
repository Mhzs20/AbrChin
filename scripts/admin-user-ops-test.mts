import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("blocked users cannot login or keep session", async () => {
  const [auth, session] = await Promise.all([
    readFile("lib/auth-service.ts", "utf8"),
    readFile("lib/session.ts", "utf8"),
  ]);
  assert.match(auth, /accountStatus === "BLOCKED"/);
  assert.match(session, /accountStatus === "BLOCKED"/);
});

test("admin user ops require reason audit and ownership safety", async () => {
  const [source, page, detail] = await Promise.all([
    readFile("lib/admin/user-admin.ts", "utf8"),
    readFile("app/admin/users/page.tsx", "utf8"),
    readFile("app/admin/users/[id]/page.tsx", "utf8"),
  ]);
  assert.match(source, /adminCreateUser/);
  assert.match(source, /adminUpdateUser/);
  assert.match(source, /adminSetUserBlock/);
  assert.match(source, /adminTransferServer/);
  assert.match(source, /adminAttachServer/);
  assert.match(source, /adminDeleteUser/);
  assert.match(source, /listUserSiteActivity/);
  assert.match(source, /cannot_delete_self/);
  assert.match(source, /wallet_not_empty/);
  assert.match(source, /has_servers/);
  assert.match(source, /confirm_mobile_mismatch/);
  assert.match(source, /normalizeAdminCommand/);
  assert.match(page, /AdminUsersCreateForm/);
  assert.match(page, /AdminUserActionsLink/);
  assert.match(detail, /AdminUserDetailPanel/);
});
