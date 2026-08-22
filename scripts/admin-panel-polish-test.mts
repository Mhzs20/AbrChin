/**
 * Guards the admin-panel polish batch (night shift, 31 مرداد):
 *  - identical unread notifications coalesce at the source
 *  - the notifications page groups repeats and offers mark-all-read
 *  - no raw enum reaches a Persian admin surface
 *  - checkout display rounding floors negative lines
 *  - the regions page no longer runs live discovery on every view
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("identical unread notifications coalesce instead of stacking", async () => {
  const incidents = await readFile("lib/operations/incidents.ts", "utf8");
  assert.match(incidents, /unreadTwin/);
  assert.match(
    incidents,
    /status: AdminNotificationStatus\.UNREAD,[\s\S]{0,120}?if \(unreadTwin\)/,
    "creation must be guarded by the unread-twin lookup",
  );
});

test("notifications page groups repeats and offers mark-all-read", async () => {
  const page = await readFile("app/admin/notifications/page.tsx", "utf8");
  assert.match(page, /MarkAllNotificationsRead/);
  assert.match(page, /const groups = new Map/);
  const route = await readFile(
    "app/api/admin/notifications/mark-all-read/route.ts",
    "utf8",
  );
  assert.match(route, /requireAdmin\(\)/);
  assert.match(route, /rejectCrossOrigin/);
  assert.match(route, /status: AdminNotificationStatus\.UNREAD/);
  // Read-state only — the endpoint must never touch RESOLVED rows or incidents.
  assert.doesNotMatch(route, /AdminNotificationStatus\.RESOLVED|prisma\.operationalIncident/);
});

test("no raw enum reaches a Persian admin surface", async () => {
  const [transactions, wallets, notifications] = await Promise.all([
    readFile("app/admin/transactions/page.tsx", "utf8"),
    readFile("app/admin/wallets/page.tsx", "utf8"),
    readFile("app/admin/notifications/page.tsx", "utf8"),
  ]);
  assert.match(transactions, /ledgerStatusLabel\[entry\.status\]/);
  assert.doesNotMatch(wallets, /سند TOP_UP|\(SUCCEEDED\)/);
  assert.match(notifications, /typeLabel\[group\.type\]/);
  assert.match(notifications, /PROVIDER_UNAVAILABLE: "/);
});

test("instances page has no dangling sample label", async () => {
  const page = await readFile("app/admin/instances/page.tsx", "utf8");
  assert.doesNotMatch(page, /نوع تحویل نمونه/);
  assert.match(page, /deliveryModeLabel\[instance\.deliveryMode\]/);
});

test("checkout display rounding floors negative lines", async () => {
  const panel = await readFile(
    "components/account/order-checkout-panel.tsx",
    "utf8",
  );
  assert.match(panel, /rial >= 0n \? rial \/ 10n : \(rial - 9n\) \/ 10n/);

  // The exact production invoice that summed one toman high.
  const floorSigned = (rial: bigint) =>
    rial >= 0n ? rial / 10n : (rial - 9n) / 10n;
  const lines = [82_943_172n, 15_000_000n, -4_897_159n, 9_304_602n];
  const displayedSum = lines.reduce(
    (sum, rial) => sum + floorSigned(rial),
    0n,
  );
  const totalRial = lines.reduce((sum, rial) => sum + rial, 0n);
  assert.equal(displayedSum, floorSigned(totalRial));
  assert.equal(displayedSum, 10_235_061n);
});

test("regions page renders from stored configs, discovery only on empty bootstrap", async () => {
  const page = await readFile(
    "app/admin/infrastructure/regions/page.tsx",
    "utf8",
  );
  assert.match(
    page,
    /if \(arvanRegions\.length \+ parsPackRegions\.length === 0\) \{[\s\S]*?syncAllProviderRegionsFromProviders/,
    "live discovery must be gated on an empty table",
  );
});
