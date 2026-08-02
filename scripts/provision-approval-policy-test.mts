import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

test("first Admin Provision approval is auditable and does not create a resource or job", async () => {
  const [approval, flow, funding, page, actions, fundingRoute, manualRoute] =
    await Promise.all([
      source("lib/infrastructure/provision-approval.ts"),
      source("lib/product-flow/state-machine.ts"),
      source("lib/infrastructure/funding.ts"),
      source("app/admin/infrastructure/orders/page.tsx"),
      source("components/admin/provision-approval-actions.tsx"),
      source("app/api/admin/infrastructure/orders/[id]/confirm-funding/route.ts"),
      source("app/api/admin/infrastructure/orders/[id]/manual-delivery/route.ts"),
    ]);

  assert.match(flow, /"PAID"[\s\S]*"PROVISION_APPROVED"/);
  assert.match(flow, /PROVISION_APPROVED:\s*\[[\s\S]*"PROVISIONING_SUBMITTED"/);
  assert.match(approval, /assertAdminActorTx/);
  assert.match(approval, /replayAdminCommandTx/);
  assert.match(approval, /persistAdminCommandReceiptTx/);
  assert.match(approval, /from:\s*"PAID"[\s\S]*to:\s*"PROVISION_APPROVED"/);
  assert.match(approval, /PROVISION_APPROVED/);
  assert.match(approval, /PROVISION_APPROVAL_BLOCKED/);
  assert.match(approval, /provider_balance_confirmation_required/);
  assert.doesNotMatch(approval, /provisioningJob\.create|cloudInstance\.create|createServer\s*\(/);
  assert.match(funding, /route_retired/);
  assert.doesNotMatch(funding, /provisioningJob\.create|cloudInstance\.create/);
  assert.match(fundingRoute, /410/);
  assert.match(manualRoute, /410/);
  assert.match(page, /getProvisionApprovalReview/);
  assert.match(page, /ProvisionApprovalActions/);
  assert.match(actions, /این مرحله هیچ Resource یا Job ساخت ایجاد نمی‌کند/);
});

test("legacy manual delivery cannot bypass the first approval", async () => {
  const manualDelivery = await source("lib/infrastructure/manual-ready-delivery.ts");
  assert.match(manualDelivery, /order\.productFlowState !== "PROVISION_APPROVED"/);
  assert.match(manualDelivery, /from:\s*"PROVISION_APPROVED"/);
});
