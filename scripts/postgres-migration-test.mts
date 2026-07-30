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

import { PrismaClient } from "@prisma/client";

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

await copyThrough(
  migrationNames.filter((name) => name < multiProvider).at(-1)!,
);
await deploy();

const db = new PrismaClient({
  datasources: { db: { url: isolatedUrl } },
});
let flowDb: PrismaClient | null = null;
try {
  await db.$executeRawUnsafe(`
    UPDATE "ProviderPricingConfig"
    SET "markupBasisPoints" = 2500
    WHERE "provider" = 'PARSPACK'
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

  await db.$executeRawUnsafe(`
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
        'ACTIVE', 100, '{}', '[]', '{}',
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
  const valid = await db.$queryRawUnsafe<
    Array<{
      sessionState: string;
      orderState: string;
      sessionRevision: number;
      orderRevision: number;
      quoteStatus: string;
    }>
  >(`
    SELECT s."productFlowState" AS "sessionState",
           so."productFlowState" AS "orderState",
           s."productFlowRevision" AS "sessionRevision",
           so."productFlowRevision" AS "orderRevision",
           q.status::text AS "quoteStatus"
    FROM "RecommendationSession" s
    JOIN "RecommendationQuote" q ON q."sessionId" = s.id
    JOIN "ServiceOrder" so ON so."recommendationQuoteId" = q.id
    WHERE q.id = 'quote-valid'
  `);
  assert.equal(valid[0]?.sessionState, "AWAITING_PAYMENT");
  assert.equal(valid[0]?.orderState, "AWAITING_PAYMENT");
  assert.equal(valid[0]?.sessionRevision, valid[0]?.orderRevision);
  assert.equal(valid[0]?.quoteStatus, "ACTIVE");

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
    where: { idempotencyKey: { startsWith: "migration:legacy-" } },
  });
  await deploy();
  const auditAfter = await db.productFlowTransition.count({
    where: { idempotencyKey: { startsWith: "migration:legacy-" } },
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
  const { transitionProductFlow } = await import(
    "../lib/product-flow/service.ts"
  );
  const concurrent = await Promise.allSettled([
    transitionProductFlow({
      owner: { recommendationSessionId: "conversation-concurrency" },
      from: "DRAFT",
      to: "UNDERSTANDING_CONFIRMED",
      idempotencyKey: "pg-concurrency-a",
    }),
    transitionProductFlow({
      owner: { recommendationSessionId: "conversation-concurrency" },
      from: "DRAFT",
      to: "UNDERSTANDING_CONFIRMED",
      idempotencyKey: "pg-concurrency-b",
    }),
  ]);
  assert.deepEqual(
    concurrent.map((result) => result.status).sort(),
    ["fulfilled", "rejected"],
  );
  const conversation =
    await db.recommendationSession.findUniqueOrThrow({
      where: { id: "conversation-concurrency" },
      select: { revision: true, answers: true },
    });
  assert.equal(conversation.productFlowRevision, 1);
  console.log(
    "PostgreSQL migration integration passed: pricing backfill, legacy graph remediation, paid/ledger immutability, idempotent deploy, and real transition-service concurrency",
  );
} finally {
  await flowDb?.$disconnect();
  await db.$executeRawUnsafe(
    `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`,
  );
  await db.$disconnect();
}
