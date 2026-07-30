import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  CloudInstanceStatus,
  InfrastructureOrderStatus,
  InfrastructureProductKind,
  InfrastructureProvider,
  ParchinLevel,
  PrismaClient,
  ProvisioningJobStatus,
  ServiceOrderStatus,
} from "@prisma/client";

import { FakeCloudProviderAdapter } from "../lib/infrastructure/fake-cloud-provider-adapter.ts";
import { calculateQuotePricing } from "../lib/pricing/quote-line-items.ts";

const execFileAsync = promisify(execFile);
const baseUrl = process.env.POSTGRES_TEST_DATABASE_URL;
if (!baseUrl) {
  throw new Error(
    "POSTGRES_TEST_DATABASE_URL is required; the real PostgreSQL migration test was not run",
  );
}

const schemaName = `abrchin_migration_${Date.now().toString(36)}`;
const databaseUrl = new URL(baseUrl);
databaseUrl.searchParams.set("schema", schemaName);
const isolatedUrl = databaseUrl.toString();
const tempRoot = await mkdtemp(join(tmpdir(), "abrchin-pg-migration-"));
const tempPrisma = join(tempRoot, "prisma");
const tempMigrations = join(tempPrisma, "migrations");
await mkdir(tempMigrations, { recursive: true });
await cp("prisma/schema.prisma", join(tempPrisma, "schema.prisma"));

const migrationNames = (await readdir("prisma/migrations"))
  .filter((name) => /^\d/.test(name))
  .sort();
const multiProvider = "20260730160000_multi_provider_routing";
const hardening = "20260730190000_provider_review_hardening";
const recoveryV2 = "20260730223000_provider_review_recovery_v2";

async function copyThrough(lastName: string) {
  for (const name of migrationNames.filter((entry) => entry <= lastName)) {
    await cp(
      join("prisma/migrations", name),
      join(tempMigrations, name),
      { recursive: true },
    );
  }
}

async function deploy() {
  await execFileAsync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    [
      "prisma",
      "migrate",
      "deploy",
      "--schema",
      join(tempPrisma, "schema.prisma"),
    ],
    {
      env: { ...process.env, DATABASE_URL: isolatedUrl },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
}

async function executeStatements(client: PrismaClient, sql: string) {
  const statements = sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

  await client.$transaction(async (tx) => {
    for (const statement of statements) {
      await tx.$executeRawUnsafe(statement);
    }
  });
}

await copyThrough(
  migrationNames.filter((name) => name < multiProvider).at(-1)!,
);
await deploy();

const db = new PrismaClient({
  datasources: { db: { url: isolatedUrl } },
});
let flowDb: PrismaClient | null = null;
try {
  await executeStatements(db, `
    INSERT INTO "ProviderPricingConfig" (
      "id", "provider", "markupBasisPoints", "updatedAt"
    ) VALUES (
      'parspack', 'PARSPACK', 2500, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("provider") DO UPDATE
    SET "markupBasisPoints" = EXCLUDED."markupBasisPoints",
        "updatedAt" = EXCLUDED."updatedAt"
  `);

  await copyThrough(multiProvider);
  await deploy();
  const pricing = await db.$queryRawUnsafe<
    Array<{ providerMarkup: number; productMarkup: number }>
  >(`
    SELECT p."markupBasisPoints" AS "providerMarkup",
           k."markupBasisPoints" AS "productMarkup"
    FROM "ProviderPricingConfig" p
    JOIN "ProductPricingConfig" k
      ON k."provider" = p."provider"
    WHERE p."provider" = 'PARSPACK'
      AND k."productKind" = 'READY_INSTANT_SERVER'
  `);
  assert.deepEqual(pricing, [
    { providerMarkup: 2500, productMarkup: 0 },
  ]);
  const calculated = calculateQuotePricing({
    providerMonthlyPriceIrr: 5_000_000n,
    providerMarkupBps: pricing[0]!.providerMarkup,
    productMarkupBps: pricing[0]!.productMarkup,
    parchinLevel: "PARCHIN_START",
    parchinPriceIrr: 0n,
    taxBps: 0,
  });
  assert.equal(calculated.markupAmountIrr, 1_250_000n);

  await executeStatements(db, `
    INSERT INTO "User" (
      id, mobile, "displayName", role, "mobileVerifiedAt", "updatedAt"
    ) VALUES (
      'migration-user', '09120000000', 'Migration', 'CUSTOMER',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );
    INSERT INTO "Wallet" (
      id, "userId", "availableBalance", status, "updatedAt"
    ) VALUES (
      'migration-wallet', 'migration-user', 9000000, 'ACTIVE',
      CURRENT_TIMESTAMP
    );
    INSERT INTO "ProviderCatalogItem" (
      id, provider, "regionCode", "sizeCode", "sizeName",
      "compatibleImageCodes", vcpu, "ramMb", "diskGb", available, active,
      "priceMonthlyAmount", "currencyCode", "amountUnit", "lastSyncedAt",
      "updatedAt", "apiVersion", "productKind", "externalPlanId",
      "externalKey", status, "providerMonthlyPriceIrr", "lastSeenAt",
      "rawPayload", "payloadHash", "catalogVersion"
    ) VALUES (
      'migration-catalog', 'PARSPACK', 'tehran', 's1', 'S1',
      '["ubuntu"]', 2, 2048, 40, true, true,
      5000000, 'IRR', 'RIAL', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
      'v1', 'READY_INSTANT_SERVER', 's1',
      'parspack:v1:tehran:s1', 'ACTIVE', 5000000,
      CURRENT_TIMESTAMP, '{}', 'payload-hash', 'catalog-v1'
    );
    INSERT INTO "InfrastructurePlan" (
      id, code, title, provider, "regionCode", "sizeCode", "imageCode",
      "deliveryMode", "salePriceRial", "estimatedProviderCostRial",
      active, "updatedAt", vcpu, "ramGb", "storageGb",
      "renewalPriceRial", "parchinIncluded", "catalogItemId",
      "catalogMappingStatus", "providerApiVersion", "productKind",
      "minimumParchinLevel"
    ) VALUES (
      'migration-plan', 'MIGRATION_PLAN', 'Migration Plan', 'PARSPACK',
      'tehran', 's1', 'ubuntu', 'MANAGED', 6250000, 5000000,
      true, CURRENT_TIMESTAMP, 2, 2, 40, 6250000, true,
      'migration-catalog', 'MAPPED', 'v1', 'READY_INSTANT_SERVER',
      'PARCHIN_START'
    );

    INSERT INTO "RecommendationSession" (
      id, "userId", status, answers, "answerSources", "productFlowState",
      "expiresAt", "createdAt", "updatedAt"
    ) VALUES
      ('legacy-valid', 'migration-user', 'CHECKOUT', '{}', '{}', 'QUOTED',
       CURRENT_TIMESTAMP + INTERVAL '1 hour', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('legacy-incomplete', 'migration-user', 'CHECKOUT', '{}', '{}', 'QUOTED',
       CURRENT_TIMESTAMP + INTERVAL '1 hour', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('legacy-expired', 'migration-user', 'CHECKOUT', '{}', '{}', 'CHECKOUT',
       CURRENT_TIMESTAMP + INTERVAL '1 hour', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('legacy-no-order', 'migration-user', 'QUOTED', '{}', '{}', 'QUOTED',
       CURRENT_TIMESTAMP + INTERVAL '1 hour', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('legacy-paid', 'migration-user', 'CONVERTED', '{}', '{}', 'CONVERTED',
       CURRENT_TIMESTAMP + INTERVAL '1 hour', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

    INSERT INTO "RecommendationQuote" (
      id, "sessionId", "planId", role, status, score, "scoreBreakdown",
      reasons, "profileSnapshot", "planSnapshot", "amountRial",
      "renewalAmountRial", "catalogItemId",
      "providerBasePriceRialSnapshot", "markupBasisPointsSnapshot",
      "finalPriceRialSnapshot", "currencySnapshot",
      "providerPriceCheckedAt", provider, "providerApiVersion",
      "productKind", "providerRegion", "externalPlanId", "externalImageId",
      "externalNetworkId", "externalSecurityId", "vcpuSnapshot",
      "ramMbSnapshot", "diskGbSnapshot", "operatingSystemSnapshot",
      "providerMonthlyPriceIrr", "markupAmountIrr", "parchinLevel",
      "parchinPriceIrr", "providerAddonsSnapshot", "taxBasisPointsSnapshot",
      "taxAmountIrr", "lineItemsSnapshot", "quotedAt", "catalogVersion",
      "providerPayloadHash", "expiresAt", "updatedAt"
    ) VALUES
      (
        'quote-valid', 'legacy-valid', 'migration-plan', 'RECOMMENDED',
        'SELECTED', 100, '{}', '[]', '{}',
        jsonb_build_object('deliveryConfiguration', jsonb_build_object(
          'provider','PARSPACK','providerApiVersion','v1',
          'productKind','READY_INSTANT_SERVER','region','tehran',
          'externalPlanId','s1','externalImageId','ubuntu',
          'externalNetworkId','provider-default',
          'externalSecurityId','provider-default',
          'accessMethod','ONE_TIME_PASSWORD','imageAssetId','legacy-image'
        )),
        6250000, 6250000, 'migration-catalog', 5000000, 2500,
        6250000, 'IRR', CURRENT_TIMESTAMP, 'PARSPACK', 'v1',
        'READY_INSTANT_SERVER', 'tehran', 's1', 'ubuntu',
        'provider-default', 'provider-default', 2, 2048, 40, 'Ubuntu',
        5000000, 1250000, 'PARCHIN_START', 0, '[]', 0, 0, '[]',
        CURRENT_TIMESTAMP, 'catalog-v1', 'payload-hash',
        CURRENT_TIMESTAMP + INTERVAL '10 minutes', CURRENT_TIMESTAMP
      ),
      (
        'quote-incomplete', 'legacy-incomplete', 'migration-plan',
        'RECOMMENDED', 'ACTIVE', 100, '{}', '[]', '{}', '{}',
        6250000, 6250000, 'migration-catalog', 5000000, 2500,
        6250000, 'IRR', CURRENT_TIMESTAMP, 'PARSPACK', 'v1',
        'READY_INSTANT_SERVER', 'tehran', 's1', 'ubuntu',
        NULL, NULL, 2, 2048, 40, 'Ubuntu',
        5000000, 1250000, 'PARCHIN_START', 0, '[]', 0, 0, '[]',
        CURRENT_TIMESTAMP, 'catalog-v1', 'payload-hash',
        CURRENT_TIMESTAMP + INTERVAL '10 minutes', CURRENT_TIMESTAMP
      ),
      (
        'quote-expired', 'legacy-expired', 'migration-plan', 'RECOMMENDED',
        'ACTIVE', 100, '{}', '[]', '{}', '{}',
        6250000, 6250000, 'migration-catalog', 5000000, 2500,
        6250000, 'IRR', CURRENT_TIMESTAMP, 'PARSPACK', 'v1',
        'READY_INSTANT_SERVER', 'tehran', 's1', 'ubuntu',
        NULL, NULL, 2, 2048, 40, 'Ubuntu',
        5000000, 1250000, 'PARCHIN_START', 0, '[]', 0, 0, '[]',
        CURRENT_TIMESTAMP - INTERVAL '20 minutes', 'catalog-v1', 'payload-hash',
        CURRENT_TIMESTAMP - INTERVAL '10 minutes', CURRENT_TIMESTAMP
      ),
      (
        'quote-no-order', 'legacy-no-order', 'migration-plan', 'RECOMMENDED',
        'ACTIVE', 100, '{}', '[]', '{}', '{}',
        6250000, 6250000, 'migration-catalog', 5000000, 2500,
        6250000, 'IRR', CURRENT_TIMESTAMP, 'PARSPACK', 'v1',
        'READY_INSTANT_SERVER', 'tehran', 's1', 'ubuntu',
        NULL, NULL, 2, 2048, 40, 'Ubuntu',
        5000000, 1250000, 'PARCHIN_START', 0, '[]', 0, 0, '[]',
        CURRENT_TIMESTAMP, 'catalog-v1', 'payload-hash',
        CURRENT_TIMESTAMP + INTERVAL '10 minutes', CURRENT_TIMESTAMP
      ),
      (
        'quote-paid', 'legacy-paid', 'migration-plan', 'RECOMMENDED',
        'CONVERTED', 100, '{}', '[]', '{}', '{}',
        6250000, 6250000, 'migration-catalog', 5000000, 2500,
        6250000, 'IRR', CURRENT_TIMESTAMP, 'PARSPACK', 'v1',
        'READY_INSTANT_SERVER', 'tehran', 's1', 'ubuntu',
        'provider-default', 'provider-default', 2, 2048, 40, 'Ubuntu',
        5000000, 1250000, 'PARCHIN_START', 0, '[]', 0, 0, '[]',
        CURRENT_TIMESTAMP, 'catalog-v1', 'payload-hash',
        CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP
      );

    INSERT INTO "RecommendationQuote"
    SELECT (
      jsonb_populate_record(
        NULL::"RecommendationQuote",
        to_jsonb(q) || jsonb_build_object(
          'id', 'quote-valid-economy',
          'role', 'ECONOMY',
          'status', 'ACTIVE',
          'selectedAt', NULL
        )
      )
    ).*
    FROM "RecommendationQuote" q
    WHERE q.id = 'quote-valid';

    INSERT INTO "RecommendationQuote"
    SELECT (
      jsonb_populate_record(
        NULL::"RecommendationQuote",
        to_jsonb(q) || jsonb_build_object(
          'id', 'quote-valid-growth',
          'role', 'GROWTH',
          'status', 'ACTIVE',
          'selectedAt', NULL
        )
      )
    ).*
    FROM "RecommendationQuote" q
    WHERE q.id = 'quote-valid';

    INSERT INTO "RecommendationQuote"
    SELECT (
      jsonb_populate_record(
        NULL::"RecommendationQuote",
        to_jsonb(q) || jsonb_build_object(
          'id', 'quote-no-order-economy',
          'role', 'ECONOMY',
          'status', 'ACTIVE'
        )
      )
    ).*
    FROM "RecommendationQuote" q
    WHERE q.id = 'quote-no-order';

    INSERT INTO "RecommendationQuote"
    SELECT (
      jsonb_populate_record(
        NULL::"RecommendationQuote",
        to_jsonb(q) || jsonb_build_object(
          'id', 'quote-no-order-growth',
          'role', 'GROWTH',
          'status', 'ACTIVE'
        )
      )
    ).*
    FROM "RecommendationQuote" q
    WHERE q.id = 'quote-no-order';

    INSERT INTO "ServiceOrder" (
      id, "userId", title, amount, status, "planId", "planSnapshot",
      "recommendationQuoteId", "quoteExpiresAt", provider,
      "providerApiVersion", "productKind", "parchinLevel",
      "productFlowState", "paidAt", "updatedAt"
    ) VALUES
      ('order-valid', 'migration-user', 'Valid', 6250000,
       'PENDING_PAYMENT', 'migration-plan', '{}', 'quote-valid',
       CURRENT_TIMESTAMP + INTERVAL '10 minutes', 'PARSPACK', 'v1',
       'READY_INSTANT_SERVER', 'PARCHIN_START', 'DRAFT', NULL,
       CURRENT_TIMESTAMP),
      ('order-incomplete', 'migration-user', 'Incomplete', 6250000,
       'PENDING_PAYMENT', 'migration-plan', '{}', 'quote-incomplete',
       CURRENT_TIMESTAMP + INTERVAL '10 minutes', 'PARSPACK', 'v1',
       'READY_INSTANT_SERVER', 'PARCHIN_START', 'AWAITING_PAYMENT', NULL,
       CURRENT_TIMESTAMP),
      ('order-expired', 'migration-user', 'Expired', 6250000,
       'PENDING_PAYMENT', 'migration-plan', '{}', 'quote-expired',
       CURRENT_TIMESTAMP - INTERVAL '10 minutes', 'PARSPACK', 'v1',
       'READY_INSTANT_SERVER', 'PARCHIN_START', 'AWAITING_PAYMENT', NULL,
       CURRENT_TIMESTAMP),
      ('order-paid', 'migration-user', 'Paid', 6250000, 'PAID',
       'migration-plan', '{"immutable":"paid"}', 'quote-paid',
       CURRENT_TIMESTAMP - INTERVAL '1 hour', 'PARSPACK', 'v1',
       'READY_INSTANT_SERVER', 'PARCHIN_START', 'PAID',
       CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP);

    INSERT INTO "WalletLedgerEntry" (
      id, "walletId", direction, type, amount, status, "referenceType",
      "referenceId", "idempotencyKey", "balanceAfter"
    ) VALUES (
      'ledger-paid', 'migration-wallet', 'DEBIT', 'SERVICE_PURCHASE',
      6250000, 'COMPLETED', 'order', 'order-paid',
      'order_pay_order-paid', 2750000
    );
    INSERT INTO "InfrastructureOrder" (
      id, "serviceOrderId", "userId", "planId", provider,
      "providerApiVersion", "productKind", "parchinLevel",
      "providerSelectionSnapshot", "productFlowState", "deliveryMode",
      status, "requiredFundingRial", "updatedAt"
    ) VALUES (
      'infra-paid', 'order-paid', 'migration-user', 'migration-plan',
      'PARSPACK', 'v1', 'READY_INSTANT_SERVER', 'PARCHIN_START',
      '{"immutable":"paid"}', 'DRAFT', 'MANAGED', 'QUEUED',
      5000000, CURRENT_TIMESTAMP
    );
  `);

  await copyThrough(hardening);
  await deploy();
  const conflictBeforeRecovery = await db.$queryRawUnsafe<
    Array<{
      sessionState: string;
      orderState: string;
    }>
  >(`
    SELECT s."productFlowState" AS "sessionState",
           so."productFlowState" AS "orderState"
    FROM "RecommendationSession" s
    JOIN "RecommendationQuote" q ON q.id = 'quote-valid'
    JOIN "ServiceOrder" so ON so."recommendationQuoteId" = q.id
    WHERE s.id = q."sessionId"
  `);
  assert.deepEqual(conflictBeforeRecovery, [
    {
      sessionState: "REQUIREMENTS_COMPLETE",
      orderState: "AWAITING_PAYMENT",
    },
  ]);

  await executeStatements(db, `
    UPDATE "RecommendationSession"
    SET "productFlowState" = 'PAID', "productFlowRevision" = 7
    WHERE id = 'legacy-paid';
    UPDATE "ServiceOrder"
    SET "productFlowState" = 'PROVISIONING_SUBMITTED',
        "productFlowRevision" = 7
    WHERE id = 'order-paid';
    UPDATE "InfrastructureOrder"
    SET "productFlowState" = 'PAID', "productFlowRevision" = 7
    WHERE id = 'infra-paid';
  `);
  const paidBeforeRecovery = await db.$queryRawUnsafe<
    Array<{
      amount: bigint;
      planSnapshot: unknown;
      providerSelectionSnapshot: unknown;
      quoteFinancialSnapshot: unknown;
      ledgerSnapshot: unknown;
      paidAt: Date | null;
    }>
  >(`
    SELECT
      so.amount,
      so."planSnapshot" AS "planSnapshot",
      io."providerSelectionSnapshot" AS "providerSelectionSnapshot",
      jsonb_build_object(
        'amountRial', q."amountRial",
        'providerBasePriceRialSnapshot',
          q."providerBasePriceRialSnapshot",
        'finalPriceRialSnapshot', q."finalPriceRialSnapshot",
        'lineItemsSnapshot', q."lineItemsSnapshot"
      ) AS "quoteFinancialSnapshot",
      jsonb_build_object(
        'amount', l.amount,
        'balanceAfter', l."balanceAfter",
        'status', l.status
      ) AS "ledgerSnapshot",
      so."paidAt" AS "paidAt"
    FROM "ServiceOrder" so
    JOIN "RecommendationQuote" q
      ON q.id = so."recommendationQuoteId"
    JOIN "InfrastructureOrder" io
      ON io."serviceOrderId" = so.id
    JOIN "WalletLedgerEntry" l ON l."referenceId" = so.id
    WHERE so.id = 'order-paid'
  `);

  await copyThrough(recoveryV2);
  await deploy();
  const valid = await db.$queryRawUnsafe<
    Array<{
      sessionState: string;
      orderState: string;
      sessionRevision: number;
      orderRevision: number;
      quoteStatus: string;
      deliveryConfiguration: unknown;
    }>
  >(`
    SELECT s."productFlowState" AS "sessionState",
           so."productFlowState" AS "orderState",
           s."productFlowRevision" AS "sessionRevision",
           so."productFlowRevision" AS "orderRevision",
           q.status::text AS "quoteStatus",
           s."deliveryConfiguration" AS "deliveryConfiguration"
    FROM "RecommendationSession" s
    JOIN "RecommendationQuote" q ON q."sessionId" = s.id
    JOIN "ServiceOrder" so ON so."recommendationQuoteId" = q.id
    WHERE q.id = 'quote-valid'
  `);
  assert.equal(valid[0]?.sessionState, "AWAITING_PAYMENT");
  assert.equal(valid[0]?.orderState, "AWAITING_PAYMENT");
  assert.equal(valid[0]?.sessionRevision, valid[0]?.orderRevision);
  assert.equal(valid[0]?.quoteStatus, "SELECTED");
  assert.equal(
    (valid[0]?.deliveryConfiguration as Record<string, unknown>)
      .externalPlanId,
    "s1",
  );
  const siblings = await db.$queryRawUnsafe<
    Array<{ id: string; status: string }>
  >(`
    SELECT id, status::text AS status
    FROM "RecommendationQuote"
    WHERE id IN ('quote-valid-economy', 'quote-valid-growth')
    ORDER BY id
  `);
  assert.deepEqual(siblings, [
    { id: "quote-valid-economy", status: "INVALIDATED" },
    { id: "quote-valid-growth", status: "INVALIDATED" },
  ]);

  const blocked = await db.$queryRawUnsafe<
    Array<{ id: string; status: string; flow: string; quoteStatus: string }>
  >(`
    SELECT so.id, so.status::text AS status,
           so."productFlowState" AS flow, q.status::text AS "quoteStatus"
    FROM "ServiceOrder" so
    JOIN "RecommendationQuote" q ON q.id = so."recommendationQuoteId"
    WHERE so.id IN ('order-incomplete', 'order-expired')
    ORDER BY so.id
  `);
  assert.deepEqual(blocked, [
    {
      id: "order-expired",
      status: "DRAFT",
      flow: "REQUIREMENTS_COMPLETE",
      quoteStatus: "EXPIRED",
    },
    {
      id: "order-incomplete",
      status: "DRAFT",
      flow: "REQUIREMENTS_COMPLETE",
      quoteStatus: "INVALIDATED",
    },
  ]);
  const noOrder = await db.$queryRawUnsafe<Array<{ status: string }>>(`
    SELECT status::text AS status FROM "RecommendationQuote"
    WHERE id = 'quote-no-order'
  `);
  assert.equal(noOrder[0]?.status, "INVALIDATED");
  const invalidGraph = await db.$queryRawUnsafe<
    Array<{
      flow: string;
      revision: number;
      remediationCount: bigint;
    }>
  >(`
    SELECT s."productFlowState" AS flow,
           s."productFlowRevision" AS revision,
           (
             SELECT count(*)
             FROM "ProductFlowTransition" t
             WHERE t."idempotencyKey" =
               'migration:v2:invalid:legacy-no-order'
           ) AS "remediationCount"
    FROM "RecommendationSession" s
    WHERE s.id = 'legacy-no-order'
  `);
  assert.equal(invalidGraph[0]?.flow, "REQUIREMENTS_COMPLETE");
  assert.equal(invalidGraph[0]?.remediationCount, 1n);

  const paid = await db.$queryRawUnsafe<
    Array<{
      status: string;
      amount: bigint;
      snapshot: unknown;
      ledgerAmount: bigint;
      ledgerBalance: bigint;
    }>
  >(`
    SELECT so.status::text AS status, so.amount,
           so."planSnapshot" AS snapshot,
           l.amount AS "ledgerAmount", l."balanceAfter" AS "ledgerBalance"
    FROM "ServiceOrder" so
    JOIN "WalletLedgerEntry" l ON l."referenceId" = so.id
    WHERE so.id = 'order-paid'
  `);
  assert.equal(paid[0]?.status, "PAID");
  assert.equal(paid[0]?.amount, 6_250_000n);
  assert.deepEqual(paid[0]?.snapshot, { immutable: "paid" });
  assert.equal(paid[0]?.ledgerAmount, 6_250_000n);
  assert.equal(paid[0]?.ledgerBalance, 2_750_000n);
  const paidAfterRecovery = await db.$queryRawUnsafe<
    typeof paidBeforeRecovery
  >(`
    SELECT
      so.amount,
      so."planSnapshot" AS "planSnapshot",
      io."providerSelectionSnapshot" AS "providerSelectionSnapshot",
      jsonb_build_object(
        'amountRial', q."amountRial",
        'providerBasePriceRialSnapshot',
          q."providerBasePriceRialSnapshot",
        'finalPriceRialSnapshot', q."finalPriceRialSnapshot",
        'lineItemsSnapshot', q."lineItemsSnapshot"
      ) AS "quoteFinancialSnapshot",
      jsonb_build_object(
        'amount', l.amount,
        'balanceAfter', l."balanceAfter",
        'status', l.status
      ) AS "ledgerSnapshot",
      so."paidAt" AS "paidAt"
    FROM "ServiceOrder" so
    JOIN "RecommendationQuote" q
      ON q.id = so."recommendationQuoteId"
    JOIN "InfrastructureOrder" io
      ON io."serviceOrderId" = so.id
    JOIN "WalletLedgerEntry" l ON l."referenceId" = so.id
    WHERE so.id = 'order-paid'
  `);
  assert.deepEqual(paidAfterRecovery, paidBeforeRecovery);
  const paidFlow = await db.$queryRawUnsafe<
    Array<{
      sessionState: string;
      serviceState: string;
      infrastructureState: string;
      sessionRevision: number;
      serviceRevision: number;
      infrastructureRevision: number;
    }>
  >(`
    SELECT
      s."productFlowState" AS "sessionState",
      so."productFlowState" AS "serviceState",
      io."productFlowState" AS "infrastructureState",
      s."productFlowRevision" AS "sessionRevision",
      so."productFlowRevision" AS "serviceRevision",
      io."productFlowRevision" AS "infrastructureRevision"
    FROM "ServiceOrder" so
    JOIN "RecommendationQuote" q
      ON q.id = so."recommendationQuoteId"
    JOIN "RecommendationSession" s ON s.id = q."sessionId"
    JOIN "InfrastructureOrder" io
      ON io."serviceOrderId" = so.id
    WHERE so.id = 'order-paid'
  `);
  assert.equal(paidFlow[0]?.sessionState, "PROVISIONING_SUBMITTED");
  assert.equal(paidFlow[0]?.serviceState, "PROVISIONING_SUBMITTED");
  assert.equal(
    paidFlow[0]?.infrastructureState,
    "PROVISIONING_SUBMITTED",
  );
  assert.equal(
    paidFlow[0]?.sessionRevision,
    paidFlow[0]?.serviceRevision,
  );
  assert.equal(
    paidFlow[0]?.serviceRevision,
    paidFlow[0]?.infrastructureRevision,
  );

  const mismatched = await db.$queryRawUnsafe<Array<{ count: bigint }>>(`
    SELECT count(*) AS count
    FROM "RecommendationQuote" q
    JOIN "RecommendationSession" s ON s.id = q."sessionId"
    JOIN "ServiceOrder" so ON so."recommendationQuoteId" = q.id
    WHERE q.status IN ('ACTIVE', 'SELECTED')
      AND (
        s."productFlowState" <> so."productFlowState"
        OR s."productFlowRevision" <> so."productFlowRevision"
      )
  `);
  assert.equal(mismatched[0]?.count, 0n);

  const auditBefore = await db.productFlowTransition.count({
    where: { idempotencyKey: { startsWith: "migration:v2:" } },
  });
  await deploy();
  const auditAfter = await db.productFlowTransition.count({
    where: { idempotencyKey: { startsWith: "migration:v2:" } },
  });
  assert.equal(auditAfter, auditBefore);

  await db.recommendationSession.create({
    data: {
      id: "conversation-concurrency",
      status: "PROFILING",
      answers: {},
      answerSources: {},
      productFlowState: "DRAFT",
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  process.env.DATABASE_URL = isolatedUrl;
  flowDb = (await import("../lib/db.ts")).prisma;
  const {
    assertProductFlowOwnerStateTx,
    bootstrapCatalogCheckoutFlowTx,
    transitionProductFlow,
  } = await import(
    "../lib/product-flow/service.ts"
  );
  await flowDb.$transaction((tx) =>
    assertProductFlowOwnerStateTx(
      tx,
      {
        recommendationSessionId: "legacy-valid",
        serviceOrderId: "order-valid",
      },
      "AWAITING_PAYMENT",
    ),
  );
  const concurrent = await Promise.allSettled([
    transitionProductFlow({
      owner: { recommendationSessionId: "conversation-concurrency" },
      from: "DRAFT",
      to: "UNDERSTANDING_CONFIRMED",
      idempotencyKey: "pg-concurrency-a",
      reason: "postgres_concurrency_test",
    }),
    transitionProductFlow({
      owner: { recommendationSessionId: "conversation-concurrency" },
      from: "DRAFT",
      to: "UNDERSTANDING_CONFIRMED",
      idempotencyKey: "pg-concurrency-b",
      reason: "postgres_concurrency_test",
    }),
  ]);
  assert.deepEqual(
    concurrent.map((result) => result.status).sort(),
    ["fulfilled", "rejected"],
  );
  const conversation =
    await db.recommendationSession.findUniqueOrThrow({
      where: { id: "conversation-concurrency" },
      select: { productFlowRevision: true },
    });
  assert.equal(conversation.productFlowRevision, 1);

  const now = new Date();
  await db.recommendationSession.create({
    data: {
      id: "catalog-bootstrap-audit",
      status: "QUOTED",
      answers: { source: "CLOUD_SERVER" },
      answerSources: { source: "catalog" },
      productFlowState: "DRAFT",
      selectedParchinLevel: ParchinLevel.PARCHIN_START,
      deliveryConfiguration: {
        provider: "ARVAN",
        providerApiVersion: "v1",
        productKind: "CLOUD_SERVER",
        region: "ir-thr-ba1",
        externalPlanId: "g6",
        externalImageId: "ubuntu",
        externalNetworkId: "network-1",
        externalSecurityId: "security-1",
        topologyVerificationMode: "STRICT_OBSERVED",
        accessMethod: "SSH_KEY",
      },
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const bootstrapInput = {
    recommendationSessionId: "catalog-bootstrap-audit",
    idempotencyKey: "pg-catalog-bootstrap",
    metadata: {
      source: "direct_catalog",
      containsSecret: false,
    },
  } as const;
  await flowDb.$transaction((tx) =>
    bootstrapCatalogCheckoutFlowTx(tx, bootstrapInput),
  );
  await flowDb.$transaction((tx) =>
    bootstrapCatalogCheckoutFlowTx(tx, bootstrapInput),
  );
  const bootstrapped =
    await db.recommendationSession.findUniqueOrThrow({
      where: { id: "catalog-bootstrap-audit" },
      select: {
        productFlowState: true,
        productFlowRevision: true,
      },
    });
  assert.deepEqual(bootstrapped, {
    productFlowState: "QUOTED",
    productFlowRevision: 6,
  });
  assert.equal(
    await db.productFlowTransition.count({
      where: {
        recommendationSessionId: "catalog-bootstrap-audit",
        idempotencyKey: {
          startsWith: "pg-catalog-bootstrap:transition:",
        },
      },
    }),
    6,
  );

  await db.user.create({
    data: {
      id: "migration-admin",
      mobile: "09120000001",
      displayName: "Migration Admin",
      role: "ADMIN",
      mobileVerifiedAt: now,
    },
  });
  await db.providerCatalogItem.create({
    data: {
      id: "migration-arvan-catalog",
      provider: InfrastructureProvider.ARVAN,
      apiVersion: "v1",
      productKind: InfrastructureProductKind.CLOUD_SERVER,
      regionCode: "ir-thr-ba1",
      sizeCode: "g6",
      externalPlanId: "g6",
      externalKey: "arvan:v1:ir-thr-ba1:g6",
      sizeName: "G6",
      compatibleImageCodes: ["ubuntu"],
      vcpu: 2,
      ramMb: 2048,
      diskGb: 40,
      available: true,
      active: true,
      status: "ACTIVE",
      currencyCode: "IRR",
      amountUnit: "RIAL",
      providerMonthlyPriceIrr: 5_000_000n,
      lastSyncedAt: now,
      lastSeenAt: now,
      rawPayload: {},
      payloadHash: "arvan-payload-hash",
      catalogVersion: "arvan-catalog-v1",
    },
  });
  await db.infrastructurePlan.create({
    data: {
      id: "migration-arvan-plan",
      code: "MIGRATION_ARVAN_PLAN",
      title: "Migration Arvan Plan",
      provider: InfrastructureProvider.ARVAN,
      providerApiVersion: "v1",
      productKind: InfrastructureProductKind.CLOUD_SERVER,
      regionCode: "ir-thr-ba1",
      sizeCode: "g6",
      imageCode: "ubuntu",
      deliveryMode: "MANAGED",
      vcpu: 2,
      ramGb: 2,
      storageGb: 40,
      salePriceRial: 6_250_000n,
      renewalPriceRial: 6_250_000n,
      estimatedProviderCostRial: 5_000_000n,
      parchinIncluded: true,
      minimumParchinLevel: ParchinLevel.PARCHIN_START,
      active: true,
      catalogItemId: "migration-arvan-catalog",
      catalogMappingStatus: "MAPPED",
      catalogMappedAt: now,
    },
  });

  const { runInfrastructureHealthCheck } = await import(
    "../lib/infrastructure/health-check-service.ts"
  );
  const {
    processHealthCheckRetryJob,
    scheduleManualHealthRetry,
  } = await import(
    "../lib/infrastructure/health-retry-service.ts"
  );
  const { claimNextProvisioningJob } = await import(
    "../lib/infrastructure/provisioning-service.ts"
  );

  async function seedHealthGraph(input: {
    id: string;
    provider: InfrastructureProvider;
    flowState?: "PROVISIONING" | "HEALTH_CHECK_FAILED";
    providerState: string | null;
    ipv4: string | null;
    networkId: string | null;
    securityId: string | null;
    providerObservedAt: Date | null;
    providerInstanceId?: string;
  }) {
    const arvan = input.provider === InfrastructureProvider.ARVAN;
    const productKind = arvan
      ? InfrastructureProductKind.CLOUD_SERVER
      : InfrastructureProductKind.READY_INSTANT_SERVER;
    const planId = arvan
      ? "migration-arvan-plan"
      : "migration-plan";
    const region = arvan ? "ir-thr-ba1" : "tehran";
    const externalPlanId = arvan ? "g6" : "s1";
    const topologyVerificationMode = arvan
      ? "STRICT_OBSERVED"
      : "PROVIDER_MANAGED";
    const externalNetworkId = arvan ? "network-1" : null;
    const externalSecurityId = arvan ? "security-1" : null;
    const delivery = {
      provider: input.provider,
      providerApiVersion: "v1",
      productKind,
      region,
      externalPlanId,
      externalImageId: "ubuntu",
      externalNetworkId,
      externalSecurityId,
      topologyVerificationMode,
      accessMethod: "SSH_KEY",
      sshKeyName: "migration-key",
    };
    const flowState = input.flowState ?? "PROVISIONING";
    await db.serviceOrder.create({
      data: {
        id: `service-${input.id}`,
        userId: "migration-user",
        title: `Health ${input.id}`,
        amount: 6_250_000n,
        status: ServiceOrderStatus.PAID,
        planId,
        provider: input.provider,
        providerApiVersion: "v1",
        productKind,
        parchinLevel: ParchinLevel.PARCHIN_START,
        planSnapshot: { immutable: input.id },
        paidAt: now,
        productFlowState: flowState,
        productFlowRevision: 0,
      },
    });
    await db.infrastructureOrder.create({
      data: {
        id: `infra-${input.id}`,
        serviceOrderId: `service-${input.id}`,
        userId: "migration-user",
        planId,
        provider: input.provider,
        providerApiVersion: "v1",
        productKind,
        parchinLevel: ParchinLevel.PARCHIN_START,
        providerSelectionSnapshot: {
          ...delivery,
          deliveryConfiguration: delivery,
        },
        productFlowState: flowState,
        productFlowRevision: 0,
        deliveryMode: "MANAGED",
        status: InfrastructureOrderStatus.PROVISIONING,
        requiredFundingRial: 5_000_000n,
        desiredInstanceName: `abrchin-${input.id}-1`,
      },
    });
    await db.cloudInstance.create({
      data: {
        id: `instance-${input.id}`,
        infrastructureOrderId: `infra-${input.id}`,
        userId: "migration-user",
        provider: input.provider,
        providerApiVersion: "v1",
        providerInstanceId:
          input.providerInstanceId ?? `provider-${input.id}`,
        name: `abrchin-${input.id}-1`,
        region,
        size: externalPlanId,
        image: "Ubuntu",
        deliveryMode: "MANAGED",
        ipv4: input.ipv4,
        providerState: input.providerState,
        networkId: input.networkId,
        securityId: input.securityId,
        providerObservedAt: input.providerObservedAt,
        status: CloudInstanceStatus.PENDING,
      },
    });
    return `infra-${input.id}`;
  }

  const parsPackSuccess = await seedHealthGraph({
    id: "parspack-success",
    provider: InfrastructureProvider.PARSPACK,
    providerState: "active",
    ipv4: "192.0.2.21",
    networkId: null,
    securityId: null,
    providerObservedAt: now,
  });
  const parsPackResult = await runInfrastructureHealthCheck({
    infrastructureOrderId: parsPackSuccess,
    probe: async () => true,
  });
  assert.deepEqual(parsPackResult, {
    healthy: true,
    delivered: true,
  });
  const parsPackCheck =
    await db.infrastructureHealthCheck.findFirstOrThrow({
      where: { infrastructureOrderId: parsPackSuccess },
    });
  assert.equal(
    parsPackCheck.topologyVerificationMode,
    "PROVIDER_MANAGED",
  );
  assert.equal(parsPackCheck.observedNetworkId, null);
  assert.equal(parsPackCheck.observedSecurityId, null);

  for (const [id, providerState, ipv4] of [
    ["parspack-no-ip", "active", null],
    ["parspack-unknown", "unknown", "192.0.2.22"],
  ] as const) {
    const infraId = await seedHealthGraph({
      id,
      provider: InfrastructureProvider.PARSPACK,
      providerState,
      ipv4,
      networkId: null,
      securityId: null,
      providerObservedAt: now,
    });
    const result = await runInfrastructureHealthCheck({
      infrastructureOrderId: infraId,
      probe: async () => true,
    });
    assert.equal(result.healthy, false);
  }

  for (const [
    id,
    networkId,
    securityId,
    expectedHealthy,
  ] of [
    ["arvan-correct", "network-1", "security-1", true],
    ["arvan-null", null, null, false],
    ["arvan-network-mismatch", "network-other", "security-1", false],
    ["arvan-security-mismatch", "network-1", "security-other", false],
  ] as const) {
    const infraId = await seedHealthGraph({
      id,
      provider: InfrastructureProvider.ARVAN,
      providerState: "active",
      ipv4: "192.0.2.30",
      networkId,
      securityId,
      providerObservedAt: now,
    });
    const result = await runInfrastructureHealthCheck({
      infrastructureOrderId: infraId,
      probe: async () => true,
    });
    assert.equal(result.healthy, expectedHealthy);
  }

  const retryAdapter = new FakeCloudProviderAdapter({
    provider: InfrastructureProvider.ARVAN,
    observedResource: {
      state: "active",
      ipv4: "192.0.2.40",
      networkIds: ["network-1"],
      securityIds: ["security-1"],
    },
  });
  const fakeTask = await retryAdapter.createServer({
    productKind: InfrastructureProductKind.CLOUD_SERVER,
    region: "ir-thr-ba1",
    externalPlanId: "g6",
    externalImageId: "ubuntu",
    externalNetworkId: "network-1",
    externalSecurityId: "security-1",
    accessMethod: "SSH_KEY",
    sshKeyEnabled: true,
    sshKeyName: "migration-key",
    name: "abrchin-health-retry-1",
    orderPublicId: "infra-health-retry",
    idempotencyKey: "fake-setup-health-retry",
  });
  await retryAdapter.getTaskStatus({
    region: "ir-thr-ba1",
    taskId: fakeTask.taskId,
    resourceId: fakeTask.resourceId,
  });
  const retryInfraId = await seedHealthGraph({
    id: "health-retry",
    provider: InfrastructureProvider.ARVAN,
    flowState: "HEALTH_CHECK_FAILED",
    providerState: "active",
    ipv4: "192.0.2.40",
    networkId: "network-1",
    securityId: "security-1",
    providerObservedAt: now,
    providerInstanceId: fakeTask.resourceId!,
  });
  await assert.rejects(
    scheduleManualHealthRetry({
      infrastructureOrderId: retryInfraId,
      adminUserId: "migration-user",
      reason: "customer must not retry",
      idempotencyKey: "health-retry-auth-0001",
    }),
    /دسترسی مجاز نیست/,
  );
  await assert.rejects(
    scheduleManualHealthRetry({
      infrastructureOrderId: retryInfraId,
      adminUserId: "migration-admin",
      reason: "",
      idempotencyKey: "health-retry-reason-01",
    }),
    /دلیل Retry/,
  );
  await assert.rejects(
    scheduleManualHealthRetry({
      infrastructureOrderId: retryInfraId,
      adminUserId: "migration-admin",
      reason: "valid reason",
      idempotencyKey: "short",
    }),
    /شناسه یکتای Retry/,
  );

  const scheduled = await Promise.all([
    scheduleManualHealthRetry({
      infrastructureOrderId: retryInfraId,
      adminUserId: "migration-admin",
      reason: "manual health retry",
      idempotencyKey: "health-retry-concurrent-0001",
    }),
    scheduleManualHealthRetry({
      infrastructureOrderId: retryInfraId,
      adminUserId: "migration-admin",
      reason: "manual health retry",
      idempotencyKey: "health-retry-concurrent-0001",
    }),
  ]);
  assert.equal(scheduled[0].id, scheduled[1].id);
  assert.equal(
    await db.provisioningJob.count({
      where: {
        infrastructureOrderId: retryInfraId,
        operation: "health_check_retry",
      },
    }),
    1,
  );
  assert.equal(
    await db.auditLog.count({
      where: {
        idempotencyKey:
          "audit:health-retry:infra-health-retry:health-retry-concurrent-0001",
      },
    }),
    1,
  );
  await db.provisioningJob.update({
    where: { id: scheduled[0].id },
    data: { availableAt: new Date(0) },
  });

  const claimedConcurrently = await Promise.all([
    claimNextProvisioningJob("health-worker-a"),
    claimNextProvisioningJob("health-worker-b"),
  ]);
  const claimed = claimedConcurrently.filter(
    (job): job is NonNullable<typeof job> => job != null,
  );
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0]?.id, scheduled[0].id);

  const createCallsBeforeRetry = retryAdapter.createCalls.length;
  await processHealthCheckRetryJob(
    claimed[0]!.id,
    retryAdapter,
    { healthProbe: async () => false },
  );
  for (let attempt = 2; attempt <= 3; attempt += 1) {
    await db.provisioningJob.updateMany({
      where: {
        infrastructureOrderId: retryInfraId,
        operation: "health_check_retry",
        status: ProvisioningJobStatus.QUEUED,
      },
      data: { availableAt: new Date(0) },
    });
    const next = await claimNextProvisioningJob(
      `health-worker-${attempt}`,
    );
    assert.ok(next);
    await processHealthCheckRetryJob(next.id, retryAdapter, {
      healthProbe: async () => false,
    });
  }
  assert.equal(retryAdapter.createCalls.length, createCallsBeforeRetry);
  const exhausted = await db.infrastructureOrder.findUniqueOrThrow({
    where: { id: retryInfraId },
  });
  assert.equal(
    exhausted.productFlowState,
    "PROVISIONING_MANUAL_REVIEW",
  );
  assert.equal(
    exhausted.status,
    InfrastructureOrderStatus.MANUAL_REVIEW,
  );
  const manualReviewTransition =
    await db.productFlowTransition.findFirstOrThrow({
      where: {
        infrastructureOrderId: retryInfraId,
        toState: "PROVISIONING_MANUAL_REVIEW",
      },
      orderBy: { createdAt: "desc" },
    });
  const manualReviewMetadata =
    manualReviewTransition.metadata as Record<string, unknown>;
  assert.equal(
    (
      manualReviewMetadata.lastProviderObservation as Record<
        string,
        unknown
      >
    ).state,
    "active",
  );

  console.log(
    "PostgreSQL integration passed (26 scenarios): graph-level multi-quote recovery, invalid graph determinism, paid financial/provider immutability, payment flow alignment, Prisma deployment no-op, real transition concurrency, direct-catalog audited/idempotent bootstrap, provider-capability health verification, exclusive retry claims, no duplicate create, retry exhaustion/manual review, and admin retry validation",
  );
} finally {
  await flowDb?.$disconnect();
  await db.$executeRawUnsafe(
    `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`,
  );
  await db.$disconnect();
}
