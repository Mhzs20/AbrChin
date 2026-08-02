import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getInfrastructureAttention } from "../lib/infrastructure/attention.ts";
import { assessInfrastructureRecoveryActions } from "../lib/infrastructure/resource-disposition.ts";

const root = new URL("../", import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

test("each attention record gives a safe cause, timestamp, and next action", () => {
  const attention = getInfrastructureAttention({
    status: "NEEDS_RECONCILIATION",
    productFlowState: "PROVISIONING_RECONCILING",
    updatedAt: new Date("2026-08-03T00:00:00.000Z"),
    hasResource: false,
    attempts: [{
      operation: "create_instance",
      attempt: 1,
      status: "NEEDS_RECONCILIATION",
      lastErrorCode: "provider_timeout",
      updatedAt: new Date("2026-08-03T00:01:00.000Z"),
    }],
    allowedActions: ["reconcile", "confirm-no-resource"],
  });
  assert.equal(attention?.code, "provider_timeout");
  assert.match(attention?.title ?? "", /به‌موقع نرسید/);
  assert.equal(attention?.lastAttempt?.attempt, 1);
  assert.deepEqual(attention?.nextActions, [
    "تطبیق فقط‌خواندنی با Provider",
    "تأیید نبود Resource",
  ]);
  assert.equal(attention?.detail.includes("timeout"), false);
});

test("a resolved Provider balance issue can retry without a second resource", () => {
  const actions = assessInfrastructureRecoveryActions({
    id: "balance-order",
    status: "WAITING_ADMIN_FUNDING",
    productFlowState: "PROVISIONING_MANUAL_REVIEW",
    provisioningJobs: [{
      id: "balance-job",
      operation: "create_instance",
      attempt: 1,
      status: "BLOCKED_PROVIDER_BALANCE" as const,
      createSentAt: null,
      providerTaskId: null,
      providerResourceId: null,
      lastErrorCode: "provider_insufficient_balance",
      createdAt: new Date(),
    }],
    cloudInstance: null,
    reconcileNoResourceConfirmedAt: null,
    reconcileNoResourceConfirmedJobId: null,
    reconcileNoResourceConfirmedAttempt: null,
    absenceAudit: null,
  });
  assert.deepEqual(actions.allowedActions, ["retry", "refund"]);
});

test("health failures are promoted to attention and success returns to provisioning", async () => {
  const [health, operations, refund] = await Promise.all([
    source("lib/infrastructure/health-check-service.ts"),
    source("lib/admin/operations.ts"),
    source("lib/orders/service.ts"),
  ]);
  assert.match(health, /data: \{ status: InfrastructureOrderStatus\.MANUAL_REVIEW \}/);
  assert.match(health, /data: \{ status: InfrastructureOrderStatus\.PROVISIONING \}/);
  assert.match(operations, /"HEALTH_CHECK_FAILED"/);
  assert.match(refund, /assessRefundResourceSafety/);
  assert.match(refund, /idempotencyKey: `audit:refund:\$\{order\.id\}`/);
});
