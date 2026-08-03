import assert from "node:assert/strict";
import test from "node:test";

import { classifyAdminOperationQueue } from "../lib/admin/operations.ts";

test("operations center assigns real order states to exactly one actionable queue", () => {
  assert.equal(
    classifyAdminOperationQueue({
      status: "WAITING_ADMIN_FUNDING",
      productFlowState: "PAID",
    }),
    "provision",
  );
  assert.equal(
    classifyAdminOperationQueue({
      status: "PROVISIONING",
      productFlowState: "WAITING_ADMIN_DELIVERY_APPROVAL",
    }),
    "delivery",
  );
  assert.equal(
    classifyAdminOperationQueue({
      status: "NEEDS_RECONCILIATION",
      productFlowState: "PROVISIONING_RECONCILING",
    }),
    "attention",
  );
  assert.equal(
    classifyAdminOperationQueue({
      status: "PROVISIONING",
      productFlowState: "HEALTH_CHECK_FAILED",
    }),
    "attention",
  );
  assert.equal(
    classifyAdminOperationQueue({
      status: "WAITING_ADMIN_FUNDING",
      productFlowState: "PROVISIONING_MANUAL_REVIEW",
    }),
    "attention",
  );
  assert.equal(
    classifyAdminOperationQueue({
      status: "ACTIVE",
      productFlowState: "ACTIVE",
    }),
    null,
  );
  assert.equal(
    classifyAdminOperationQueue({
      status: "FUNDING_CONFIRMED",
      productFlowState: "PROVISION_APPROVED",
    }),
    null,
  );
  assert.equal(
    classifyAdminOperationQueue({
      status: "ACTIVE",
      productFlowState: "DELIVERED",
    }),
    null,
  );
});
