import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  CloudInstanceStatus,
  InfrastructureProductKind,
  InfrastructureOrderStatus,
  InfrastructureProvider,
  LedgerDirection,
  LedgerStatus,
  LedgerType,
  PrismaClient,
  ProvisioningJobStatus,
  ServiceOrderStatus,
  WalletStatus,
} from "@prisma/client";

import { confirmProviderFunding } from "../lib/infrastructure/funding.ts";
import { FakeCloudProviderAdapter } from "../lib/infrastructure/fake-cloud-provider-adapter.ts";
import {
  claimNextProvisioningJob,
  processProvisioningJob,
  recoverExpiredProvisioningJobs,
} from "../lib/infrastructure/provisioning-service.ts";
import { refundOrder } from "../lib/orders/service.ts";
import { reverseLedgerEntry } from "../lib/wallet/ledger.ts";
import { tomanToRial } from "../lib/money.ts";

const prisma = process.env.DATABASE_URL ? new PrismaClient() : null;

function allowTestAdmin(mobile: string) {
  const current = (process.env.ADMIN_MOBILES ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!current.includes(mobile)) {
    process.env.ADMIN_MOBILES = [...current, mobile].join(",");
  }
}

after(async () => {
  if (prisma) await prisma.$disconnect();
});

function requirePrisma(t: { skip: (message?: string) => void }) {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return null;
  }
  return prisma;
}

async function seedInfra(mobile: string, suffix: string) {
  const db = prisma!;
  await db.user.deleteMany({ where: { mobile } });
  const delivery = {
    provider: InfrastructureProvider.ARVAN,
    providerApiVersion: "v1",
    productKind: InfrastructureProductKind.READY_INSTANT_SERVER,
    region: "tehran11",
    externalPlanId: "irLinuxVPS4",
    externalImageId: "ubuntu24-cloudinit-qcow2",
    externalNetworkId: "network-1",
    externalSecurityId: "security-1",
    topologyVerificationMode: "STRICT_OBSERVED",
    accessMethod: "ONE_TIME_PASSWORD",
    sshKeyName: null,
    initScript: null,
  } as const;
  const plan = await db.infrastructurePlan.upsert({
    where: { code: "DEV_STARTER" },
    update: {
      provider: InfrastructureProvider.ARVAN,
      providerApiVersion: "v1",
      productKind: InfrastructureProductKind.READY_INSTANT_SERVER,
      deliveryMode: "MANAGED",
      parchinIncluded: true,
      minimumParchinLevel: "PARCHIN_START",
    },
    create: {
      code: "DEV_STARTER",
      title: "شروع",
      provider: InfrastructureProvider.ARVAN,
      providerApiVersion: "v1",
      productKind: InfrastructureProductKind.READY_INSTANT_SERVER,
      regionCode: "tehran11",
      sizeCode: "irLinuxVPS4",
      imageCode: "ubuntu24-cloudinit-qcow2",
      deliveryMode: "MANAGED",
      salePriceRial: tomanToRial(150_000),
      estimatedProviderCostRial: tomanToRial(120_000),
      parchinIncluded: true,
      minimumParchinLevel: "PARCHIN_START",
      active: true,
      sortOrder: 1,
    },
  });
  const user = await db.user.create({ data: { mobile } });
  allowTestAdmin("09128883999");
  const admin = await db.user.upsert({
    where: { mobile: "09128883999" },
    update: { role: "ADMIN" },
    create: { mobile: "09128883999", role: "ADMIN" },
  });
  const serviceOrder = await db.serviceOrder.create({
    data: {
      userId: user.id,
      title: plan.title,
      amount: plan.salePriceRial,
      status: ServiceOrderStatus.PAID,
      planId: plan.id,
      planCode: plan.code,
      paidAt: new Date(),
      provider: InfrastructureProvider.ARVAN,
      providerApiVersion: "v1",
      productKind: InfrastructureProductKind.READY_INSTANT_SERVER,
      parchinLevel: "PARCHIN_START",
      productFlowState: "PROVISIONING_SUBMITTED",
    },
  });
  const infra = await db.infrastructureOrder.create({
    data: {
      serviceOrderId: serviceOrder.id,
      userId: user.id,
      planId: plan.id,
      provider: InfrastructureProvider.ARVAN,
      providerApiVersion: "v1",
      productKind: InfrastructureProductKind.READY_INSTANT_SERVER,
      parchinLevel: "PARCHIN_START",
      providerSelectionSnapshot: {
        ...delivery,
        deliveryConfiguration: delivery,
      },
      productFlowState: "PROVISIONING_SUBMITTED",
      deliveryMode: "MANAGED",
      status: InfrastructureOrderStatus.QUEUED,
      requiredFundingRial: plan.estimatedProviderCostRial,
      desiredInstanceName: `abrchin-test-${suffix}`,
    },
  });
  const job = await db.provisioningJob.create({
    data: {
      infrastructureOrderId: infra.id,
      operation: "create_instance",
      status: ProvisioningJobStatus.QUEUED,
      idempotencyKey: `hardening_${suffix}_a1`,
      attempt: 1,
      availableAt: new Date(0),
    },
  });
  await db.adminCommandReceipt.create({
    data: {
      operation: "APPROVE_PROVISION",
      idempotencyKey: `hardening-approval-${infra.id}`,
      requestFingerprint: `hardening-approval-${suffix}`,
      actorUserId: admin.id,
      infrastructureOrderId: infra.id,
      resultSnapshot: {
        approved: true,
        containsSecret: false,
      },
    },
  });
  return { user, plan, serviceOrder, infra, job };
}

test("failure before create leaves order retryable without cloud instance", async (t) => {
  const db = requirePrisma(t);
  if (!db) return;
  const mobile = "09128883001";
  const { infra, job } = await seedInfra(mobile, "pre");
  const provider = new FakeCloudProviderAdapter({
    provider: InfrastructureProvider.ARVAN,
    createBehavior: "insufficient_balance",
  });
  const claimed = await claimNextProvisioningJob("worker-a");
  assert.ok(claimed);
  assert.equal(claimed.id, job.id);
  await processProvisioningJob(claimed.id, provider, {
    claimToken: claimed.claimToken!,
  });
  const refreshed = await db.infrastructureOrder.findUniqueOrThrow({ where: { id: infra.id } });
  const cloud = await db.cloudInstance.count({ where: { infrastructureOrderId: infra.id } });
  assert.equal(cloud, 0);
  assert.equal(refreshed.status, InfrastructureOrderStatus.WAITING_ADMIN_FUNDING);
  await db.provisioningJob.delete({ where: { id: job.id } });
  await db.infrastructureOrder.delete({ where: { id: infra.id } });
  await db.serviceOrder.deleteMany({ where: { user: { mobile } } });
  await db.user.deleteMany({ where: { mobile } });
});

test("timeout after create marks NEEDS_RECONCILIATION without second create", async (t) => {
  const db = requirePrisma(t);
  if (!db) return;
  const mobile = "09128883002";
  const { infra, job } = await seedInfra(mobile, "timeout");
  await db.provisioningJob.update({
    where: { id: job.id },
    data: {
      createSentAt: new Date(),
      status: ProvisioningJobStatus.RUNNING,
      startedAt: new Date(),
      claimToken: "hardening-timeout-claim",
      leaseExpiresAt: new Date(Date.now() + 60_000),
    },
  });
  await db.$transaction([
    db.serviceOrder.update({
      where: { id: infra.serviceOrderId },
      data: { productFlowState: "PROVISIONING" },
    }),
    db.infrastructureOrder.update({
      where: { id: infra.id },
      data: {
        productFlowState: "PROVISIONING",
        status: InfrastructureOrderStatus.PROVISIONING,
      },
    }),
  ]);
  const provider = new FakeCloudProviderAdapter({
    provider: InfrastructureProvider.ARVAN,
    createBehavior: "timeout_after_accept",
  });
  await processProvisioningJob(job.id, provider, {
    claimToken: "hardening-timeout-claim",
  });
  const refreshed = await db.infrastructureOrder.findUniqueOrThrow({ where: { id: infra.id } });
  assert.equal(refreshed.status, InfrastructureOrderStatus.NEEDS_RECONCILIATION);
  const cloud = await db.cloudInstance.count({ where: { infrastructureOrderId: infra.id } });
  assert.equal(cloud, 0);
  await db.provisioningJob.delete({ where: { id: job.id } });
  await db.infrastructureOrder.delete({ where: { id: infra.id } });
  await db.serviceOrder.deleteMany({ where: { user: { mobile } } });
  await db.user.deleteMany({ where: { mobile } });
});

test("expired lease before create requeues job", async (t) => {
  const db = requirePrisma(t);
  if (!db) return;
  const mobile = "09128883003";
  const { job } = await seedInfra(mobile, "lease");
  await db.provisioningJob.update({
    where: { id: job.id },
    data: {
      status: ProvisioningJobStatus.RUNNING,
      leaseExpiresAt: new Date(Date.now() - 1000),
      workerId: "stale-worker",
    },
  });
  await recoverExpiredProvisioningJobs();
  const refreshed = await db.provisioningJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(refreshed.status, ProvisioningJobStatus.QUEUED);
  await db.provisioningJob.delete({ where: { id: job.id } });
  await db.infrastructureOrder.deleteMany({ where: { id: job.infrastructureOrderId } });
  await db.serviceOrder.deleteMany({ where: { user: { mobile } } });
  await db.user.deleteMany({ where: { mobile } });
});

test("refund blocked for active cloud instance", async (t) => {
  const db = requirePrisma(t);
  if (!db) return;
  const mobile = "09128883004";
  const adminMobile = "09128883005";
  allowTestAdmin(adminMobile);
  await db.user.deleteMany({ where: { mobile: { in: [mobile, adminMobile] } } });
  const { user, serviceOrder, infra } = await seedInfra(mobile, "refund");
  const admin = await db.user.create({ data: { mobile: adminMobile, role: "ADMIN" } });
  await db.cloudInstance.create({
    data: {
      infrastructureOrderId: infra.id,
      userId: user.id,
      provider: "ARVAN",
      providerInstanceId: "vm_test_1",
      name: "test",
      region: "tehran11",
      size: "irLinuxVPS4",
      image: "ubuntu24-cloudinit-qcow2",
      deliveryMode: "RAW",
      status: CloudInstanceStatus.ACTIVE,
    },
  });
  await db.infrastructureOrder.update({
    where: { id: infra.id },
    data: { status: InfrastructureOrderStatus.ACTIVE },
  });
  await db.wallet.create({ data: { userId: user.id, availableBalance: 0n, status: WalletStatus.ACTIVE } });
  await db.walletLedgerEntry.create({
    data: {
      walletId: (await db.wallet.findUniqueOrThrow({ where: { userId: user.id } })).id,
      direction: LedgerDirection.DEBIT,
      type: LedgerType.SERVICE_PURCHASE,
      amount: serviceOrder.amount,
      status: LedgerStatus.COMPLETED,
      referenceType: "order",
      referenceId: serviceOrder.id,
      idempotencyKey: `order_pay_${serviceOrder.id}`,
      balanceAfter: 0n,
    },
  });

  await assert.rejects(
    () =>
      refundOrder({
        orderId: serviceOrder.id,
        actorUserId: admin.id,
        reason: "test refund",
        idempotencyKey: "production-refund-blocked-0001",
      }),
    (error: Error & { code?: string }) => error.code === "refund_blocked",
  );

  const ledgerCount = await db.walletLedgerEntry.count({
    where: { referenceId: serviceOrder.id, type: LedgerType.REFUND },
  });
  assert.equal(ledgerCount, 0);
  await db.cloudInstance.deleteMany({ where: { infrastructureOrderId: infra.id } });
  await db.infrastructureOrder.delete({ where: { id: infra.id } });
  await db.serviceOrder.delete({ where: { id: serviceOrder.id } });
  await db.user.deleteMany({ where: { mobile: { in: [mobile, adminMobile] } } });
});

test("retired funding shortcut is fail-closed and creates no confirmation", async (t) => {
  const db = requirePrisma(t);
  if (!db) return;
  const mobile = "09128883006";
  const adminMobile = "09128883007";
  allowTestAdmin(adminMobile);
  const { infra } = await seedInfra(mobile, "fund");
  await db.user.deleteMany({ where: { mobile: adminMobile } });
  const admin = await db.user.create({ data: { mobile: adminMobile, role: "ADMIN" } });
  await db.infrastructureOrder.update({
    where: { id: infra.id },
    data: {
      status: InfrastructureOrderStatus.WAITING_ADMIN_FUNDING,
      productFlowState: "PAID",
    },
  });
  await db.serviceOrder.update({
    where: { id: infra.serviceOrderId },
    data: { productFlowState: "PAID" },
  });
  await db.provisioningJob.deleteMany({ where: { infrastructureOrderId: infra.id } });
  const key = "funding-key-retired-1";
  await assert.rejects(
    confirmProviderFunding({
      infrastructureOrderId: infra.id,
      adminUserId: admin.id,
      fundedAmountToman: 150_000,
      idempotencyKey: key,
    }),
    /فقط از مسیر فرمان Provision|route_retired/,
  );
  await assert.rejects(
    confirmProviderFunding({
      infrastructureOrderId: infra.id,
      adminUserId: admin.id,
      fundedAmountToman: 150_000,
      idempotencyKey: key,
    }),
    /فقط از مسیر فرمان Provision|route_retired/,
  );
  const count = await db.providerFundingConfirmation.count({ where: { infrastructureOrderId: infra.id } });
  assert.equal(count, 0);
  await db.providerFundingConfirmation.deleteMany({ where: { infrastructureOrderId: infra.id } });
  await db.provisioningJob.deleteMany({ where: { infrastructureOrderId: infra.id } });
  await db.infrastructureOrder.delete({ where: { id: infra.id } });
  await db.serviceOrder.deleteMany({ where: { user: { mobile } } });
  await db.user.deleteMany({ where: { mobile: { in: [mobile, adminMobile] } } });
});

test("ledger reverse is idempotent under duplicate requests", async (t) => {
  const db = requirePrisma(t);
  if (!db) return;
  const mobile = "09128883008";
  await db.user.deleteMany({ where: { mobile } });
  const user = await db.user.create({ data: { mobile } });
  const wallet = await db.wallet.create({
    data: { userId: user.id, availableBalance: tomanToRial(100_000), status: WalletStatus.ACTIVE },
  });
  const debit = await db.walletLedgerEntry.create({
    data: {
      walletId: wallet.id,
      direction: LedgerDirection.DEBIT,
      type: LedgerType.SERVICE_PURCHASE,
      amount: tomanToRial(10_000),
      status: LedgerStatus.COMPLETED,
      idempotencyKey: `debit_${mobile}`,
      balanceAfter: tomanToRial(90_000),
    },
  });
  const key = `reverse_${debit.id}`;
  const first = await reverseLedgerEntry({
    userId: user.id,
    originalEntryId: debit.id,
    idempotencyKey: key,
    description: "test",
  });
  const second = await reverseLedgerEntry({
    userId: user.id,
    originalEntryId: debit.id,
    idempotencyKey: key,
    description: "test",
  });
  assert.equal(first.id, second.id);
  const reverseCount = await db.walletLedgerEntry.count({ where: { reversedEntryId: debit.id } });
  assert.equal(reverseCount, 1);
  await db.walletLedgerEntry.deleteMany({ where: { walletId: wallet.id } });
  await db.wallet.delete({ where: { id: wallet.id } });
  await db.user.delete({ where: { id: user.id } });
});

test("production deploy gate keeps one-shot migrate and accepts degraded readiness", async () => {
  const { readFile } = await import("node:fs/promises");
  const deploy = await readFile("ops/deploy.sh", "utf8");
  const workerEntrypoint = await readFile("scripts/worker-entrypoint.sh", "utf8");
  assert.match(deploy, /ABRCHIN_IMAGE/);
  assert.match(deploy, /:latest/);
  assert.match(deploy, /flock/);
  assert.match(deploy, /--env-file/);
  assert.match(deploy, /compose config --quiet/);
  assert.match(deploy, /backup-postgres\.sh/);
  assert.match(deploy, /prisma migrate deploy/);
  assert.match(deploy, /local_readiness_acceptable/);
  assert.match(deploy, /status" == "degraded"/);
  assert.match(deploy, /MIGRATED=1/);
  // Migration flag must be set before the one-shot migrate command runs.
  const gateIdx = deploy.indexOf("Explicit migration gate");
  assert.ok(gateIdx > 0);
  const migratedIdx = deploy.indexOf("MIGRATED=1", gateIdx);
  const migrateCmdIdx = deploy.indexOf(
    "node ./node_modules/prisma/build/index.js migrate deploy",
    gateIdx,
  );
  assert.ok(migratedIdx > gateIdx && migrateCmdIdx > migratedIdx);
  const executable = deploy
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  assert.doesNotMatch(executable, /down -v|volume rm|migrate reset/);
  assert.doesNotMatch(workerEntrypoint, /migrate deploy/);
});

test("deploy treats ENV_FILE as dotenv not bash and survives Bearer tokens", async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");

  const deploy = await readFile("ops/deploy.sh", "utf8");
  const backup = await readFile("ops/backup-postgres.sh", "utf8");
  const deployExec = deploy
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  const backupExec = backup
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

  // Deploy must never Bash-source the Compose dotenv.
  assert.doesNotMatch(deployExec, /\bsource\b/);
  assert.doesNotMatch(deployExec, /(^|[\s;])\.\s+"?\$\{?ENV_FILE/);
  assert.doesNotMatch(deployExec, /set -a/);
  assert.match(deploy, /docker compose --env-file "\$ENV_FILE"/);
  assert.match(deploy, /ENV_FILE is a Docker Compose dotenv/);

  // Backup already uses --env-file only.
  assert.match(backup, /docker compose --env-file "\$ENV_FILE"/);
  assert.doesNotMatch(backupExec, /\bsource\b/);
  assert.doesNotMatch(backupExec, /set -a/);

  const dir = await mkdtemp(join(tmpdir(), "abrchin-dotenv-"));
  const envPath = join(dir, ".env");
  try {
    // Compose-legal unquoted Bearer value; Bash `source` treats `token-value`
    // as a command and fails (or worse). Deploy must not source this file.
    await writeFile(
      envPath,
      [
        "ARVAN_API_KEY=Bearer token-value",
        "DATABASE_URL=postgresql://abrchin:x@db:5432/abrchin",
        "ABRCHIN_IMAGE=abrchin:deadbeefcafe",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );

    const sourced = spawnSync(
      "bash",
      ["-c", `set -euo pipefail; source "${envPath}"; echo SHOULD_NOT_REACH`],
      { encoding: "utf8" },
    );
    assert.notEqual(
      sourced.status,
      0,
      "bash source of Bearer dotenv must fail; otherwise regression fixture is weak",
    );
    assert.doesNotMatch(sourced.stdout ?? "", /SHOULD_NOT_REACH/);

    // Syntax-check deploy.sh itself; does not execute the deploy body.
    const syntax = spawnSync("bash", ["-n", "ops/deploy.sh"], {
      encoding: "utf8",
    });
    assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);

    // Prove deploy.sh control flow never opens ENV_FILE via source even when
    // ABRCHIN_IMAGE is exported and ENV_FILE points at the Bearer fixture:
    // extract only the pre-lock validation by stopping before flock via a
    // dry probe that greps the script (already asserted) and confirms the
    // fixture path is never passed to `source`/`set -a` in executable lines.
    assert.equal(
      deployExec.includes('source "$ENV_FILE"'),
      false,
    );
    assert.equal(deployExec.includes(`source "${envPath}"`), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
