import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  AdminNotificationType,
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
import { allowAdminMobile } from "./test-admin-allowlist.mts";

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
const terminalRecovery =
  "20260730234500_terminal_order_recovery";
const multiOrderTerminalRecovery =
  "20260731003000_multi_order_terminal_recovery_v4";
const terminalAndWorkerRecoveryV5 =
  "20260731043000_terminal_and_worker_recovery_v5";
const terminalAndDispatchRecoveryV6 =
  "20260731120000_terminal_and_dispatch_recovery_v6";
const healthDispatchStarvationRecoveryV7 =
  "20260731200000_health_dispatch_starvation_recovery_v7";
const adminCatalogResilience =
  "20260801120000_admin_catalog_resilience";
const preprovisionedInventorySafety =
  "20260801210000_preprovisioned_inventory_safety";
const arvanSaleInventoryCredentials =
  "20260801230000_arvan_sale_inventory_credentials";
const skuMarkupAndManualPublication =
  "20260803113000_sku_markup_and_manual_publication";
const orderGatewayPayments = "20260803130000_order_gateway_payments";
const walletPaygBillingCore =
  "20260803150000_wallet_payg_billing_core";
const walletPaymentRecovery =
  "20260803160000_wallet_payment_recovery";
const usageBillingWorker =
  "20260803170000_usage_billing_worker";
const walletFirstActivation =
  "20260803180000_wallet_first_activation";

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
  await copyThrough(multiProvider);
  await deploy();

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
      'migration-catalog', 'ARVAN', 'tehran', 's1', 'S1',
      '["ubuntu"]', 2, 2048, 40, true, true,
      5000000, 'IRR', 'RIAL', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
      'v1', 'READY_INSTANT_SERVER', 's1',
      'arvan:v1:tehran:s1', 'ACTIVE', 5000000,
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
      'migration-plan', 'MIGRATION_PLAN', 'Migration Plan', 'ARVAN',
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
          'provider','ARVAN','providerApiVersion','v1',
          'productKind','READY_INSTANT_SERVER','region','tehran',
          'externalPlanId','s1','externalImageId','ubuntu',
          'externalNetworkId','provider-default',
          'externalSecurityId','provider-default',
          'accessMethod','ONE_TIME_PASSWORD','imageAssetId','legacy-image'
        )),
        6250000, 6250000, 'migration-catalog', 5000000, 2500,
        6250000, 'IRR', CURRENT_TIMESTAMP, 'ARVAN', 'v1',
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
        6250000, 'IRR', CURRENT_TIMESTAMP, 'ARVAN', 'v1',
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
        6250000, 'IRR', CURRENT_TIMESTAMP, 'ARVAN', 'v1',
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
        6250000, 'IRR', CURRENT_TIMESTAMP, 'ARVAN', 'v1',
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
        6250000, 'IRR', CURRENT_TIMESTAMP, 'ARVAN', 'v1',
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
       CURRENT_TIMESTAMP + INTERVAL '10 minutes', 'ARVAN', 'v1',
       'READY_INSTANT_SERVER', 'PARCHIN_START', 'DRAFT', NULL,
       CURRENT_TIMESTAMP),
      ('order-incomplete', 'migration-user', 'Incomplete', 6250000,
       'PENDING_PAYMENT', 'migration-plan', '{}', 'quote-incomplete',
       CURRENT_TIMESTAMP + INTERVAL '10 minutes', 'ARVAN', 'v1',
       'READY_INSTANT_SERVER', 'PARCHIN_START', 'AWAITING_PAYMENT', NULL,
       CURRENT_TIMESTAMP),
      ('order-expired', 'migration-user', 'Expired', 6250000,
       'PENDING_PAYMENT', 'migration-plan', '{}', 'quote-expired',
       CURRENT_TIMESTAMP - INTERVAL '10 minutes', 'ARVAN', 'v1',
       'READY_INSTANT_SERVER', 'PARCHIN_START', 'AWAITING_PAYMENT', NULL,
       CURRENT_TIMESTAMP),
      ('order-paid', 'migration-user', 'Paid', 6250000, 'PAID',
       'migration-plan', '{"immutable":"paid"}', 'quote-paid',
       CURRENT_TIMESTAMP - INTERVAL '1 hour', 'ARVAN', 'v1',
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
      'ARVAN', 'v1', 'READY_INSTANT_SERVER', 'PARCHIN_START',
      '{"immutable":"paid"}', 'DRAFT', 'MANAGED', 'QUEUED',
      5000000, CURRENT_TIMESTAMP
    );
  `);

  await executeStatements(db, `
    INSERT INTO "RecommendationSession" (
      id, "userId", status, answers, "answerSources",
      "productFlowState", "expiresAt", "createdAt", "updatedAt"
    ) VALUES
      (
        'legacy-refunded', 'migration-user', 'CONVERTED', '{}', '{}',
        'CANCELLED', CURRENT_TIMESTAMP + INTERVAL '1 hour',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      ),
      (
        'legacy-canceled', 'migration-user', 'CONVERTED', '{}', '{}',
        'CANCELLED', CURRENT_TIMESTAMP + INTERVAL '1 hour',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );

    INSERT INTO "RecommendationQuote"
    SELECT (
      jsonb_populate_record(
        NULL::"RecommendationQuote",
        to_jsonb(q) || jsonb_build_object(
          'id', 'quote-refunded',
          'sessionId', 'legacy-refunded',
          'role', 'RECOMMENDED',
          'status', 'SELECTED',
          'planSnapshot', '{"immutable":"refund-quote"}'::jsonb,
          'selectedAt', CURRENT_TIMESTAMP
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
          'id', 'quote-canceled',
          'sessionId', 'legacy-canceled',
          'role', 'RECOMMENDED',
          'status', 'SELECTED',
          'planSnapshot', '{"immutable":"cancel-quote"}'::jsonb,
          'selectedAt', CURRENT_TIMESTAMP
        )
      )
    ).*
    FROM "RecommendationQuote" q
    WHERE q.id = 'quote-valid';

    INSERT INTO "ServiceOrder" (
      id, "userId", title, amount, status, "planId", "planSnapshot",
      "recommendationQuoteId", "quoteExpiresAt", provider,
      "providerApiVersion", "productKind", "parchinLevel",
      "productFlowState", "paidAt", "updatedAt"
    ) VALUES
      (
        'order-refunded', 'migration-user', 'Refunded', 6250000,
        'REFUNDED', 'migration-plan', '{"immutable":"refund-order"}',
        'quote-refunded', CURRENT_TIMESTAMP + INTERVAL '10 minutes',
        'ARVAN', 'v1', 'READY_INSTANT_SERVER', 'PARCHIN_START',
        'CANCELLED', CURRENT_TIMESTAMP - INTERVAL '1 hour',
        CURRENT_TIMESTAMP
      ),
      (
        'order-canceled', 'migration-user', 'Canceled', 6250000,
        'CANCELED', 'migration-plan', '{"immutable":"cancel-order"}',
        'quote-canceled', CURRENT_TIMESTAMP + INTERVAL '10 minutes',
        'ARVAN', 'v1', 'READY_INSTANT_SERVER', 'PARCHIN_START',
        'CANCELLED', NULL, CURRENT_TIMESTAMP
      );

    INSERT INTO "InfrastructureOrder" (
      id, "serviceOrderId", "userId", "planId", provider,
      "providerApiVersion", "productKind", "parchinLevel",
      "providerSelectionSnapshot", "productFlowState",
      "deliveryMode", status, "requiredFundingRial", "updatedAt"
    ) VALUES
      (
        'infra-refunded', 'order-refunded', 'migration-user',
        'migration-plan', 'ARVAN', 'v1',
        'READY_INSTANT_SERVER', 'PARCHIN_START',
        '{"immutable":"refund-provider"}', 'CANCELLED',
        'MANAGED', 'REFUNDED', 5000000, CURRENT_TIMESTAMP
      ),
      (
        'infra-canceled', 'order-canceled', 'migration-user',
        'migration-plan', 'ARVAN', 'v1',
        'READY_INSTANT_SERVER', 'PARCHIN_START',
        '{"immutable":"cancel-provider"}', 'CANCELLED',
        'MANAGED', 'CANCELED', 5000000, CURRENT_TIMESTAMP
      );

    INSERT INTO "WalletLedgerEntry" (
      id, "walletId", direction, type, amount, status,
      "referenceType", "referenceId", "idempotencyKey",
      "balanceAfter", "reversedEntryId", metadata
    ) VALUES
      (
        'ledger-refund-debit', 'migration-wallet', 'DEBIT',
        'SERVICE_PURCHASE', 6250000, 'COMPLETED', 'order',
        'order-refunded', 'order_pay_order-refunded', 2750000,
        NULL, '{"immutable":"refund-debit"}'
      ),
      (
        'ledger-refund-credit', 'migration-wallet', 'CREDIT',
        'REFUND', 6250000, 'COMPLETED', 'ledger',
        'ledger-refund-debit', 'order_refund_order-refunded',
        9000000, 'ledger-refund-debit',
        '{"immutable":"refund-credit"}'
      );
  `);

  const terminalFinancialBefore = await db.$queryRawUnsafe<
    Array<{
      walletBalance: bigint;
      ledgerSnapshot: unknown;
      orderSnapshot: unknown;
      quoteSnapshot: unknown;
      providerSnapshot: unknown;
    }>
  >(`
    SELECT
      wallet."availableBalance" AS "walletBalance",
      (
        SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry.id)
        FROM "WalletLedgerEntry" entry
        WHERE entry.id IN (
          'ledger-refund-debit',
          'ledger-refund-credit'
        )
      ) AS "ledgerSnapshot",
      jsonb_build_object(
        'amount', so.amount,
        'currency', so.currency,
        'planSnapshot', so."planSnapshot",
        'paidAt', so."paidAt"
      ) AS "orderSnapshot",
      jsonb_build_object(
        'amountRial', quote."amountRial",
        'renewalAmountRial', quote."renewalAmountRial",
        'providerBasePriceRialSnapshot',
          quote."providerBasePriceRialSnapshot",
        'finalPriceRialSnapshot',
          quote."finalPriceRialSnapshot",
        'lineItemsSnapshot', quote."lineItemsSnapshot",
        'planSnapshot', quote."planSnapshot"
      ) AS "quoteSnapshot",
      io."providerSelectionSnapshot" AS "providerSnapshot"
    FROM "ServiceOrder" so
    JOIN "RecommendationQuote" quote
      ON quote.id = so."recommendationQuoteId"
    JOIN "InfrastructureOrder" io
      ON io."serviceOrderId" = so.id
    JOIN "Wallet" wallet ON wallet.id = 'migration-wallet'
    WHERE so.id = 'order-refunded'
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
  const terminalAfterV2 = await db.serviceOrder.findMany({
    where: {
      id: { in: ["order-refunded", "order-canceled"] },
    },
    orderBy: { id: "asc" },
    select: { id: true, status: true },
  });
  assert.deepEqual(terminalAfterV2, [
    { id: "order-canceled", status: ServiceOrderStatus.DRAFT },
    { id: "order-refunded", status: ServiceOrderStatus.DRAFT },
  ]);

  await executeStatements(db, `
    INSERT INTO "RecommendationSession" (
      id, "userId", status, answers, "answerSources",
      "productFlowState", "productFlowRevision",
      "expiresAt", "createdAt", "updatedAt"
    ) VALUES
      (
        'v4-mixed-refund-paid', 'migration-user', 'CONVERTED',
        '{}', '{}', 'ACTIVE', 10,
        CURRENT_TIMESTAMP + INTERVAL '1 hour',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      ),
      (
        'v4-mixed-cancel-pending', 'migration-user', 'CHECKOUT',
        '{}', '{}', 'AWAITING_PAYMENT', 12,
        CURRENT_TIMESTAMP + INTERVAL '1 hour',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      ),
      (
        'v4-all-terminal', 'migration-user', 'CONVERTED',
        '{}', '{}', 'PAID', 4,
        CURRENT_TIMESTAMP + INTERVAL '1 hour',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      ),
      (
        'v4-all-terminal-correct', 'migration-user', 'CONVERTED',
        '{}', '{}', 'CANCELLED', 20,
        CURRENT_TIMESTAMP + INTERVAL '1 hour',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      ),
      (
        'v4-live-conflict', 'migration-user', 'CONVERTED',
        '{}', '{}', 'ACTIVE', 30,
        CURRENT_TIMESTAMP + INTERVAL '1 hour',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );

    INSERT INTO "RecommendationQuote"
    SELECT (
      jsonb_populate_record(
        NULL::"RecommendationQuote",
        to_jsonb(template) || jsonb_build_object(
          'id', seed.id,
          'sessionId', seed."sessionId",
          'status', seed.status,
          'role', seed.role,
          'planSnapshot', jsonb_build_object(
            'immutable', seed.id
          ),
          'selectedAt', CURRENT_TIMESTAMP
        )
      )
    ).*
    FROM "RecommendationQuote" template
    CROSS JOIN (
      VALUES
        (
          'v4-quote-refund', 'v4-mixed-refund-paid',
          'SELECTED', 'RECOMMENDED'
        ),
        (
          'v4-quote-paid', 'v4-mixed-refund-paid',
          'CONVERTED', 'GROWTH'
        ),
        (
          'v4-quote-cancel', 'v4-mixed-cancel-pending',
          'SELECTED', 'RECOMMENDED'
        ),
        (
          'v4-quote-pending', 'v4-mixed-cancel-pending',
          'SELECTED', 'GROWTH'
        ),
        (
          'v4-quote-terminal-a', 'v4-all-terminal',
          'CONVERTED', 'RECOMMENDED'
        ),
        (
          'v4-quote-terminal-b', 'v4-all-terminal',
          'CONVERTED', 'GROWTH'
        ),
        (
          'v4-quote-correct-a', 'v4-all-terminal-correct',
          'CONVERTED', 'RECOMMENDED'
        ),
        (
          'v4-quote-correct-b', 'v4-all-terminal-correct',
          'CONVERTED', 'GROWTH'
        ),
        (
          'v4-quote-conflict-refund', 'v4-live-conflict',
          'CONVERTED', 'RECOMMENDED'
        ),
        (
          'v4-quote-conflict-paid', 'v4-live-conflict',
          'CONVERTED', 'GROWTH'
        ),
        (
          'v4-quote-conflict-pending', 'v4-live-conflict',
          'SELECTED', 'ECONOMY'
        )
    ) AS seed(id, "sessionId", status, role)
    WHERE template.id = 'quote-valid';

    INSERT INTO "ServiceOrder" (
      id, "userId", title, amount, status, "planId",
      "planSnapshot", "recommendationQuoteId", "quoteExpiresAt",
      provider, "providerApiVersion", "productKind", "parchinLevel",
      "productFlowState", "productFlowRevision", "paidAt", "updatedAt"
    ) VALUES
      (
        'v4-order-refund', 'migration-user', 'V4 Refund', 6250000,
        'REFUNDED', 'migration-plan', '{"immutable":"v4-refund"}',
        'v4-quote-refund', CURRENT_TIMESTAMP, 'ARVAN', 'v1',
        'READY_INSTANT_SERVER', 'PARCHIN_START', 'CANCELLED', 4,
        CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP
      ),
      (
        'v4-order-paid', 'migration-user', 'V4 Paid', 6250000,
        'PAID', 'migration-plan', '{"immutable":"v4-paid"}',
        'v4-quote-paid', CURRENT_TIMESTAMP, 'ARVAN', 'v1',
        'READY_INSTANT_SERVER', 'PARCHIN_START', 'ACTIVE', 10,
        CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP
      ),
      (
        'v4-order-cancel', 'migration-user', 'V4 Cancel', 6250000,
        'CANCELED', 'migration-plan', '{"immutable":"v4-cancel"}',
        'v4-quote-cancel', CURRENT_TIMESTAMP, 'ARVAN', 'v1',
        'READY_INSTANT_SERVER', 'PARCHIN_START', 'CANCELLED', 5,
        NULL, CURRENT_TIMESTAMP
      ),
      (
        'v4-order-pending', 'migration-user', 'V4 Pending', 6250000,
        'PENDING_PAYMENT', 'migration-plan',
        '{"immutable":"v4-pending"}', 'v4-quote-pending',
        CURRENT_TIMESTAMP + INTERVAL '10 minutes', 'ARVAN', 'v1',
        'READY_INSTANT_SERVER', 'PARCHIN_START',
        'AWAITING_PAYMENT', 12, NULL, CURRENT_TIMESTAMP
      ),
      (
        'v4-order-terminal-a', 'migration-user', 'V4 Terminal A',
        6250000, 'REFUNDED', 'migration-plan',
        '{"immutable":"v4-terminal-a"}', 'v4-quote-terminal-a',
        CURRENT_TIMESTAMP, 'ARVAN', 'v1',
        'READY_INSTANT_SERVER', 'PARCHIN_START', 'CANCELLED', 7,
        CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP
      ),
      (
        'v4-order-terminal-b', 'migration-user', 'V4 Terminal B',
        6250000, 'CANCELED', 'migration-plan',
        '{"immutable":"v4-terminal-b"}', 'v4-quote-terminal-b',
        CURRENT_TIMESTAMP, 'ARVAN', 'v1',
        'READY_INSTANT_SERVER', 'PARCHIN_START', 'CANCELLED', 9,
        NULL, CURRENT_TIMESTAMP
      ),
      (
        'v4-order-correct-a', 'migration-user', 'V4 Correct A',
        6250000, 'REFUNDED', 'migration-plan', '{}',
        'v4-quote-correct-a', CURRENT_TIMESTAMP, 'ARVAN', 'v1',
        'READY_INSTANT_SERVER', 'PARCHIN_START', 'CANCELLED', 20,
        CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP
      ),
      (
        'v4-order-correct-b', 'migration-user', 'V4 Correct B',
        6250000, 'CANCELED', 'migration-plan', '{}',
        'v4-quote-correct-b', CURRENT_TIMESTAMP, 'ARVAN', 'v1',
        'READY_INSTANT_SERVER', 'PARCHIN_START', 'CANCELLED', 20,
        NULL, CURRENT_TIMESTAMP
      ),
      (
        'v4-order-conflict-refund', 'migration-user',
        'V4 Conflict Refund', 6250000, 'REFUNDED',
        'migration-plan', '{}', 'v4-quote-conflict-refund',
        CURRENT_TIMESTAMP, 'ARVAN', 'v1',
        'READY_INSTANT_SERVER', 'PARCHIN_START', 'CANCELLED', 3,
        CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP
      ),
      (
        'v4-order-conflict-paid', 'migration-user',
        'V4 Conflict Paid', 6250000, 'PAID',
        'migration-plan', '{}', 'v4-quote-conflict-paid',
        CURRENT_TIMESTAMP, 'ARVAN', 'v1',
        'READY_INSTANT_SERVER', 'PARCHIN_START', 'ACTIVE', 30,
        CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP
      ),
      (
        'v4-order-conflict-pending', 'migration-user',
        'V4 Conflict Pending', 6250000, 'PENDING_PAYMENT',
        'migration-plan', '{}', 'v4-quote-conflict-pending',
        CURRENT_TIMESTAMP, 'ARVAN', 'v1',
        'READY_INSTANT_SERVER', 'PARCHIN_START',
        'AWAITING_PAYMENT', 31, NULL, CURRENT_TIMESTAMP
      );

    INSERT INTO "InfrastructureOrder" (
      id, "serviceOrderId", "userId", "planId", provider,
      "providerApiVersion", "productKind", "parchinLevel",
      "providerSelectionSnapshot", "productFlowState",
      "productFlowRevision", "deliveryMode", status,
      "requiredFundingRial", "updatedAt"
    ) VALUES
      (
        'v4-infra-refund', 'v4-order-refund', 'migration-user',
        'migration-plan', 'ARVAN', 'v1',
        'READY_INSTANT_SERVER', 'PARCHIN_START',
        '{"immutable":"v4-refund-provider"}', 'CANCELLED', 4,
        'MANAGED', 'REFUNDED', 5000000, CURRENT_TIMESTAMP
      ),
      (
        'v4-infra-paid', 'v4-order-paid', 'migration-user',
        'migration-plan', 'ARVAN', 'v1',
        'READY_INSTANT_SERVER', 'PARCHIN_START',
        '{"immutable":"v4-paid-provider"}', 'ACTIVE', 10,
        'MANAGED', 'ACTIVE', 5000000, CURRENT_TIMESTAMP
      ),
      (
        'v4-infra-cancel', 'v4-order-cancel', 'migration-user',
        'migration-plan', 'ARVAN', 'v1',
        'READY_INSTANT_SERVER', 'PARCHIN_START', '{}',
        'CANCELLED', 5, 'MANAGED', 'CANCELED', 5000000,
        CURRENT_TIMESTAMP
      ),
      (
        'v4-infra-terminal-a', 'v4-order-terminal-a',
        'migration-user', 'migration-plan', 'ARVAN', 'v1',
        'READY_INSTANT_SERVER', 'PARCHIN_START', '{}',
        'CANCELLED', 7, 'MANAGED', 'REFUNDED', 5000000,
        CURRENT_TIMESTAMP
      ),
      (
        'v4-infra-terminal-b', 'v4-order-terminal-b',
        'migration-user', 'migration-plan', 'ARVAN', 'v1',
        'READY_INSTANT_SERVER', 'PARCHIN_START', '{}',
        'CANCELLED', 9, 'MANAGED', 'CANCELED', 5000000,
        CURRENT_TIMESTAMP
      ),
      (
        'v4-infra-correct-a', 'v4-order-correct-a',
        'migration-user', 'migration-plan', 'ARVAN', 'v1',
        'READY_INSTANT_SERVER', 'PARCHIN_START', '{}',
        'CANCELLED', 20, 'MANAGED', 'REFUNDED', 5000000,
        CURRENT_TIMESTAMP
      ),
      (
        'v4-infra-correct-b', 'v4-order-correct-b',
        'migration-user', 'migration-plan', 'ARVAN', 'v1',
        'READY_INSTANT_SERVER', 'PARCHIN_START', '{}',
        'CANCELLED', 20, 'MANAGED', 'CANCELED', 5000000,
        CURRENT_TIMESTAMP
      ),
      (
        'v4-infra-conflict-refund', 'v4-order-conflict-refund',
        'migration-user', 'migration-plan', 'ARVAN', 'v1',
        'READY_INSTANT_SERVER', 'PARCHIN_START', '{}',
        'CANCELLED', 3, 'MANAGED', 'REFUNDED', 5000000,
        CURRENT_TIMESTAMP
      ),
      (
        'v4-infra-conflict-paid', 'v4-order-conflict-paid',
        'migration-user', 'migration-plan', 'ARVAN', 'v1',
        'READY_INSTANT_SERVER', 'PARCHIN_START', '{}',
        'ACTIVE', 30, 'MANAGED', 'ACTIVE', 5000000,
        CURRENT_TIMESTAMP
      );

    INSERT INTO "WalletLedgerEntry" (
      id, "walletId", direction, type, amount, status,
      "referenceType", "referenceId", "idempotencyKey",
      "balanceAfter", "reversedEntryId", metadata
    ) VALUES
      (
        'v4-ledger-refund-debit', 'migration-wallet', 'DEBIT',
        'SERVICE_PURCHASE', 6250000, 'COMPLETED', 'order',
        'v4-order-refund', 'v4-pay-refund', 2750000, NULL,
        '{"immutable":"v4-debit"}'
      ),
      (
        'v4-ledger-refund-credit', 'migration-wallet', 'CREDIT',
        'REFUND', 6250000, 'COMPLETED', 'ledger',
        'v4-ledger-refund-debit', 'v4-refund-credit', 9000000,
        'v4-ledger-refund-debit', '{"immutable":"v4-credit"}'
      ),
      (
        'v4-ledger-terminal-debit', 'migration-wallet', 'DEBIT',
        'SERVICE_PURCHASE', 6250000, 'COMPLETED', 'order',
        'v4-order-terminal-a', 'v4-pay-terminal', 2750000, NULL,
        '{}'
      ),
      (
        'v4-ledger-terminal-credit', 'migration-wallet', 'CREDIT',
        'REFUND', 6250000, 'COMPLETED', 'ledger',
        'v4-ledger-terminal-debit', 'v4-refund-terminal', 9000000,
        'v4-ledger-terminal-debit', '{}'
      ),
      (
        'v4-ledger-correct-debit', 'migration-wallet', 'DEBIT',
        'SERVICE_PURCHASE', 6250000, 'COMPLETED', 'order',
        'v4-order-correct-a', 'v4-pay-correct', 2750000, NULL, '{}'
      ),
      (
        'v4-ledger-correct-credit', 'migration-wallet', 'CREDIT',
        'REFUND', 6250000, 'COMPLETED', 'ledger',
        'v4-ledger-correct-debit', 'v4-refund-correct', 9000000,
        'v4-ledger-correct-debit', '{}'
      ),
      (
        'v4-ledger-conflict-debit', 'migration-wallet', 'DEBIT',
        'SERVICE_PURCHASE', 6250000, 'COMPLETED', 'order',
        'v4-order-conflict-refund', 'v4-pay-conflict', 2750000,
        NULL, '{}'
      ),
      (
        'v4-ledger-conflict-credit', 'migration-wallet', 'CREDIT',
        'REFUND', 6250000, 'COMPLETED', 'ledger',
        'v4-ledger-conflict-debit', 'v4-refund-conflict', 9000000,
        'v4-ledger-conflict-debit', '{}'
      );
  `);

  const v4FinancialBefore = await db.$queryRawUnsafe<
    Array<{
      walletBalance: bigint;
      ledgerSnapshot: unknown;
      paidOrderSnapshot: unknown;
      paidQuoteSnapshot: unknown;
      paidProviderSnapshot: unknown;
    }>
  >(`
    SELECT
      wallet."availableBalance" AS "walletBalance",
      (
        SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry.id)
        FROM "WalletLedgerEntry" entry
        WHERE entry.id LIKE 'v4-ledger-%'
      ) AS "ledgerSnapshot",
      jsonb_build_object(
        'amount', paid.amount,
        'paidAt', paid."paidAt",
        'planSnapshot', paid."planSnapshot"
      ) AS "paidOrderSnapshot",
      jsonb_build_object(
        'amountRial', quote."amountRial",
        'renewalAmountRial', quote."renewalAmountRial",
        'providerBasePriceRialSnapshot',
          quote."providerBasePriceRialSnapshot",
        'finalPriceRialSnapshot', quote."finalPriceRialSnapshot",
        'lineItemsSnapshot', quote."lineItemsSnapshot",
        'planSnapshot', quote."planSnapshot"
      ) AS "paidQuoteSnapshot",
      infra."providerSelectionSnapshot" AS "paidProviderSnapshot"
    FROM "Wallet" wallet
    JOIN "ServiceOrder" paid ON paid.id = 'v4-order-paid'
    JOIN "RecommendationQuote" quote
      ON quote.id = paid."recommendationQuoteId"
    JOIN "InfrastructureOrder" infra
      ON infra."serviceOrderId" = paid.id
    WHERE wallet.id = 'migration-wallet'
  `);

  await copyThrough(terminalRecovery);
  await deploy();
  const v3MixedSessionDamage = await db.$queryRawUnsafe<
    Array<{ id: string; state: string }>
  >(`
    SELECT id, "productFlowState" AS state
    FROM "RecommendationSession"
    WHERE id IN (
      'v4-mixed-refund-paid',
      'v4-mixed-cancel-pending'
    )
    ORDER BY id
  `);
  assert.deepEqual(v3MixedSessionDamage, [
    { id: "v4-mixed-cancel-pending", state: "CANCELLED" },
    { id: "v4-mixed-refund-paid", state: "CANCELLED" },
  ]);

  await copyThrough(multiOrderTerminalRecovery);
  await deploy();

  const v4MixedGraphs = await db.$queryRawUnsafe<
    Array<{
      sessionId: string;
      sessionState: string;
      sessionRevision: number;
      serviceOrderId: string;
      serviceStatus: string;
      serviceState: string;
      serviceRevision: number;
      infrastructureState: string | null;
      infrastructureRevision: number | null;
    }>
  >(`
    SELECT
      session.id AS "sessionId",
      session."productFlowState" AS "sessionState",
      session."productFlowRevision" AS "sessionRevision",
      so.id AS "serviceOrderId",
      so.status::text AS "serviceStatus",
      so."productFlowState" AS "serviceState",
      so."productFlowRevision" AS "serviceRevision",
      io."productFlowState" AS "infrastructureState",
      io."productFlowRevision" AS "infrastructureRevision"
    FROM "RecommendationSession" session
    JOIN "RecommendationQuote" quote
      ON quote."sessionId" = session.id
    JOIN "ServiceOrder" so
      ON so."recommendationQuoteId" = quote.id
    LEFT JOIN "InfrastructureOrder" io
      ON io."serviceOrderId" = so.id
    WHERE session.id IN (
      'v4-mixed-refund-paid',
      'v4-mixed-cancel-pending'
    )
    ORDER BY session.id, so.id
  `);
  assert.deepEqual(v4MixedGraphs, [
    {
      sessionId: "v4-mixed-cancel-pending",
      sessionState: "AWAITING_PAYMENT",
      sessionRevision: 12,
      serviceOrderId: "v4-order-cancel",
      serviceStatus: "CANCELED",
      serviceState: "CANCELLED",
      serviceRevision: 13,
      infrastructureState: "CANCELLED",
      infrastructureRevision: 13,
    },
    {
      sessionId: "v4-mixed-cancel-pending",
      sessionState: "AWAITING_PAYMENT",
      sessionRevision: 12,
      serviceOrderId: "v4-order-pending",
      serviceStatus: "PENDING_PAYMENT",
      serviceState: "AWAITING_PAYMENT",
      serviceRevision: 12,
      infrastructureState: null,
      infrastructureRevision: null,
    },
    {
      sessionId: "v4-mixed-refund-paid",
      sessionState: "ACTIVE",
      sessionRevision: 10,
      serviceOrderId: "v4-order-paid",
      serviceStatus: "PAID",
      serviceState: "ACTIVE",
      serviceRevision: 10,
      infrastructureState: "ACTIVE",
      infrastructureRevision: 10,
    },
    {
      sessionId: "v4-mixed-refund-paid",
      sessionState: "ACTIVE",
      sessionRevision: 10,
      serviceOrderId: "v4-order-refund",
      serviceStatus: "REFUNDED",
      serviceState: "CANCELLED",
      serviceRevision: 11,
      infrastructureState: "CANCELLED",
      infrastructureRevision: 11,
    },
  ]);

  const v4AllTerminal = await db.$queryRawUnsafe<
    Array<{
      sessionId: string;
      sessionState: string;
      sessionRevision: number;
      serviceState: string;
      serviceRevision: number;
      infrastructureState: string;
      infrastructureRevision: number;
    }>
  >(`
    SELECT
      session.id AS "sessionId",
      session."productFlowState" AS "sessionState",
      session."productFlowRevision" AS "sessionRevision",
      so."productFlowState" AS "serviceState",
      so."productFlowRevision" AS "serviceRevision",
      io."productFlowState" AS "infrastructureState",
      io."productFlowRevision" AS "infrastructureRevision"
    FROM "RecommendationSession" session
    JOIN "RecommendationQuote" quote
      ON quote."sessionId" = session.id
    JOIN "ServiceOrder" so
      ON so."recommendationQuoteId" = quote.id
    JOIN "InfrastructureOrder" io
      ON io."serviceOrderId" = so.id
    WHERE session.id = 'v4-all-terminal'
    ORDER BY so.id
  `);
  assert.equal(v4AllTerminal.length, 2);
  assert.ok(
    v4AllTerminal.every(
      (row) =>
        row.sessionState === "CANCELLED" &&
        row.serviceState === "CANCELLED" &&
        row.infrastructureState === "CANCELLED" &&
        row.sessionRevision === row.serviceRevision &&
        row.sessionRevision === row.infrastructureRevision,
    ),
  );

  const v4CorrectTransitionCount = await db.$queryRawUnsafe<
    Array<{ count: bigint }>
  >(`
    SELECT count(*) AS count
    FROM "ProductFlowTransition"
    WHERE "idempotencyKey" LIKE 'migration:v4:%'
      AND (
        "recommendationSessionId" = 'v4-all-terminal-correct'
        OR "serviceOrderId" IN (
          'v4-order-correct-a',
          'v4-order-correct-b'
        )
      )
  `);
  assert.equal(v4CorrectTransitionCount[0]?.count, 0n);

  const v4Conflict = await db.$queryRawUnsafe<
    Array<{
      state: string;
      revision: number;
      cases: bigint;
    }>
  >(`
    SELECT
      session."productFlowState" AS state,
      session."productFlowRevision" AS revision,
      (
        SELECT count(*)
        FROM "ProductFlowRemediationCase" remediation
        WHERE remediation."recommendationSessionId" = session.id
          AND remediation.reason =
            'multi_order_non_terminal_graph_conflict'
      ) AS cases
    FROM "RecommendationSession" session
    WHERE session.id = 'v4-live-conflict'
  `);
  assert.deepEqual(v4Conflict, [
    { state: "CANCELLED", revision: 31, cases: 1n },
  ]);

  const v4FinancialAfter = await db.$queryRawUnsafe<
    typeof v4FinancialBefore
  >(`
    SELECT
      wallet."availableBalance" AS "walletBalance",
      (
        SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry.id)
        FROM "WalletLedgerEntry" entry
        WHERE entry.id LIKE 'v4-ledger-%'
      ) AS "ledgerSnapshot",
      jsonb_build_object(
        'amount', paid.amount,
        'paidAt', paid."paidAt",
        'planSnapshot', paid."planSnapshot"
      ) AS "paidOrderSnapshot",
      jsonb_build_object(
        'amountRial', quote."amountRial",
        'renewalAmountRial', quote."renewalAmountRial",
        'providerBasePriceRialSnapshot',
          quote."providerBasePriceRialSnapshot",
        'finalPriceRialSnapshot', quote."finalPriceRialSnapshot",
        'lineItemsSnapshot', quote."lineItemsSnapshot",
        'planSnapshot', quote."planSnapshot"
      ) AS "paidQuoteSnapshot",
      infra."providerSelectionSnapshot" AS "paidProviderSnapshot"
    FROM "Wallet" wallet
    JOIN "ServiceOrder" paid ON paid.id = 'v4-order-paid'
    JOIN "RecommendationQuote" quote
      ON quote.id = paid."recommendationQuoteId"
    JOIN "InfrastructureOrder" infra
      ON infra."serviceOrderId" = paid.id
    WHERE wallet.id = 'migration-wallet'
  `);
  assert.deepEqual(v4FinancialAfter, v4FinancialBefore);

  const v4RegressionEvidence = await db.$queryRawUnsafe<
    Array<{
      sessionId: string;
      fromRevision: number;
      toRevision: number;
      currentRevision: number;
    }>
  >(`
    SELECT
      transition."recommendationSessionId" AS "sessionId",
      transition."fromRevision",
      transition."toRevision",
      session."productFlowRevision" AS "currentRevision"
    FROM "ProductFlowTransition" transition
    JOIN "RecommendationSession" session
      ON session.id = transition."recommendationSessionId"
    WHERE transition."idempotencyKey" IN (
      'migration:v4:session-restore:v4-mixed-refund-paid',
      'migration:v4:session-restore:v4-mixed-cancel-pending'
    )
    ORDER BY transition."recommendationSessionId"
  `);
  assert.equal(v4RegressionEvidence.length, 2);
  assert.ok(
    v4RegressionEvidence.every(
      (row) =>
        row.toRevision <= row.fromRevision &&
        row.currentRevision === row.toRevision,
    ),
  );

  await executeStatements(db, `
    INSERT INTO "RecommendationSession" (
      id, "userId", status, answers, "answerSources",
      "productFlowState", "productFlowRevision",
      "expiresAt", "createdAt", "updatedAt"
    ) VALUES (
      'v5-semantic-invalid', 'migration-user', 'CHECKOUT',
      '{}', '{}', 'ACTIVE', 44,
      CURRENT_TIMESTAMP + INTERVAL '1 hour',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );

    INSERT INTO "RecommendationQuote"
    SELECT (
      jsonb_populate_record(
        NULL::"RecommendationQuote",
        to_jsonb(template) || jsonb_build_object(
          'id', 'v5-quote-semantic-invalid',
          'sessionId', 'v5-semantic-invalid',
          'status', 'SELECTED',
          'role', 'RECOMMENDED'
        )
      )
    ).*
    FROM "RecommendationQuote" template
    WHERE template.id = 'quote-valid';

    INSERT INTO "ServiceOrder" (
      id, "userId", title, amount, status, "planId",
      "planSnapshot", "recommendationQuoteId", "quoteExpiresAt",
      provider, "providerApiVersion", "productKind", "parchinLevel",
      "productFlowState", "productFlowRevision", "updatedAt"
    ) VALUES (
      'v5-order-semantic-invalid', 'migration-user',
      'Semantic invalid', 6250000, 'PENDING_PAYMENT',
      'migration-plan', '{"immutable":"semantic-invalid"}',
      'v5-quote-semantic-invalid',
      CURRENT_TIMESTAMP + INTERVAL '10 minutes',
      'ARVAN', 'v1', 'READY_INSTANT_SERVER',
      'PARCHIN_START', 'ACTIVE', 44, CURRENT_TIMESTAMP
    );

    INSERT INTO "RecommendationSession" (
      id, "userId", status, answers, "answerSources",
      "productFlowState", "productFlowRevision",
      "expiresAt", "createdAt", "updatedAt"
    ) VALUES (
      'v6-payment-review', 'migration-user', 'CHECKOUT', '{}', '{}',
      'PAYMENT_REVIEW', 6,
      CURRENT_TIMESTAMP + INTERVAL '1 hour',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );

    INSERT INTO "RecommendationQuote"
    SELECT (
      jsonb_populate_record(
        NULL::"RecommendationQuote",
        to_jsonb(template) || jsonb_build_object(
          'id', 'v6-quote-payment-review',
          'sessionId', 'v6-payment-review',
          'status', 'SELECTED',
          'role', 'RECOMMENDED',
          'planSnapshot', jsonb_build_object(
            'immutable', 'v6-payment-review-financial-provider-snapshot'
          )
        )
      )
    ).*
    FROM "RecommendationQuote" template
    WHERE template.id = 'quote-valid';

    INSERT INTO "ServiceOrder" (
      id, "userId", title, amount, status, "planId",
      "planSnapshot", "recommendationQuoteId", "quoteExpiresAt",
      provider, "providerApiVersion", "productKind", "parchinLevel",
      "productFlowState", "productFlowRevision", "updatedAt"
    ) VALUES (
      'v6-order-payment-review', 'migration-user',
      'Payment review valid runtime graph', 6250000,
      'PENDING_PAYMENT', 'migration-plan',
      '{"immutable":"v6-service-order-snapshot"}',
      'v6-quote-payment-review',
      CURRENT_TIMESTAMP + INTERVAL '10 minutes',
      'ARVAN', 'v1', 'READY_INSTANT_SERVER',
      'PARCHIN_START', 'PAYMENT_REVIEW', 6, CURRENT_TIMESTAMP
    );

    INSERT INTO "ProductFlowTransition" (
      id, "recommendationSessionId", "serviceOrderId",
      "fromState", "toState", reason, "idempotencyKey",
      "ownerFingerprint", "fromRevision", "toRevision"
    ) VALUES
      (
        'migration:v4:session-restore:v6-payment-review',
        'v6-payment-review', NULL, 'AWAITING_PAYMENT',
        'AWAITING_PAYMENT', 'v4_live_sibling_graph_restored',
        'migration:v4:session-restore:v6-payment-review',
        'v6-payment-review:-:-', 20, 5
      ),
      (
        'v6-runtime-payment-review', 'v6-payment-review',
        'v6-order-payment-review', 'AWAITING_PAYMENT',
        'PAYMENT_REVIEW', 'payment_requires_review',
        'v6-runtime-payment-review',
        'v6-payment-review:v6-order-payment-review:-', 5, 6
      );

    INSERT INTO "RecommendationSession" (
      id, "userId", status, answers, "answerSources",
      "productFlowState", "productFlowRevision",
      "expiresAt", "createdAt", "updatedAt"
    ) VALUES (
      'v6-quote-expired', 'migration-user', 'CHECKOUT', '{}', '{}',
      'QUOTE_EXPIRED', 9,
      CURRENT_TIMESTAMP + INTERVAL '1 hour',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );

    INSERT INTO "RecommendationQuote"
    SELECT (
      jsonb_populate_record(
        NULL::"RecommendationQuote",
        to_jsonb(template) || jsonb_build_object(
          'id', 'v6-quote-expired-quote',
          'sessionId', 'v6-quote-expired',
          'status', 'EXPIRED',
          'role', 'RECOMMENDED'
        )
      )
    ).*
    FROM "RecommendationQuote" template
    WHERE template.id = 'quote-valid';

    INSERT INTO "ServiceOrder" (
      id, "userId", title, amount, status, "planId",
      "planSnapshot", "recommendationQuoteId", "quoteExpiresAt",
      provider, "providerApiVersion", "productKind", "parchinLevel",
      "productFlowState", "productFlowRevision", "updatedAt"
    ) VALUES (
      'v6-order-quote-expired', 'migration-user',
      'Quote expired valid runtime graph', 6250000,
      'PENDING_PAYMENT', 'migration-plan',
      '{"immutable":"v6-quote-expired-service-snapshot"}',
      'v6-quote-expired-quote',
      CURRENT_TIMESTAMP - INTERVAL '1 minute',
      'ARVAN', 'v1', 'READY_INSTANT_SERVER',
      'PARCHIN_START', 'QUOTE_EXPIRED', 9, CURRENT_TIMESTAMP
    );
  `);

  await copyThrough(terminalAndWorkerRecoveryV5);
  await deploy();

  const v5Repaired = await db.$queryRawUnsafe<
    Array<{
      sessionId: string;
      sessionRevision: number;
      serviceRevision: number;
      infrastructureRevision: number | null;
      maxPreviousRevision: number;
    }>
  >(`
    SELECT
      session.id AS "sessionId",
      session."productFlowRevision" AS "sessionRevision",
      service_order."productFlowRevision" AS "serviceRevision",
      infrastructure_order."productFlowRevision"
        AS "infrastructureRevision",
      greatest(
        v4_transition."fromRevision",
        v4_transition."toRevision"
      ) AS "maxPreviousRevision"
    FROM "RecommendationSession" session
    JOIN "RecommendationQuote" quote
      ON quote."sessionId" = session.id
    JOIN "ServiceOrder" service_order
      ON service_order."recommendationQuoteId" = quote.id
     AND service_order.status NOT IN ('REFUNDED', 'CANCELED')
    LEFT JOIN "InfrastructureOrder" infrastructure_order
      ON infrastructure_order."serviceOrderId" = service_order.id
    JOIN "ProductFlowTransition" v4_transition
      ON v4_transition."idempotencyKey" =
        'migration:v4:session-restore:' || session.id
    WHERE session.id IN (
      'v4-mixed-refund-paid',
      'v4-mixed-cancel-pending'
    )
    ORDER BY session.id
  `);
  assert.equal(v5Repaired.length, 2);
  assert.ok(
    v5Repaired.every(
      (row) =>
        row.sessionRevision > row.maxPreviousRevision &&
        row.serviceRevision === row.sessionRevision &&
        (row.infrastructureRevision == null ||
          row.infrastructureRevision === row.sessionRevision),
    ),
  );
  const invalidRepairTransitions =
    await db.productFlowTransition.count({
      where: {
        idempotencyKey: {
          startsWith: "migration:v5:",
        },
        toRevision: { lte: 0 },
      },
    });
  assert.equal(invalidRepairTransitions, 0);
  const nonIncreasingV5 = await db.$queryRawUnsafe<
    Array<{ count: bigint }>
  >(`
    SELECT count(*) AS count
    FROM "ProductFlowTransition"
    WHERE "idempotencyKey" LIKE 'migration:v5:%'
      AND "toRevision" <= "fromRevision"
  `);
  assert.equal(nonIncreasingV5[0]?.count, 0n);
  const semanticCase =
    await db.productFlowRemediationCase.findUnique({
      where: {
        idempotencyKey:
          "migration:v5:manual:v5-semantic-invalid",
      },
    });
  assert.ok(semanticCase);
  const semanticInvalidOwner =
    await db.recommendationSession.findUniqueOrThrow({
      where: { id: "v5-semantic-invalid" },
      select: {
        productFlowState: true,
        productFlowRevision: true,
      },
    });
  assert.deepEqual(semanticInvalidOwner, {
    productFlowState: "ACTIVE",
    productFlowRevision: 44,
  });
  const paymentReviewV5Case =
    await db.productFlowRemediationCase.findUnique({
      where: {
        idempotencyKey:
          "migration:v5:manual:v6-payment-review",
      },
    });
  assert.equal(paymentReviewV5Case?.status, "OPEN");
  const quoteExpiredV5Case =
    await db.productFlowRemediationCase.findUnique({
      where: {
        idempotencyKey:
          "migration:v5:manual:v6-quote-expired",
      },
    });
  assert.equal(quoteExpiredV5Case?.status, "OPEN");

  const v5FinancialAfter = await db.$queryRawUnsafe<
    typeof v4FinancialBefore
  >(`
    SELECT
      wallet."availableBalance" AS "walletBalance",
      (
        SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry.id)
        FROM "WalletLedgerEntry" entry
        WHERE entry.id LIKE 'v4-ledger-%'
      ) AS "ledgerSnapshot",
      jsonb_build_object(
        'amount', paid.amount,
        'paidAt', paid."paidAt",
        'planSnapshot', paid."planSnapshot"
      ) AS "paidOrderSnapshot",
      jsonb_build_object(
        'amountRial', quote."amountRial",
        'renewalAmountRial', quote."renewalAmountRial",
        'providerBasePriceRialSnapshot',
          quote."providerBasePriceRialSnapshot",
        'finalPriceRialSnapshot',
          quote."finalPriceRialSnapshot",
        'lineItemsSnapshot', quote."lineItemsSnapshot",
        'planSnapshot', quote."planSnapshot"
      ) AS "paidQuoteSnapshot",
      infra."providerSelectionSnapshot" AS "paidProviderSnapshot"
    FROM "Wallet" wallet
    JOIN "ServiceOrder" paid ON paid.id = 'v4-order-paid'
    JOIN "RecommendationQuote" quote
      ON quote.id = paid."recommendationQuoteId"
    JOIN "InfrastructureOrder" infra
      ON infra."serviceOrderId" = paid.id
    WHERE wallet.id = 'migration-wallet'
  `);
  assert.deepEqual(v5FinancialAfter, v4FinancialBefore);

  const v6PaymentReviewFinancialBefore =
    await db.$queryRawUnsafe<
      Array<{
        orderSnapshot: unknown;
        quoteSnapshot: unknown;
        walletSnapshot: unknown;
        ledgerSnapshot: unknown;
      }>
    >(`
      SELECT
        jsonb_build_object(
          'amount', service_order.amount,
          'paidAt', service_order."paidAt",
          'planSnapshot', service_order."planSnapshot",
          'provider', service_order.provider,
          'providerApiVersion', service_order."providerApiVersion"
        ) AS "orderSnapshot",
        jsonb_build_object(
          'amountRial', quote."amountRial",
          'renewalAmountRial', quote."renewalAmountRial",
          'providerBasePriceRialSnapshot',
            quote."providerBasePriceRialSnapshot",
          'finalPriceRialSnapshot', quote."finalPriceRialSnapshot",
          'lineItemsSnapshot', quote."lineItemsSnapshot",
          'planSnapshot', quote."planSnapshot",
          'provider', quote.provider,
          'providerApiVersion', quote."providerApiVersion"
        ) AS "quoteSnapshot",
        to_jsonb(wallet) AS "walletSnapshot",
        (
          SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry.id)
          FROM "WalletLedgerEntry" entry
          WHERE entry."walletId" = wallet.id
        ) AS "ledgerSnapshot"
      FROM "ServiceOrder" service_order
      JOIN "RecommendationQuote" quote
        ON quote.id = service_order."recommendationQuoteId"
      JOIN "Wallet" wallet ON wallet.id = 'migration-wallet'
      WHERE service_order.id = 'v6-order-payment-review'
    `);

  await copyThrough(terminalAndDispatchRecoveryV6);
  await deploy();

  const v6PaymentReview = await db.$queryRawUnsafe<
    Array<{
      sessionState: string;
      serviceState: string;
      sessionRevision: number;
      serviceRevision: number;
      caseStatus: string;
      resolvedEvidence: unknown;
    }>
  >(`
    SELECT
      session."productFlowState" AS "sessionState",
      service_order."productFlowState" AS "serviceState",
      session."productFlowRevision" AS "sessionRevision",
      service_order."productFlowRevision" AS "serviceRevision",
      remediation.status AS "caseStatus",
      remediation.evidence AS "resolvedEvidence"
    FROM "RecommendationSession" session
    JOIN "RecommendationQuote" quote
      ON quote."sessionId" = session.id
    JOIN "ServiceOrder" service_order
      ON service_order."recommendationQuoteId" = quote.id
    JOIN "ProductFlowRemediationCase" remediation
      ON remediation."idempotencyKey" =
        'migration:v5:manual:' || session.id
    WHERE session.id = 'v6-payment-review'
  `);
  assert.equal(v6PaymentReview[0]?.sessionState, "PAYMENT_REVIEW");
  assert.equal(v6PaymentReview[0]?.serviceState, "PAYMENT_REVIEW");
  assert.equal(
    v6PaymentReview[0]?.sessionRevision,
    v6PaymentReview[0]?.serviceRevision,
  );
  assert.ok((v6PaymentReview[0]?.sessionRevision ?? 0) > 20);
  assert.equal(v6PaymentReview[0]?.caseStatus, "RESOLVED");
  const v6QuoteExpired = await db.$queryRawUnsafe<
    Array<{
      sessionState: string;
      serviceState: string;
      sessionRevision: number;
      serviceRevision: number;
      caseStatus: string;
    }>
  >(`
    SELECT
      session."productFlowState" AS "sessionState",
      service_order."productFlowState" AS "serviceState",
      session."productFlowRevision" AS "sessionRevision",
      service_order."productFlowRevision" AS "serviceRevision",
      remediation.status AS "caseStatus"
    FROM "RecommendationSession" session
    JOIN "RecommendationQuote" quote
      ON quote."sessionId" = session.id
    JOIN "ServiceOrder" service_order
      ON service_order."recommendationQuoteId" = quote.id
    JOIN "ProductFlowRemediationCase" remediation
      ON remediation."idempotencyKey" =
        'migration:v5:manual:' || session.id
    WHERE session.id = 'v6-quote-expired'
  `);
  assert.deepEqual(v6QuoteExpired, [
    {
      sessionState: "QUOTE_EXPIRED",
      serviceState: "QUOTE_EXPIRED",
      sessionRevision: 10,
      serviceRevision: 10,
      caseStatus: "RESOLVED",
    },
  ]);
  const v6NonIncreasing = await db.$queryRawUnsafe<
    Array<{ count: bigint }>
  >(`
    SELECT count(*) AS count
    FROM "ProductFlowTransition"
    WHERE "idempotencyKey" LIKE 'migration:v6:%'
      AND "toRevision" <= "fromRevision"
  `);
  assert.equal(v6NonIncreasing[0]?.count, 0n);
  const v6PaymentReviewFinancialAfter =
    await db.$queryRawUnsafe<
      typeof v6PaymentReviewFinancialBefore
    >(`
      SELECT
        jsonb_build_object(
          'amount', service_order.amount,
          'paidAt', service_order."paidAt",
          'planSnapshot', service_order."planSnapshot",
          'provider', service_order.provider,
          'providerApiVersion', service_order."providerApiVersion"
        ) AS "orderSnapshot",
        jsonb_build_object(
          'amountRial', quote."amountRial",
          'renewalAmountRial', quote."renewalAmountRial",
          'providerBasePriceRialSnapshot',
            quote."providerBasePriceRialSnapshot",
          'finalPriceRialSnapshot', quote."finalPriceRialSnapshot",
          'lineItemsSnapshot', quote."lineItemsSnapshot",
          'planSnapshot', quote."planSnapshot",
          'provider', quote.provider,
          'providerApiVersion', quote."providerApiVersion"
        ) AS "quoteSnapshot",
        to_jsonb(wallet) AS "walletSnapshot",
        (
          SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry.id)
          FROM "WalletLedgerEntry" entry
          WHERE entry."walletId" = wallet.id
        ) AS "ledgerSnapshot"
      FROM "ServiceOrder" service_order
      JOIN "RecommendationQuote" quote
        ON quote.id = service_order."recommendationQuoteId"
      JOIN "Wallet" wallet ON wallet.id = 'migration-wallet'
      WHERE service_order.id = 'v6-order-payment-review'
    `);
  assert.deepEqual(
    v6PaymentReviewFinancialAfter,
    v6PaymentReviewFinancialBefore,
  );

  const terminalRecovered = await db.$queryRawUnsafe<
    Array<{
      id: string;
      status: string;
      serviceState: string;
      serviceRevision: number;
      sessionState: string;
      sessionRevision: number;
      infrastructureStatus: string;
      infrastructureState: string;
      infrastructureRevision: number;
    }>
  >(`
    SELECT
      so.id,
      so.status::text AS status,
      so."productFlowState" AS "serviceState",
      so."productFlowRevision" AS "serviceRevision",
      session."productFlowState" AS "sessionState",
      session."productFlowRevision" AS "sessionRevision",
      io.status::text AS "infrastructureStatus",
      io."productFlowState" AS "infrastructureState",
      io."productFlowRevision" AS "infrastructureRevision"
    FROM "ServiceOrder" so
    JOIN "RecommendationQuote" quote
      ON quote.id = so."recommendationQuoteId"
    JOIN "RecommendationSession" session
      ON session.id = quote."sessionId"
    JOIN "InfrastructureOrder" io
      ON io."serviceOrderId" = so.id
    WHERE so.id IN ('order-refunded', 'order-canceled')
    ORDER BY so.id
  `);
  assert.deepEqual(
    terminalRecovered.map((row) => ({
      id: row.id,
      status: row.status,
      serviceState: row.serviceState,
      sessionState: row.sessionState,
      infrastructureStatus: row.infrastructureStatus,
      infrastructureState: row.infrastructureState,
      aligned:
        row.serviceRevision === row.sessionRevision &&
        row.serviceRevision === row.infrastructureRevision,
    })),
    [
      {
        id: "order-canceled",
        status: "CANCELED",
        serviceState: "CANCELLED",
        sessionState: "CANCELLED",
        infrastructureStatus: "CANCELED",
        infrastructureState: "CANCELLED",
        aligned: true,
      },
      {
        id: "order-refunded",
        status: "REFUNDED",
        serviceState: "CANCELLED",
        sessionState: "CANCELLED",
        infrastructureStatus: "REFUNDED",
        infrastructureState: "CANCELLED",
        aligned: true,
      },
    ],
  );
  const terminalFinancialAfter = await db.$queryRawUnsafe<
    typeof terminalFinancialBefore
  >(`
    SELECT
      wallet."availableBalance" AS "walletBalance",
      (
        SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry.id)
        FROM "WalletLedgerEntry" entry
        WHERE entry.id IN (
          'ledger-refund-debit',
          'ledger-refund-credit'
        )
      ) AS "ledgerSnapshot",
      jsonb_build_object(
        'amount', so.amount,
        'currency', so.currency,
        'planSnapshot', so."planSnapshot",
        'paidAt', so."paidAt"
      ) AS "orderSnapshot",
      jsonb_build_object(
        'amountRial', quote."amountRial",
        'renewalAmountRial', quote."renewalAmountRial",
        'providerBasePriceRialSnapshot',
          quote."providerBasePriceRialSnapshot",
        'finalPriceRialSnapshot',
          quote."finalPriceRialSnapshot",
        'lineItemsSnapshot', quote."lineItemsSnapshot",
        'planSnapshot', quote."planSnapshot"
      ) AS "quoteSnapshot",
      io."providerSelectionSnapshot" AS "providerSnapshot"
    FROM "ServiceOrder" so
    JOIN "RecommendationQuote" quote
      ON quote.id = so."recommendationQuoteId"
    JOIN "InfrastructureOrder" io
      ON io."serviceOrderId" = so.id
    JOIN "Wallet" wallet ON wallet.id = 'migration-wallet'
    WHERE so.id = 'order-refunded'
  `);
  assert.deepEqual(terminalFinancialAfter, terminalFinancialBefore);
  // Raw updates: the generated client belongs to the FINAL schema, whose
  // newer ServiceOrder columns do not exist yet at this staged migration.
  await assert.rejects(
    db.$executeRawUnsafe(
      `UPDATE "ServiceOrder" SET "status" = 'DRAFT' WHERE id = 'order-refunded'`,
    ),
    /service_order_terminal_status_violation/,
  );
  await assert.rejects(
    db.$executeRawUnsafe(
      `UPDATE "ServiceOrder" SET "status" = 'DRAFT' WHERE id = 'order-canceled'`,
    ),
    /service_order_terminal_status_violation/,
  );

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
      AND so.status NOT IN ('REFUNDED', 'CANCELED')
      AND NOT EXISTS (
        SELECT 1
        FROM "ProductFlowRemediationCase" remediation
        WHERE remediation."recommendationSessionId" = s.id
          AND remediation.status = 'OPEN'
      )
      AND (
        s."productFlowState" <> so."productFlowState"
        OR s."productFlowRevision" <> so."productFlowRevision"
      )
  `);
  assert.equal(mismatched[0]?.count, 0n);

  const auditBefore = await db.productFlowTransition.count({
    where: { idempotencyKey: { startsWith: "migration:v2:" } },
  });
  await copyThrough(healthDispatchStarvationRecoveryV7);
  await deploy();
  const auditAfter = await db.productFlowTransition.count({
    where: { idempotencyKey: { startsWith: "migration:v2:" } },
  });
  assert.equal(auditAfter, auditBefore);

  const protectedCommerceBefore = {
    order: await db.serviceOrder.findUniqueOrThrow({
      where: { id: "order-paid" },
      select: {
        status: true,
        amount: true,
        paidAt: true,
        planSnapshot: true,
      },
    }),
    infrastructure: await db.infrastructureOrder.findUniqueOrThrow({
      where: { serviceOrderId: "order-paid" },
      select: { providerSelectionSnapshot: true },
    }),
    ledger: await db.walletLedgerEntry.findMany({
      where: { referenceType: "order", referenceId: "order-paid" },
      orderBy: { id: "asc" },
      select: {
        direction: true,
        type: true,
        amount: true,
        status: true,
        balanceAfter: true,
        reversedEntryId: true,
      },
    }),
  };
  await copyThrough(adminCatalogResilience);
  await deploy();
  await copyThrough(preprovisionedInventorySafety);
  await deploy();
  await copyThrough(arvanSaleInventoryCredentials);
  await deploy();
  await copyThrough(skuMarkupAndManualPublication);
  await deploy();
  await copyThrough(orderGatewayPayments);
  await deploy();
  await executeStatements(db, `
    INSERT INTO "InfrastructurePlan" (
      id, code, title, provider, "providerApiVersion", "productKind",
      "regionCode", "sizeCode", "imageCode", "deliveryMode",
      vcpu, "ramGb", "storageGb", "salePriceRial", "renewalPriceRial",
      "estimatedProviderCostRial", "parchinIncluded", active,
      "publicationStatus", "updatedAt"
    ) VALUES (
      'legacy-active-cloud-plan', 'LEGACY_ACTIVE_CLOUD_PLAN',
      'Legacy Active Cloud Plan', 'ARVAN', 'v1', 'CLOUD_SERVER',
      'ir-thr-ba1', 'g2', 'ubuntu', 'MANAGED',
      2, 2, 40, 2400000, 2400000, 1800000, false, true,
      'PUBLISHED', CURRENT_TIMESTAMP
    );

    INSERT INTO "ServiceOrder" (
      id, "userId", title, amount, currency, status, "planCode", "planId",
      "planSnapshot", provider, "providerApiVersion", "productKind",
      "productFlowState", "productFlowRevision", "paidAt", "updatedAt"
    ) VALUES (
      'legacy-active-cloud-order', 'migration-user',
      'Legacy Active Cloud Service', 2400000, 'IRR', 'PAID',
      'LEGACY_ACTIVE_CLOUD_PLAN', 'legacy-active-cloud-plan',
      '{"billingCadence":"DAILY","migrationFixture":true}'::jsonb,
      'ARVAN', 'v1', 'CLOUD_SERVER', 'DELIVERED', 1,
      TIMESTAMPTZ '2026-08-01 00:00:00+00', CURRENT_TIMESTAMP
    );

    INSERT INTO "InfrastructureOrder" (
      id, "serviceOrderId", "userId", "planId", provider,
      "providerApiVersion", "productKind", "providerSelectionSnapshot",
      "productFlowState", "productFlowRevision", "deliveryMode", status,
      "requiredFundingRial", "updatedAt"
    ) VALUES (
      'legacy-active-cloud-infrastructure', 'legacy-active-cloud-order',
      'migration-user', 'legacy-active-cloud-plan', 'ARVAN', 'v1',
      'CLOUD_SERVER', '{"migrationFixture":true}'::jsonb, 'DELIVERED', 1,
      'MANAGED', 'ACTIVE', 0, CURRENT_TIMESTAMP
    );

    INSERT INTO "CloudInstance" (
      id, "infrastructureOrderId", "userId", provider,
      "providerApiVersion", "providerInstanceId", name, region, size, image,
      "deliveryMode", ipv4, "providerState", status, "providerObservedAt",
      "provisionedAt", "deliveredAt", "updatedAt"
    ) VALUES (
      'legacy-active-cloud-instance', 'legacy-active-cloud-infrastructure',
      'migration-user', 'ARVAN', 'v1', 'legacy-provider-instance',
      'legacy-active-cloud', 'ir-thr-ba1', 'g2', 'ubuntu', 'MANAGED',
      '192.0.2.10', 'active', 'ACTIVE',
      TIMESTAMPTZ '2026-08-01 00:00:00+00',
      TIMESTAMPTZ '2026-08-01 00:00:00+00',
      TIMESTAMPTZ '2026-08-01 00:30:00+00', CURRENT_TIMESTAMP
    )
  `);
  const legacyFinancialSnapshot =
    await db.$queryRawUnsafe<
      Array<{
        availableBalance: bigint;
        ledgerCount: bigint;
        orderAmount: bigint;
        orderStatus: string;
      }>
    >(`
      SELECT
        wallet."availableBalance" AS "availableBalance",
        count(ledger.id) AS "ledgerCount",
        orders.amount AS "orderAmount",
        orders.status::text AS "orderStatus"
      FROM "Wallet" wallet
      JOIN "ServiceOrder" orders
        ON orders.id = 'legacy-active-cloud-order'
      LEFT JOIN "WalletLedgerEntry" ledger
        ON ledger."walletId" = wallet.id
      WHERE wallet.id = 'migration-wallet'
      GROUP BY wallet."availableBalance", orders.amount, orders.status
    `);

  await copyThrough(walletPaygBillingCore);
  await deploy();
  const paygCoreUpgrade = await db.$queryRawUnsafe<
    Array<{
      billingModel: string;
      globalAvailability: string;
      globalCadence: string;
      serviceCadence: string;
      serviceAvailability: string;
      resourceVersionCount: bigint;
      usageIntervalCount: bigint;
      invoiceCount: bigint;
    }>
  >(`
    SELECT
      plan."billingModel"::text AS "billingModel",
      global_policy.availability::text AS "globalAvailability",
      global_policy."defaultCadence"::text AS "globalCadence",
      snapshot.cadence::text AS "serviceCadence",
      service_policy.availability::text AS "serviceAvailability",
      (SELECT count(*) FROM "ResourceVersion"
        WHERE "cloudInstanceId" = 'legacy-active-cloud-instance')
        AS "resourceVersionCount",
      (SELECT count(*) FROM "UsageInterval"
        WHERE "cloudInstanceId" = 'legacy-active-cloud-instance')
        AS "usageIntervalCount",
      (SELECT count(*) FROM "BillingInvoice") AS "invoiceCount"
    FROM "InfrastructurePlan" plan
    JOIN "BillingPolicyVersion" global_policy
      ON global_policy."policyKey" = 'global'
      AND global_policy."effectiveTo" IS NULL
    JOIN "ServiceBillingPolicySnapshot" snapshot
      ON snapshot."cloudInstanceId" = 'legacy-active-cloud-instance'
      AND snapshot."effectiveTo" IS NULL
    JOIN "BillingPolicyVersion" service_policy
      ON service_policy.id = snapshot."billingPolicyVersionId"
    WHERE plan.id = 'legacy-active-cloud-plan'
  `);
  assert.deepEqual(paygCoreUpgrade, [
    {
      billingModel: "PAYG_WALLET",
      globalAvailability: "HOURLY_ONLY",
      globalCadence: "HOURLY",
      serviceCadence: "DAILY",
      serviceAvailability: "DAILY_ONLY",
      resourceVersionCount: 1n,
      usageIntervalCount: 1n,
      invoiceCount: 0n,
    },
  ]);

  await copyThrough(walletPaymentRecovery);
  await deploy();
  await copyThrough(usageBillingWorker);
  await deploy();
  await copyThrough(walletFirstActivation);
  await deploy();
  await copyThrough(migrationNames.at(-1)!);
  await deploy();

  const providerBillingContracts = (
    await db.providerBillingContractVersion.findMany({
      where: {
        productKind: InfrastructureProductKind.CLOUD_SERVER,
        providerApiVersion: "v1",
      },
      orderBy: { provider: "asc" },
      select: {
        provider: true,
        status: true,
        source: true,
        version: true,
        calculationUnit: true,
      },
    })
  ).sort((left, right) => left.provider.localeCompare(right.provider));
  assert.deepEqual(providerBillingContracts, [
    {
      provider: InfrastructureProvider.ARVAN,
      status: "UNVERIFIED",
      source: "adapter_contract_not_verified",
      version: 1,
      calculationUnit: null,
    },
  ]);

  const finalPaygUpgrade =
    await db.$queryRawUnsafe<
      Array<{
        availableBalance: bigint;
        ledgerCount: bigint;
        orderAmount: bigint;
        orderStatus: string;
        serviceCadence: string;
        resourcePlanId: string;
        invoiceCount: bigint;
      }>
    >(`
      SELECT
        wallet."availableBalance" AS "availableBalance",
        count(DISTINCT ledger.id) AS "ledgerCount",
        orders.amount AS "orderAmount",
        orders.status::text AS "orderStatus",
        snapshot.cadence::text AS "serviceCadence",
        resource_version."planId" AS "resourcePlanId",
        (SELECT count(*) FROM "BillingInvoice") AS "invoiceCount"
      FROM "Wallet" wallet
      JOIN "ServiceOrder" orders
        ON orders.id = 'legacy-active-cloud-order'
      JOIN "ServiceBillingPolicySnapshot" snapshot
        ON snapshot."cloudInstanceId" = 'legacy-active-cloud-instance'
        AND snapshot."effectiveTo" IS NULL
      JOIN "ResourceVersion" resource_version
        ON resource_version."cloudInstanceId" = 'legacy-active-cloud-instance'
        AND resource_version."effectiveTo" IS NULL
      LEFT JOIN "WalletLedgerEntry" ledger
        ON ledger."walletId" = wallet.id
      WHERE wallet.id = 'migration-wallet'
      GROUP BY wallet."availableBalance", orders.amount, orders.status,
        snapshot.cadence, resource_version."planId"
    `);
  assert.deepEqual(finalPaygUpgrade, [
    {
      ...legacyFinancialSnapshot[0]!,
      serviceCadence: "DAILY",
      resourcePlanId: "legacy-active-cloud-plan",
      invoiceCount: 0n,
    },
  ]);
  const protectedCommerceAfter = {
    order: await db.serviceOrder.findUniqueOrThrow({
      where: { id: "order-paid" },
      select: {
        status: true,
        amount: true,
        paidAt: true,
        planSnapshot: true,
      },
    }),
    infrastructure: await db.infrastructureOrder.findUniqueOrThrow({
      where: { serviceOrderId: "order-paid" },
      select: { providerSelectionSnapshot: true },
    }),
    ledger: await db.walletLedgerEntry.findMany({
      where: { referenceType: "order", referenceId: "order-paid" },
      orderBy: { id: "asc" },
      select: {
        direction: true,
        type: true,
        amount: true,
        status: true,
        balanceAfter: true,
        reversedEntryId: true,
      },
    }),
  };
  assert.deepEqual(protectedCommerceAfter, protectedCommerceBefore);

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
  const previousArvanRegions = process.env.ARVAN_REGION_CODES;
  process.env.ARVAN_REGION_CODES =
    "ir-thr-si1, ir-thr-si1,eu-west1-a";
  const {
    ensureProviderRegionBootstrap,
    listProviderRegionConfigs,
  } = await import(
    "../lib/infrastructure/provider-region-config.ts"
  );
  await ensureProviderRegionBootstrap(InfrastructureProvider.ARVAN, "v1");
  assert.deepEqual(
    (
      await listProviderRegionConfigs({
        provider: InfrastructureProvider.ARVAN,
        apiVersion: "v1",
        purpose: "SYNC",
      })
    ).map((region) => region.regionCode),
    ["ir-thr-si1", "eu-west1-a"],
  );
  await db.providerRegionConfig.create({
    data: {
      provider: InfrastructureProvider.ARVAN,
      apiVersion: "v1",
      regionCode: "ir-admin-runtime",
      displayName: "Region افزوده‌شده از Admin",
      source: "ADMIN",
      syncEnabled: true,
      saleEnabled: true,
      sortOrder: 99,
    },
  });
  assert.equal(
    (
      await listProviderRegionConfigs({
        provider: InfrastructureProvider.ARVAN,
        apiVersion: "v1",
        purpose: "SYNC",
      })
    ).some((region) => region.regionCode === "ir-admin-runtime"),
    true,
    "runtime Region selection must read the database after bootstrap",
  );
  if (previousArvanRegions === undefined) delete process.env.ARVAN_REGION_CODES;
  else process.env.ARVAN_REGION_CODES = previousArvanRegions;
  const {
    assertProductFlowOwnerStateTx,
    bootstrapCatalogCheckoutFlowTx,
    transitionProductFlow,
  } = await import(
    "../lib/product-flow/service.ts"
  );
  const v6BeforeRuntimeTransition =
    await flowDb.recommendationSession.findUniqueOrThrow({
      where: { id: "v6-payment-review" },
      select: { productFlowRevision: true },
    });
  const v6RuntimeTransition = await transitionProductFlow({
    owner: {
      recommendationSessionId: "v6-payment-review",
      serviceOrderId: "v6-order-payment-review",
    },
    from: "PAYMENT_REVIEW",
    to: "AWAITING_PAYMENT",
    idempotencyKey: "v6-next-transition-once",
    reason: "payment_review_approved",
  });
  assert.equal(
    v6RuntimeTransition.fromRevision,
    v6BeforeRuntimeTransition.productFlowRevision,
  );
  assert.equal(
    v6RuntimeTransition.toRevision,
    v6BeforeRuntimeTransition.productFlowRevision + 1,
  );
  const v6Replay = await transitionProductFlow({
    owner: {
      recommendationSessionId: "v6-payment-review",
      serviceOrderId: "v6-order-payment-review",
    },
    from: "PAYMENT_REVIEW",
    to: "AWAITING_PAYMENT",
    idempotencyKey: "v6-next-transition-once",
    reason: "payment_review_approved",
  });
  assert.equal(v6Replay.id, v6RuntimeTransition.id);
  await assert.rejects(
    transitionProductFlow({
      owner: {
        recommendationSessionId: "v6-payment-review",
        serviceOrderId: "v6-order-payment-review",
      },
      from: "PAYMENT_REVIEW",
      to: "AWAITING_PAYMENT",
      idempotencyKey: "v6-stale-revision-transition",
      reason: "stale_payment_review_command",
    }),
    /product_flow_state_conflict/,
  );
  const v5BeforeRuntimeTransition =
    await flowDb.recommendationSession.findUniqueOrThrow({
      where: { id: "v4-mixed-cancel-pending" },
      select: { productFlowRevision: true },
    });
  const v5RuntimeTransition = await transitionProductFlow({
    owner: {
      recommendationSessionId:
        "v4-mixed-cancel-pending",
      serviceOrderId: "v4-order-pending",
    },
    from: "AWAITING_PAYMENT",
    to: "PAYMENT_REVIEW",
    idempotencyKey: "v5-next-transition-once",
    reason: "v5_post_migration_runtime_transition",
  });
  assert.equal(
    v5RuntimeTransition.fromRevision,
    v5BeforeRuntimeTransition.productFlowRevision,
  );
  assert.equal(
    v5RuntimeTransition.toRevision,
    v5BeforeRuntimeTransition.productFlowRevision + 1,
  );
  await assert.rejects(
    transitionProductFlow({
      owner: {
        recommendationSessionId:
          "v4-mixed-cancel-pending",
        serviceOrderId: "v4-order-pending",
      },
      from: "AWAITING_PAYMENT",
      to: "PAYMENT_REVIEW",
      idempotencyKey: "v5-stale-revision-transition",
      reason: "v5_stale_revision_must_conflict",
    }),
    /product_flow_state_conflict/,
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
  allowAdminMobile("09120000001");
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

  async function seedRuntimeOrder(input: {
    id: string;
    infrastructureStatus: InfrastructureOrderStatus;
    productFlowState?: string;
    withDebit?: boolean;
  }) {
    const flow = input.productFlowState ?? "PAID";
    const session = await db.recommendationSession.create({
      data: {
        id: `runtime-session-${input.id}`,
        userId: "migration-user",
        status: "CONVERTED",
        answers: {},
        answerSources: {},
        productFlowState: flow,
        productFlowRevision: 0,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const quote = await db.recommendationQuote.create({
      data: {
        id: `runtime-quote-${input.id}`,
        sessionId: session.id,
        planId: "migration-plan",
        role: "RECOMMENDED",
        status: "CONVERTED",
        score: 100,
        scoreBreakdown: {},
        reasons: [],
        profileSnapshot: {},
        planSnapshot: { immutable: input.id },
        amountRial: 6_250_000n,
        renewalAmountRial: 6_250_000n,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const serviceOrder = await db.serviceOrder.create({
      data: {
        id: `runtime-order-${input.id}`,
        userId: "migration-user",
        title: `Runtime ${input.id}`,
        amount: 6_250_000n,
        status: ServiceOrderStatus.PAID,
        planId: "migration-plan",
        planSnapshot: { immutable: input.id },
        recommendationQuoteId: quote.id,
        provider: InfrastructureProvider.ARVAN,
        providerApiVersion: "v1",
        productKind:
          InfrastructureProductKind.READY_INSTANT_SERVER,
        parchinLevel: ParchinLevel.PARCHIN_START,
        productFlowState: flow,
        productFlowRevision: 0,
        paidAt: now,
      },
    });
    const infrastructureOrder = await db.infrastructureOrder.create({
      data: {
        id: `runtime-infra-${input.id}`,
        serviceOrderId: serviceOrder.id,
        userId: "migration-user",
        planId: "migration-plan",
        provider: InfrastructureProvider.ARVAN,
        providerApiVersion: "v1",
        productKind:
          InfrastructureProductKind.READY_INSTANT_SERVER,
        parchinLevel: ParchinLevel.PARCHIN_START,
        providerSelectionSnapshot: {
          immutable: input.id,
          provider: "ARVAN",
          providerApiVersion: "v1",
          productKind: "READY_INSTANT_SERVER",
          region: "tehran",
          externalPlanId: "s1",
          externalImageId: "ubuntu",
          externalNetworkId: "network-1",
          externalSecurityId: "security-1",
          topologyVerificationMode: "STRICT_OBSERVED",
          deliveryConfiguration: {
            provider: "ARVAN",
            providerApiVersion: "v1",
            productKind: "READY_INSTANT_SERVER",
            region: "tehran",
            externalPlanId: "s1",
            externalImageId: "ubuntu",
            externalNetworkId: "network-1",
            externalSecurityId: "security-1",
            topologyVerificationMode: "STRICT_OBSERVED",
            accessMethod: "SSH_KEY",
            sshKeyName: "migration-key",
          },
        },
        productFlowState: flow,
        productFlowRevision: 0,
        deliveryMode: "MANAGED",
        status: input.infrastructureStatus,
        requiredFundingRial: 5_000_000n,
      },
    });
    if (input.withDebit) {
      await db.walletLedgerEntry.create({
        data: {
          id: `runtime-debit-${input.id}`,
          walletId: "migration-wallet",
          direction: "DEBIT",
          type: "SERVICE_PURCHASE",
          amount: serviceOrder.amount,
          status: "COMPLETED",
          referenceType: "order",
          referenceId: serviceOrder.id,
          idempotencyKey: `runtime-pay-${input.id}`,
          balanceAfter: 2_750_000n,
          metadata: { immutable: input.id },
        },
      });
    }
    return { session, quote, serviceOrder, infrastructureOrder };
  }

  const { refundOrder } = await import("../lib/orders/service.ts");
  const {
    confirmNoProviderResource,
    reconcileInfrastructureOrder,
    retryFailedProvisioning,
  } = await import("../lib/infrastructure/retry.ts");
  const { confirmProviderFunding } = await import(
    "../lib/infrastructure/funding.ts"
  );
  const { writeAuditLog } = await import(
    "../lib/audit/service.ts"
  );

  const refundRuntime = await seedRuntimeOrder({
    id: "refund-success",
    infrastructureStatus:
      InfrastructureOrderStatus.WAITING_ADMIN_FUNDING,
    withDebit: true,
  });
  const walletBeforeRuntimeRefund =
    await db.wallet.findUniqueOrThrow({
      where: { id: "migration-wallet" },
    });
  await refundOrder({
    orderId: refundRuntime.serviceOrder.id,
    actorUserId: "migration-admin",
    reason: "بازگشت وجه تراکنشی تست",
    idempotencyKey: "postgres-refund-runtime-0001",
  });
  const walletAfterRuntimeRefund =
    await db.wallet.findUniqueOrThrow({
      where: { id: "migration-wallet" },
    });
  assert.equal(
    walletAfterRuntimeRefund.availableBalance,
    walletBeforeRuntimeRefund.availableBalance + 6_250_000n,
  );
  assert.equal(
    await db.walletLedgerEntry.count({
      where: {
        reversedEntryId: `runtime-debit-refund-success`,
        type: "REFUND",
        status: "COMPLETED",
      },
    }),
    1,
  );
  const refundedRuntimeGraph = await db.$queryRawUnsafe<
    Array<{
      serviceStatus: string;
      infrastructureStatus: string;
      sessionState: string;
      serviceState: string;
      infrastructureState: string;
      sessionRevision: number;
      serviceRevision: number;
      infrastructureRevision: number;
    }>
  >(`
    SELECT
      so.status::text AS "serviceStatus",
      io.status::text AS "infrastructureStatus",
      session."productFlowState" AS "sessionState",
      so."productFlowState" AS "serviceState",
      io."productFlowState" AS "infrastructureState",
      session."productFlowRevision" AS "sessionRevision",
      so."productFlowRevision" AS "serviceRevision",
      io."productFlowRevision" AS "infrastructureRevision"
    FROM "ServiceOrder" so
    JOIN "RecommendationQuote" quote
      ON quote.id = so."recommendationQuoteId"
    JOIN "RecommendationSession" session
      ON session.id = quote."sessionId"
    JOIN "InfrastructureOrder" io
      ON io."serviceOrderId" = so.id
    WHERE so.id = '${refundRuntime.serviceOrder.id}'
  `);
  assert.deepEqual(
    {
      ...refundedRuntimeGraph[0],
      aligned:
        refundedRuntimeGraph[0]?.sessionRevision ===
          refundedRuntimeGraph[0]?.serviceRevision &&
        refundedRuntimeGraph[0]?.serviceRevision ===
          refundedRuntimeGraph[0]?.infrastructureRevision,
    },
    {
      serviceStatus: "REFUNDED",
      infrastructureStatus: "REFUNDED",
      sessionState: "CANCELLED",
      serviceState: "CANCELLED",
      infrastructureState: "CANCELLED",
      sessionRevision: 1,
      serviceRevision: 1,
      infrastructureRevision: 1,
      aligned: true,
    },
  );
  await refundOrder({
    orderId: refundRuntime.serviceOrder.id,
    actorUserId: "migration-admin",
    reason: "بازگشت وجه تراکنشی تست",
    idempotencyKey: "postgres-refund-runtime-0001",
  });
  assert.equal(
    await db.walletLedgerEntry.count({
      where: {
        reversedEntryId: `runtime-debit-refund-success`,
        type: "REFUND",
      },
    }),
    1,
  );
  assert.equal(
    (
      await db.wallet.findUniqueOrThrow({
        where: { id: "migration-wallet" },
      })
    ).availableBalance,
    walletAfterRuntimeRefund.availableBalance,
  );

  const refundWithLiveSibling = await seedRuntimeOrder({
    id: "refund-with-live-sibling",
    infrastructureStatus:
      InfrastructureOrderStatus.WAITING_ADMIN_FUNDING,
    withDebit: true,
  });
  await db.recommendationSession.update({
    where: { id: refundWithLiveSibling.session.id },
    data: {
      productFlowState: "ACTIVE",
      productFlowRevision: 5,
    },
  });
  const siblingQuote = await db.recommendationQuote.create({
    data: {
      id: "runtime-quote-live-sibling",
      sessionId: refundWithLiveSibling.session.id,
      planId: "migration-plan",
      role: "GROWTH",
      status: "CONVERTED",
      score: 95,
      scoreBreakdown: {},
      reasons: [],
      profileSnapshot: {},
      planSnapshot: { immutable: "live-sibling-quote" },
      amountRial: 6_250_000n,
      renewalAmountRial: 6_250_000n,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const siblingService = await db.serviceOrder.create({
    data: {
      id: "runtime-order-live-sibling",
      userId: "migration-user",
      title: "Runtime live sibling",
      amount: 6_250_000n,
      status: ServiceOrderStatus.PAID,
      planId: "migration-plan",
      planSnapshot: { immutable: "live-sibling-order" },
      recommendationQuoteId: siblingQuote.id,
      provider: InfrastructureProvider.ARVAN,
      providerApiVersion: "v1",
      productKind:
        InfrastructureProductKind.READY_INSTANT_SERVER,
      parchinLevel: ParchinLevel.PARCHIN_START,
      productFlowState: "ACTIVE",
      productFlowRevision: 5,
      paidAt: now,
    },
  });
  const siblingInfrastructure =
    await db.infrastructureOrder.create({
      data: {
        id: "runtime-infra-live-sibling",
        serviceOrderId: siblingService.id,
        userId: "migration-user",
        planId: "migration-plan",
        provider: InfrastructureProvider.ARVAN,
        providerApiVersion: "v1",
        productKind:
          InfrastructureProductKind.READY_INSTANT_SERVER,
        parchinLevel: ParchinLevel.PARCHIN_START,
        providerSelectionSnapshot: {
          immutable: "live-sibling-provider",
        },
        productFlowState: "ACTIVE",
        productFlowRevision: 5,
        deliveryMode: "MANAGED",
        status: InfrastructureOrderStatus.ACTIVE,
        requiredFundingRial: 5_000_000n,
      },
    });
  await refundOrder({
    orderId: refundWithLiveSibling.serviceOrder.id,
    actorUserId: "migration-admin",
    reason: "Refund فقط برای Order هدف با sibling فعال",
    idempotencyKey: "postgres-refund-sibling-0001",
  });
  assert.deepEqual(
    await db.recommendationSession.findUniqueOrThrow({
      where: { id: refundWithLiveSibling.session.id },
      select: {
        productFlowState: true,
        productFlowRevision: true,
      },
    }),
    {
      productFlowState: "ACTIVE",
      productFlowRevision: 5,
    },
  );
  assert.deepEqual(
    await db.serviceOrder.findUniqueOrThrow({
      where: { id: siblingService.id },
      select: {
        status: true,
        productFlowState: true,
        productFlowRevision: true,
        planSnapshot: true,
      },
    }),
    {
      status: ServiceOrderStatus.PAID,
      productFlowState: "ACTIVE",
      productFlowRevision: 5,
      planSnapshot: { immutable: "live-sibling-order" },
    },
  );
  assert.deepEqual(
    await db.infrastructureOrder.findUniqueOrThrow({
      where: { id: siblingInfrastructure.id },
      select: {
        status: true,
        productFlowState: true,
        productFlowRevision: true,
        providerSelectionSnapshot: true,
      },
    }),
    {
      status: InfrastructureOrderStatus.ACTIVE,
      productFlowState: "ACTIVE",
      productFlowRevision: 5,
      providerSelectionSnapshot: {
        immutable: "live-sibling-provider",
      },
    },
  );
  assert.equal(
    (
      await db.productFlowTransition.findFirstOrThrow({
        where: {
          serviceOrderId:
            refundWithLiveSibling.serviceOrder.id,
          reason: "wallet_refund_completed",
        },
      })
    ).recommendationSessionId,
    null,
  );

  const refundRollback = await seedRuntimeOrder({
    id: "refund-rollback",
    infrastructureStatus:
      InfrastructureOrderStatus.WAITING_ADMIN_FUNDING,
    withDebit: true,
  });
  await db.productFlowTransition.create({
    data: {
      id: "runtime-refund-conflict",
      recommendationSessionId: refundRollback.session.id,
      serviceOrderId: refundRollback.serviceOrder.id,
      infrastructureOrderId:
        refundRollback.infrastructureOrder.id,
      fromState: "PAID",
      toState: "PROVISIONING_SUBMITTED",
      reason: "conflicting_test_transition",
      metadata: { immutable: true },
      idempotencyKey:
        `refund-flow:${refundRollback.serviceOrder.id}`,
      ownerFingerprint:
        `${refundRollback.session.id}:${refundRollback.serviceOrder.id}:${refundRollback.infrastructureOrder.id}`,
      fromRevision: 0,
      toRevision: 1,
    },
  });
  const walletBeforeRollback =
    await db.wallet.findUniqueOrThrow({
      where: { id: "migration-wallet" },
    });
  await assert.rejects(
    refundOrder({
      orderId: refundRollback.serviceOrder.id,
      actorUserId: "migration-admin",
      reason: "این Refund باید Rollback شود",
      idempotencyKey: "postgres-refund-rollback-0001",
    }),
    /product_flow_idempotency_conflict/,
  );
  assert.equal(
    (
      await db.wallet.findUniqueOrThrow({
        where: { id: "migration-wallet" },
      })
    ).availableBalance,
    walletBeforeRollback.availableBalance,
  );
  assert.equal(
    await db.walletLedgerEntry.count({
      where: {
        reversedEntryId: `runtime-debit-refund-rollback`,
        type: "REFUND",
      },
    }),
    0,
  );
  assert.equal(
    (
      await db.serviceOrder.findUniqueOrThrow({
        where: { id: refundRollback.serviceOrder.id },
      })
    ).status,
    ServiceOrderStatus.PAID,
  );

  async function assertAmbiguousRefundBlocked(input: {
    id: string;
    job: {
      createSentAt?: Date;
      providerTaskId?: string;
      providerResourceId?: string;
      status?: ProvisioningJobStatus;
      lastErrorCode?: string;
    };
  }) {
    const seeded = await seedRuntimeOrder({
      id: input.id,
      infrastructureStatus: InfrastructureOrderStatus.FAILED,
      productFlowState: "PROVISIONING_MANUAL_REVIEW",
      withDebit: true,
    });
    await db.provisioningJob.create({
      data: {
        infrastructureOrderId: seeded.infrastructureOrder.id,
        operation: "create_instance",
        status: input.job.status ?? ProvisioningJobStatus.FAILED,
        idempotencyKey: `runtime-resource-risk-${input.id}`,
        attempt: 1,
        createSentAt: input.job.createSentAt,
        providerTaskId: input.job.providerTaskId,
        providerResourceId: input.job.providerResourceId,
        lastErrorCode: input.job.lastErrorCode,
        finishedAt: new Date(),
      },
    });
    const walletBefore = await db.wallet.findUniqueOrThrow({
      where: { id: "migration-wallet" },
      select: { availableBalance: true },
    });
    const ledgerBefore = await db.walletLedgerEntry.count();
    await assert.rejects(
      refundOrder({
        orderId: seeded.serviceOrder.id,
        actorUserId: "migration-admin",
        reason: "نبود منبع هنوز قطعی نیست",
        idempotencyKey: `postgres-refund-blocked-${seeded.serviceOrder.id}`,
      }),
      /تعیین قطعی نبود یا خاتمه Resource|وضعیت فعلی Resource مجاز نیست/,
    );
    assert.deepEqual(
      await db.wallet.findUniqueOrThrow({
        where: { id: "migration-wallet" },
        select: { availableBalance: true },
      }),
      walletBefore,
    );
    assert.equal(await db.walletLedgerEntry.count(), ledgerBefore);
    assert.equal(
      (
        await db.serviceOrder.findUniqueOrThrow({
          where: { id: seeded.serviceOrder.id },
          select: { status: true },
        })
      ).status,
      ServiceOrderStatus.PAID,
    );
  }

  await assertAmbiguousRefundBlocked({
    id: "refund-create-sent",
    job: { createSentAt: new Date() },
  });
  await assertAmbiguousRefundBlocked({
    id: "refund-provider-task",
    job: { providerTaskId: "provider-task-unknown" },
  });
  await assertAmbiguousRefundBlocked({
    id: "refund-provider-resource",
    job: { providerResourceId: "provider-resource-unknown" },
  });
  await assertAmbiguousRefundBlocked({
    id: "refund-needs-reconciliation",
    job: {
      status: ProvisioningJobStatus.NEEDS_RECONCILIATION,
      lastErrorCode: "provider_ambiguous",
    },
  });
  await assertAmbiguousRefundBlocked({
    id: "refund-provider-timeout",
    job: { lastErrorCode: "provider_timeout" },
  });

  const confirmedAbsent = await seedRuntimeOrder({
    id: "refund-confirmed-absent",
    infrastructureStatus: InfrastructureOrderStatus.FAILED,
    productFlowState: "PROVISIONING_MANUAL_REVIEW",
    withDebit: true,
  });
  const confirmedAbsentAttempt = await db.provisioningJob.create({
    data: {
      infrastructureOrderId: confirmedAbsent.infrastructureOrder.id,
      operation: "create_instance",
      status: ProvisioningJobStatus.FAILED,
      idempotencyKey: "runtime-confirmed-absent-attempt",
      attempt: 1,
      createSentAt: new Date(),
      lastErrorCode: "provider_timeout",
      finishedAt: new Date(),
    },
  });
  const absenceAdapter = new FakeCloudProviderAdapter({
    provider: InfrastructureProvider.ARVAN,
    observedResource: null,
  });
  await confirmNoProviderResource(
    {
      infrastructureOrderId:
        confirmedAbsent.infrastructureOrder.id,
      adminUserId: "migration-admin",
      reason: "Provider با GET نبود Resource را تأیید کرد",
      idempotencyKey: "postgres-confirm-absent-0001",
    },
    absenceAdapter,
  );
  const absenceConfirmation =
    await db.infrastructureOrder.findUniqueOrThrow({
      where: { id: confirmedAbsent.infrastructureOrder.id },
      select: {
        reconcileNoResourceConfirmedAt: true,
        reconcileNoResourceConfirmedJobId: true,
        reconcileNoResourceConfirmedAttempt: true,
      },
    });
  assert.ok(absenceConfirmation.reconcileNoResourceConfirmedAt);
  assert.equal(
    absenceConfirmation.reconcileNoResourceConfirmedJobId,
    confirmedAbsentAttempt.id,
  );
  assert.equal(
    absenceConfirmation.reconcileNoResourceConfirmedAttempt,
    1,
  );
  assert.equal(absenceAdapter.createCalls.length, 0);
  await refundOrder({
    orderId: confirmedAbsent.serviceOrder.id,
    actorUserId: "migration-admin",
    reason: "نبود Resource قطعی و Audit شده است",
    idempotencyKey: "postgres-refund-absent-0001",
  });
  assert.equal(
    (
      await db.serviceOrder.findUniqueOrThrow({
        where: { id: confirmedAbsent.serviceOrder.id },
        select: { status: true },
      })
    ).status,
    ServiceOrderStatus.REFUNDED,
  );

  const terminatedResource = await seedRuntimeOrder({
    id: "refund-terminated-resource",
    infrastructureStatus: InfrastructureOrderStatus.FAILED,
    productFlowState: "PROVISIONING_MANUAL_REVIEW",
    withDebit: true,
  });
  await db.provisioningJob.create({
    data: {
      infrastructureOrderId: terminatedResource.infrastructureOrder.id,
      operation: "create_instance",
      status: ProvisioningJobStatus.SUCCEEDED,
      idempotencyKey: "runtime-terminated-resource-attempt",
      attempt: 1,
      createSentAt: new Date(Date.now() - 10_000),
      providerResourceId: "terminated-provider-resource",
      finishedAt: new Date(Date.now() - 5_000),
    },
  });
  await db.cloudInstance.create({
    data: {
      infrastructureOrderId: terminatedResource.infrastructureOrder.id,
      userId: "migration-user",
      provider: InfrastructureProvider.ARVAN,
      providerApiVersion: "v1",
      providerInstanceId: "terminated-provider-resource",
      name: "abrchin-terminated-resource",
      region: "tehran",
      size: "s1",
      image: "Ubuntu",
      deliveryMode: "MANAGED",
      status: CloudInstanceStatus.TERMINATED,
      terminatedAt: new Date(),
    },
  });
  await refundOrder({
    orderId: terminatedResource.serviceOrder.id,
    actorUserId: "migration-admin",
    reason: "Resource به‌طور قطعی خاتمه یافته است",
    idempotencyKey: "postgres-refund-terminated-0001",
  });
  assert.equal(
    (
      await db.serviceOrder.findUniqueOrThrow({
        where: { id: terminatedResource.serviceOrder.id },
        select: { status: true },
      })
    ).status,
    ServiceOrderStatus.REFUNDED,
  );

  const unusableNeverSent = await seedRuntimeOrder({
    id: "refund-unusable-never-sent",
    infrastructureStatus: InfrastructureOrderStatus.FAILED,
    productFlowState: "PROVISIONING_MANUAL_REVIEW",
    withDebit: true,
  });
  await db.infrastructureOrder.update({
    where: { id: unusableNeverSent.infrastructureOrder.id },
    data: {
      providerSelectionSnapshot: {
        unusable: true,
        containsSecret: false,
      },
    },
  });
  await refundOrder({
    orderId: unusableNeverSent.serviceOrder.id,
    actorUserId: "migration-admin",
    reason: "Create ارسال نشده و Snapshot قابل استفاده نیست",
    idempotencyKey: "postgres-refund-never-sent-0001",
  });
  assert.equal(
    (
      await db.serviceOrder.findUniqueOrThrow({
        where: { id: unusableNeverSent.serviceOrder.id },
        select: { status: true },
      })
    ).status,
    ServiceOrderStatus.REFUNDED,
  );

  const retryConfirmedAbsent = await seedRuntimeOrder({
    id: "retry-confirmed-absent",
    infrastructureStatus: InfrastructureOrderStatus.FAILED,
    productFlowState: "PROVISIONING_MANUAL_REVIEW",
  });
  const retryConfirmedAttempt = await db.provisioningJob.create({
    data: {
      infrastructureOrderId:
        retryConfirmedAbsent.infrastructureOrder.id,
      operation: "create_instance",
      status: ProvisioningJobStatus.FAILED,
      idempotencyKey: "runtime-retry-confirmed-attempt",
      attempt: 1,
      createSentAt: new Date(),
      lastErrorCode: "provider_timeout",
      finishedAt: new Date(),
    },
  });
  const retryAbsenceAdapter = new FakeCloudProviderAdapter({
    provider: InfrastructureProvider.ARVAN,
    observedResource: null,
  });
  await confirmNoProviderResource(
    {
      infrastructureOrderId:
        retryConfirmedAbsent.infrastructureOrder.id,
      adminUserId: "migration-admin",
      reason: "عدم وجود Resource برای Retry قطعی شد",
      idempotencyKey: "postgres-confirm-retry-absent-0001",
    },
    retryAbsenceAdapter,
  );
  const retryResult = await retryFailedProvisioning({
    infrastructureOrderId:
      retryConfirmedAbsent.infrastructureOrder.id,
    adminUserId: "migration-admin",
    reason: "Retry پس از تأیید رسمی نبود Resource",
    idempotencyKey: "postgres-retry-after-absence-0001",
  });
  assert.equal(retryResult.job.operation, "create_instance");
  assert.equal(retryResult.job.attempt, 2);
  assert.equal(
    retryResult.job.status,
    ProvisioningJobStatus.QUEUED,
  );
  assert.notEqual(retryResult.job.id, retryConfirmedAttempt.id);
  assert.equal(retryAbsenceAdapter.createCalls.length, 0);
  assert.deepEqual(
    await db.infrastructureOrder.findUniqueOrThrow({
      where: {
        id: retryConfirmedAbsent.infrastructureOrder.id,
      },
      select: {
        productFlowState: true,
        status: true,
        reconcileNoResourceConfirmedAt: true,
        reconcileNoResourceConfirmedJobId: true,
        reconcileNoResourceConfirmedAttempt: true,
      },
    }),
    {
      productFlowState: "PROVISIONING_SUBMITTED",
      status: InfrastructureOrderStatus.QUEUED,
      reconcileNoResourceConfirmedAt: null,
      reconcileNoResourceConfirmedJobId: null,
      reconcileNoResourceConfirmedAttempt: null,
    },
  );
  await db.provisioningJob.update({
    where: { id: retryResult.job.id },
    data: {
      status: ProvisioningJobStatus.FAILED,
      finishedAt: new Date(),
      lastErrorCode: "test_cleanup_without_execution",
    },
  });

  const resourceFoundManual = await seedRuntimeOrder({
    id: "manual-resource-found",
    infrastructureStatus: InfrastructureOrderStatus.MANUAL_REVIEW,
    productFlowState: "PROVISIONING_MANUAL_REVIEW",
  });
  const resourceFoundAdapter = new FakeCloudProviderAdapter({
    provider: InfrastructureProvider.ARVAN,
    observedResource: {
      state: "active",
      ipv4: "192.0.2.60",
      networkIds: null,
      securityIds: null,
    },
  });
  const foundTask = await resourceFoundAdapter.createServer({
    productKind:
      InfrastructureProductKind.READY_INSTANT_SERVER,
    region: "tehran",
    externalPlanId: "s1",
    externalImageId: "ubuntu",
    externalNetworkId: null,
    externalSecurityId: null,
    accessMethod: "SSH_KEY",
    sshKeyEnabled: true,
    sshKeyName: "migration-key",
    name: "abrchin-manual-resource-found",
    orderPublicId: resourceFoundManual.infrastructureOrder.id,
    idempotencyKey: "fake-setup-manual-resource-found",
  });
  await resourceFoundAdapter.getTaskStatus({
    region: "tehran",
    taskId: foundTask.taskId,
    resourceId: foundTask.resourceId,
  });
  await db.infrastructureOrder.update({
    where: { id: resourceFoundManual.infrastructureOrder.id },
    data: {
      desiredInstanceName: "abrchin-manual-resource-found",
    },
  });
  await db.provisioningJob.create({
    data: {
      infrastructureOrderId:
        resourceFoundManual.infrastructureOrder.id,
      operation: "create_instance",
      status: ProvisioningJobStatus.NEEDS_RECONCILIATION,
      idempotencyKey: "runtime-manual-resource-found-attempt",
      attempt: 1,
      createSentAt: new Date(),
      providerResourceId: foundTask.resourceId,
      lastErrorCode: "provider_ambiguous",
      finishedAt: new Date(),
    },
  });
  const foundCreateCalls =
    resourceFoundAdapter.createCalls.length;
  const reconciledFound = await reconcileInfrastructureOrder(
    {
      infrastructureOrderId:
        resourceFoundManual.infrastructureOrder.id,
      adminUserId: "migration-admin",
      reason: "Resource موجود با GET Provider پیدا شد",
      idempotencyKey: "postgres-reconcile-found-0001",
    },
    resourceFoundAdapter,
  );
  assert.equal(reconciledFound.instance.id, foundTask.resourceId);
  assert.equal(reconciledFound.job.operation, "poll_instance");
  assert.equal(
    resourceFoundAdapter.createCalls.length,
    foundCreateCalls,
  );
  assert.deepEqual(
    await db.infrastructureOrder.findUniqueOrThrow({
      where: {
        id: resourceFoundManual.infrastructureOrder.id,
      },
      select: {
        productFlowState: true,
        status: true,
        cloudInstance: {
          select: { providerInstanceId: true },
        },
      },
    }),
    {
      productFlowState: "PROVISIONING",
      status: InfrastructureOrderStatus.PROVISIONING,
      cloudInstance: {
        providerInstanceId: foundTask.resourceId,
      },
    },
  );
  await db.provisioningJob.update({
    where: { id: reconciledFound.job.id },
    data: {
      status: ProvisioningJobStatus.FAILED,
      finishedAt: new Date(),
      lastErrorCode: "test_cleanup_without_execution",
    },
  });

  const fundingFirst = await seedRuntimeOrder({
    id: "funding-first",
    infrastructureStatus:
      InfrastructureOrderStatus.WAITING_ADMIN_FUNDING,
  });
  const fundingSecond = await seedRuntimeOrder({
    id: "funding-second",
    infrastructureStatus:
      InfrastructureOrderStatus.WAITING_ADMIN_FUNDING,
  });
  const fundingKey = "postgres-funding-shared-key";
  await assert.rejects(
    confirmProviderFunding({
      infrastructureOrderId:
        fundingFirst.infrastructureOrder.id,
      adminUserId: "migration-admin",
      fundedAmountToman: 500_000,
      receiptReference: "receipt-a",
      note: "funding-a",
      idempotencyKey: fundingKey,
    }),
    /فقط از مسیر فرمان Provision|route_retired/,
  );
  assert.equal(
    await db.providerFundingConfirmation.count({
      where: { idempotencyKey: fundingKey },
    }),
    0,
  );
  assert.deepEqual(
    await db.infrastructureOrder.findUniqueOrThrow({
      where: { id: fundingFirst.infrastructureOrder.id },
      select: {
        status: true,
        productFlowState: true,
        provisioningJobs: { select: { id: true } },
      },
    }),
    {
      status: InfrastructureOrderStatus.WAITING_ADMIN_FUNDING,
      productFlowState: "PAID",
      provisioningJobs: [],
    },
  );

  await writeAuditLog({
    actorUserId: "migration-admin",
    action: "postgres_idempotency_test",
    entityType: "service_order",
    entityId: fundingFirst.serviceOrder.id,
    afterData: { value: "stable" },
    idempotencyKey: "audit-postgres-conflict-key",
  });
  await assert.rejects(
    writeAuditLog({
      actorUserId: "migration-admin",
      action: "postgres_idempotency_test",
      entityType: "service_order",
      entityId: fundingSecond.serviceOrder.id,
      afterData: { value: "different" },
      idempotencyKey: "audit-postgres-conflict-key",
    }),
    /idempotency_conflict/,
  );
  assert.equal(
    await db.auditLog.count({
      where: { idempotencyKey: "audit-postgres-conflict-key" },
    }),
    1,
  );
  const concurrentAuditReplay = await Promise.all([
    writeAuditLog({
      actorUserId: "migration-admin",
      action: "postgres_concurrent_audit",
      entityType: "service_order",
      entityId: fundingFirst.serviceOrder.id,
      afterData: { value: "same" },
      idempotencyKey: "audit-postgres-concurrent-same",
    }),
    writeAuditLog({
      actorUserId: "migration-admin",
      action: "postgres_concurrent_audit",
      entityType: "service_order",
      entityId: fundingFirst.serviceOrder.id,
      afterData: { value: "same" },
      idempotencyKey: "audit-postgres-concurrent-same",
    }),
  ]);
  assert.equal(
    concurrentAuditReplay[0].id,
    concurrentAuditReplay[1].id,
  );
  assert.equal(
    await db.auditLog.count({
      where: {
        idempotencyKey: "audit-postgres-concurrent-same",
      },
    }),
    1,
  );
  const concurrentAuditConflict = await Promise.allSettled([
    writeAuditLog({
      actorUserId: "migration-admin",
      action: "postgres_concurrent_audit",
      entityType: "service_order",
      entityId: fundingFirst.serviceOrder.id,
      afterData: { value: "first" },
      idempotencyKey: "audit-postgres-concurrent-conflict",
    }),
    writeAuditLog({
      actorUserId: "migration-admin",
      action: "postgres_concurrent_audit",
      entityType: "service_order",
      entityId: fundingSecond.serviceOrder.id,
      afterData: { value: "second" },
      idempotencyKey: "audit-postgres-concurrent-conflict",
    }),
  ]);
  assert.deepEqual(
    concurrentAuditConflict.map((result) => result.status).sort(),
    ["fulfilled", "rejected"],
  );
  const concurrentAuditError = concurrentAuditConflict.find(
    (result): result is PromiseRejectedResult =>
      result.status === "rejected",
  );
  assert.match(
    String(concurrentAuditError?.reason),
    /idempotency_conflict/,
  );
  assert.equal(
    await db.auditLog.count({
      where: {
        idempotencyKey:
          "audit-postgres-concurrent-conflict",
      },
    }),
    1,
  );

  const { runInfrastructureHealthCheck } = await import(
    "../lib/infrastructure/health-check-service.ts"
  );
  const {
    observeManualReviewResource,
    processPendingHealthRetryDispatches,
    processHealthCheckRetryJob,
    scheduleAutomaticHealthRetry,
    scheduleManualHealthRecovery,
    scheduleManualHealthRetry,
  } = await import(
    "../lib/infrastructure/health-retry-service.ts"
  );
  const {
    claimNextProvisioningJob,
    processProvisioningJob,
    reconcileProvisioningDispatches,
    recoverExpiredProvisioningJobs,
  } = await import("../lib/infrastructure/provisioning-service.ts");

  async function seedHealthGraph(input: {
    id: string;
    provider: InfrastructureProvider;
    flowState?:
      | "PROVISIONING"
      | "HEALTH_CHECK_FAILED"
      | "PROVISIONING_MANUAL_REVIEW";
    providerState: string | null;
    ipv4: string | null;
    networkId: string | null;
    securityId: string | null;
    providerObservedAt: Date | null;
    providerInstanceId?: string;
  }) {
    const productKind = InfrastructureProductKind.CLOUD_SERVER;
    const planId = "migration-arvan-plan";
    const region = "ir-thr-ba1";
    const externalPlanId = "g6";
    const topologyVerificationMode = "STRICT_OBSERVED";
    const externalNetworkId = "network-1";
    const externalSecurityId = "security-1";
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
    await db.recommendationSession.create({
      data: {
        id: `health-session-${input.id}`,
        userId: "migration-user",
        status: "CONVERTED",
        answers: {},
        answerSources: {},
        productFlowState: flowState,
        productFlowRevision: 0,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await db.recommendationQuote.create({
      data: {
        id: `health-quote-${input.id}`,
        sessionId: `health-session-${input.id}`,
        planId,
        role: "RECOMMENDED",
        status: "CONVERTED",
        score: 100,
        scoreBreakdown: {},
        reasons: [],
        profileSnapshot: {},
        planSnapshot: { immutable: input.id },
        amountRial: 6_250_000n,
        renewalAmountRial: 6_250_000n,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
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
        recommendationQuoteId: `health-quote-${input.id}`,
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
        status:
          flowState === "PROVISIONING_MANUAL_REVIEW"
            ? InfrastructureOrderStatus.MANUAL_REVIEW
            : InfrastructureOrderStatus.PROVISIONING,
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
    await db.adminCommandReceipt.create({
      data: {
        operation: "APPROVE_PROVISION",
        idempotencyKey:
          `admin-command:provision-approve:health-${input.id}`,
        requestFingerprint:
          `migration-health-approval-${input.id}`,
        actorUserId: "migration-admin",
        infrastructureOrderId: `infra-${input.id}`,
        resultSnapshot: {
          approved: true,
          containsSecret: false,
        },
      },
    });
    return `infra-${input.id}`;
  }

  const arvanSuccess = await seedHealthGraph({
    id: "arvan-success",
    provider: InfrastructureProvider.ARVAN,
    providerState: "active",
    ipv4: "192.0.2.21",
    networkId: "network-1",
    securityId: "security-1",
    providerObservedAt: now,
  });
  const arvanResult = await runInfrastructureHealthCheck({
    infrastructureOrderId: arvanSuccess,
    probe: async () => true,
  });
  assert.deepEqual(arvanResult, {
    healthy: true,
    delivered: false,
  });
  assert.deepEqual(
    await db.infrastructureOrder.findUniqueOrThrow({
      where: { id: arvanSuccess },
      select: {
        productFlowState: true,
        secureDeliveryEvents: {
          select: { status: true, resultCode: true },
        },
      },
    }),
    {
      productFlowState: "WAITING_ADMIN_DELIVERY_APPROVAL",
      secureDeliveryEvents: [
        {
          status: "PENDING",
          resultCode: "waiting_admin_delivery_approval",
        },
      ],
    },
  );
  const arvanCheck =
    await db.infrastructureHealthCheck.findFirstOrThrow({
      where: { infrastructureOrderId: arvanSuccess },
    });
  assert.equal(
    arvanCheck.topologyVerificationMode,
    "STRICT_OBSERVED",
  );
  assert.equal(arvanCheck.observedNetworkId, "network-1");
  assert.equal(arvanCheck.observedSecurityId, "security-1");

  for (const [id, providerState, ipv4] of [
    ["arvan-no-ip", "active", null],
    ["arvan-unknown", "unknown", "192.0.2.22"],
  ] as const) {
    const infraId = await seedHealthGraph({
      id,
      provider: InfrastructureProvider.ARVAN,
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
    /دلیل عملیات/,
  );
  await assert.rejects(
    scheduleManualHealthRetry({
      infrastructureOrderId: retryInfraId,
      adminUserId: "migration-admin",
      reason: "valid reason",
      idempotencyKey: "short",
    }),
    /شناسه یکتای عملیات/,
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
  await assert.rejects(
    scheduleManualHealthRetry({
      infrastructureOrderId: retryInfraId,
      adminUserId: "migration-admin",
      reason: "different reason must conflict",
      idempotencyKey: "health-retry-concurrent-0001",
    }),
    /شناسه یکتا|idempotency_conflict/,
  );
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
          "audit:health-retry:health-retry-concurrent-0001",
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
    {
      claimToken: claimed[0]!.claimToken,
      healthProbe: async () => false,
    },
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
      claimToken: next.claimToken,
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
  const retryReceiptAfterFailure = await scheduleManualHealthRetry({
    infrastructureOrderId: retryInfraId,
    adminUserId: "migration-admin",
    reason: "manual health retry",
    idempotencyKey: "health-retry-concurrent-0001",
  });
  assert.equal(retryReceiptAfterFailure.id, scheduled[0].id);
  assert.equal(
    retryReceiptAfterFailure.status,
    scheduled[0].status,
  );
  assert.equal(
    retryReceiptAfterFailure.availableAt.toISOString(),
    scheduled[0].availableAt.toISOString(),
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

  const lockedBeforeManualRecovery =
    await db.infrastructureOrder.findUniqueOrThrow({
      where: { id: retryInfraId },
      select: {
        provider: true,
        providerApiVersion: true,
        providerSelectionSnapshot: true,
        cloudInstance: {
          select: { providerInstanceId: true },
        },
      },
    });
  const observedOnce = await observeManualReviewResource(
    {
      infrastructureOrderId: retryInfraId,
      adminUserId: "migration-admin",
      reason: "تطبیق دستی منبع موجود",
      idempotencyKey: "manual-observe-replay-0001",
    },
    retryAdapter,
  );
  const observedReplay = await observeManualReviewResource(
    {
      infrastructureOrderId: retryInfraId,
      adminUserId: "migration-admin",
      reason: "تطبیق دستی منبع موجود",
      idempotencyKey: "manual-observe-replay-0001",
    },
    retryAdapter,
  );
  assert.deepEqual(observedReplay, observedOnce);
  await assert.rejects(
    observeManualReviewResource(
      {
        infrastructureOrderId: retryInfraId,
        adminUserId: "migration-admin",
        reason: "payload متفاوت برای همان کلید",
        idempotencyKey: "manual-observe-replay-0001",
      },
      retryAdapter,
    ),
    /شناسه یکتا|idempotency_conflict/,
  );

  const manualRecoveryJobs = await Promise.all([
    scheduleManualHealthRecovery({
      infrastructureOrderId: retryInfraId,
      adminUserId: "migration-admin",
      reason: "اصلاح دستی انجام شد",
      idempotencyKey: "manual-recovery-success-0001",
    }),
    scheduleManualHealthRecovery({
      infrastructureOrderId: retryInfraId,
      adminUserId: "migration-admin",
      reason: "اصلاح دستی انجام شد",
      idempotencyKey: "manual-recovery-success-0001",
    }),
  ]);
  assert.equal(
    manualRecoveryJobs[0].id,
    manualRecoveryJobs[1].id,
  );
  assert.equal(manualRecoveryJobs[0].attempt, 1);
  await assert.rejects(
    scheduleManualHealthRecovery({
      infrastructureOrderId: retryInfraId,
      adminUserId: "migration-admin",
      reason: "درخواست هم‌زمان دوم",
      idempotencyKey: "manual-recovery-parallel-0002",
    }),
    /در حال اجرا/,
  );
  await db.provisioningJob.update({
    where: { id: manualRecoveryJobs[0].id },
    data: { availableAt: new Date(0) },
  });
  const claimedManual = await claimNextProvisioningJob(
    "manual-health-worker-success",
  );
  assert.equal(claimedManual?.id, manualRecoveryJobs[0].id);
  await processHealthCheckRetryJob(
    claimedManual!.id,
    retryAdapter,
    {
      claimToken: claimedManual!.claimToken,
      healthProbe: async () => true,
    },
  );
  const recoveredManually =
    await db.infrastructureOrder.findUniqueOrThrow({
      where: { id: retryInfraId },
      include: {
        cloudInstance: true,
        secureDeliveryEvents: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true, resultCode: true },
        },
      },
    });
  assert.equal(
    recoveredManually.productFlowState,
    "WAITING_ADMIN_DELIVERY_APPROVAL",
  );
  assert.equal(
    recoveredManually.status,
    InfrastructureOrderStatus.PROVISIONING,
  );
  assert.deepEqual(recoveredManually.secureDeliveryEvents, [
    {
      status: "PENDING",
      resultCode: "waiting_admin_delivery_approval",
    },
  ]);
  assert.equal(
    retryAdapter.createCalls.length,
    createCallsBeforeRetry,
  );
  assert.deepEqual(
    {
      provider: recoveredManually.provider,
      providerApiVersion:
        recoveredManually.providerApiVersion,
      providerSelectionSnapshot:
        recoveredManually.providerSelectionSnapshot,
      providerInstanceId:
        recoveredManually.cloudInstance?.providerInstanceId,
    },
    {
      provider: lockedBeforeManualRecovery.provider,
      providerApiVersion:
        lockedBeforeManualRecovery.providerApiVersion,
      providerSelectionSnapshot:
        lockedBeforeManualRecovery.providerSelectionSnapshot,
      providerInstanceId:
        lockedBeforeManualRecovery.cloudInstance
          ?.providerInstanceId,
    },
  );

  const failedManualAdapter = new FakeCloudProviderAdapter({
    provider: InfrastructureProvider.ARVAN,
    observedResource: {
      state: "active",
      ipv4: "192.0.2.41",
      networkIds: ["network-1"],
      securityIds: ["security-1"],
    },
  });
  const failedManualTask =
    await failedManualAdapter.createServer({
      productKind: InfrastructureProductKind.CLOUD_SERVER,
      region: "ir-thr-ba1",
      externalPlanId: "g6",
      externalImageId: "ubuntu",
      externalNetworkId: "network-1",
      externalSecurityId: "security-1",
      accessMethod: "SSH_KEY",
      sshKeyEnabled: true,
      sshKeyName: "migration-key",
      name: "abrchin-manual-failure-1",
      orderPublicId: "infra-manual-failure",
      idempotencyKey: "fake-setup-manual-failure",
    });
  await failedManualAdapter.getTaskStatus({
    region: "ir-thr-ba1",
    taskId: failedManualTask.taskId,
    resourceId: failedManualTask.resourceId,
  });
  const failedManualInfraId = await seedHealthGraph({
    id: "manual-failure",
    provider: InfrastructureProvider.ARVAN,
    flowState: "PROVISIONING_MANUAL_REVIEW",
    providerState: "active",
    ipv4: "192.0.2.41",
    networkId: "network-1",
    securityId: "security-1",
    providerObservedAt: now,
    providerInstanceId: failedManualTask.resourceId!,
  });
  const failedManualJob = await scheduleManualHealthRecovery({
    infrastructureOrderId: failedManualInfraId,
    adminUserId: "migration-admin",
    reason: "بررسی دستی ناموفق",
    idempotencyKey: "manual-recovery-failure-0001",
  });
  const failedManualCreateCalls =
    failedManualAdapter.createCalls.length;
  await db.provisioningJob.update({
    where: { id: failedManualJob.id },
    data: { availableAt: new Date(0) },
  });
  const claimedFailedManual = await claimNextProvisioningJob(
    "manual-health-worker-failed",
  );
  assert.equal(claimedFailedManual?.id, failedManualJob.id);
  await processHealthCheckRetryJob(
    claimedFailedManual!.id,
    failedManualAdapter,
    {
      claimToken: claimedFailedManual!.claimToken,
      healthProbe: async () => false,
    },
  );
  const returnedToManual =
    await db.infrastructureOrder.findUniqueOrThrow({
      where: { id: failedManualInfraId },
    });
  assert.equal(
    returnedToManual.productFlowState,
    "PROVISIONING_MANUAL_REVIEW",
  );
  assert.equal(
    returnedToManual.status,
    InfrastructureOrderStatus.MANUAL_REVIEW,
  );
  assert.equal(
    failedManualAdapter.createCalls.length,
    failedManualCreateCalls,
  );
  assert.equal(
    await db.provisioningJob.count({
      where: {
        infrastructureOrderId: failedManualInfraId,
        operation: "health_check_manual_recovery",
      },
    }),
    1,
  );

  async function createObservedHealthAdapter(input: {
    id: string;
    ipv4: string;
  }) {
    const adapter = new FakeCloudProviderAdapter({
      provider: InfrastructureProvider.ARVAN,
      observedResource: {
        state: "active",
        ipv4: input.ipv4,
        networkIds: ["network-1"],
        securityIds: ["security-1"],
      },
    });
    const task = await adapter.createServer({
      productKind: InfrastructureProductKind.CLOUD_SERVER,
      region: "ir-thr-ba1",
      externalPlanId: "g6",
      externalImageId: "ubuntu",
      externalNetworkId: "network-1",
      externalSecurityId: "security-1",
      accessMethod: "SSH_KEY",
      sshKeyEnabled: true,
      sshKeyName: "migration-key",
      name: `abrchin-${input.id}-1`,
      orderPublicId: `infra-${input.id}`,
      idempotencyKey: `fake-setup-${input.id}`,
    });
    await adapter.getTaskStatus({
      region: "ir-thr-ba1",
      taskId: task.taskId,
      resourceId: task.resourceId,
    });
    return { adapter, task };
  }

  async function claimManualRecovery(input: {
    id: string;
    ipv4: string;
  }) {
    const setup = await createObservedHealthAdapter(input);
    const infrastructureOrderId = await seedHealthGraph({
      id: input.id,
      provider: InfrastructureProvider.ARVAN,
      flowState: "PROVISIONING_MANUAL_REVIEW",
      providerState: "active",
      ipv4: input.ipv4,
      networkId: "network-1",
      securityId: "security-1",
      providerObservedAt: now,
      providerInstanceId: setup.task.resourceId!,
    });
    const job = await scheduleManualHealthRecovery({
      infrastructureOrderId,
      adminUserId: "migration-admin",
      reason: `بررسی دستی ${input.id}`,
      idempotencyKey: `manual-recovery-${input.id}-0001`,
    });
    await db.provisioningJob.update({
      where: { id: job.id },
      data: { availableAt: new Date(0) },
    });
    const claimedJob = await claimNextProvisioningJob(
      `worker-${input.id}`,
    );
    assert.equal(claimedJob?.id, job.id);
    return {
      ...setup,
      infrastructureOrderId,
      job,
      claimedJob: claimedJob!,
      createCallsBefore: setup.adapter.createCalls.length,
    };
  }

  const attachedSetup = await createObservedHealthAdapter({
    id: "admin-attached-auto",
    ipv4: "192.0.2.50",
  });
  const attachedInfraId = await seedHealthGraph({
    id: "admin-attached-auto",
    provider: InfrastructureProvider.ARVAN,
    flowState: "HEALTH_CHECK_FAILED",
    providerState: "active",
    ipv4: "192.0.2.50",
    networkId: "network-1",
    securityId: "security-1",
    providerObservedAt: now,
    providerInstanceId: attachedSetup.task.resourceId!,
  });
  const automaticJob = await scheduleAutomaticHealthRetry({
    infrastructureOrderId: attachedInfraId,
    sourceCheckId: "source-check-admin-attached",
  });
  assert.ok(automaticJob);
  const attachedReceipt = await scheduleManualHealthRetry({
    infrastructureOrderId: attachedInfraId,
    adminUserId: "migration-admin",
    reason: "اجرای فوری Retry خودکار موجود",
    idempotencyKey: "health-retry-attached-auto-0001",
  });
  const attachedReplayBefore = await scheduleManualHealthRetry({
    infrastructureOrderId: attachedInfraId,
    adminUserId: "migration-admin",
    reason: "اجرای فوری Retry خودکار موجود",
    idempotencyKey: "health-retry-attached-auto-0001",
  });
  assert.equal(attachedReceipt.id, automaticJob!.id);
  assert.equal(attachedReplayBefore.id, attachedReceipt.id);
  assert.equal(
    attachedReplayBefore.status,
    attachedReceipt.status,
  );
  await db.provisioningJob.update({
    where: { id: attachedReceipt.id },
    data: { availableAt: new Date(0) },
  });
  const attachedClaim = await claimNextProvisioningJob(
    "worker-admin-attached-auto",
  );
  assert.equal(attachedClaim?.id, attachedReceipt.id);
  const attachedCreateCalls =
    attachedSetup.adapter.createCalls.length;
  await processHealthCheckRetryJob(
    attachedClaim!.id,
    attachedSetup.adapter,
    {
      claimToken: attachedClaim!.claimToken,
      healthProbe: async () => true,
    },
  );
  assert.equal(
    (
      await db.infrastructureOrder.findUniqueOrThrow({
        where: { id: attachedInfraId },
        select: { productFlowState: true },
      })
    ).productFlowState,
    "WAITING_ADMIN_DELIVERY_APPROVAL",
  );
  const attachedReplayAfter = await scheduleManualHealthRetry({
    infrastructureOrderId: attachedInfraId,
    adminUserId: "migration-admin",
    reason: "اجرای فوری Retry خودکار موجود",
    idempotencyKey: "health-retry-attached-auto-0001",
  });
  assert.equal(attachedReplayAfter.id, attachedReceipt.id);
  assert.equal(attachedReplayAfter.status, attachedReceipt.status);
  assert.equal(
    attachedReplayAfter.availableAt.toISOString(),
    attachedReceipt.availableAt.toISOString(),
  );
  await assert.rejects(
    scheduleManualHealthRetry({
      infrastructureOrderId: attachedInfraId,
      adminUserId: "migration-admin",
      reason: "Payload متفاوت پس از پایان Job",
      idempotencyKey: "health-retry-attached-auto-0001",
    }),
    /شناسه یکتا|idempotency_conflict/,
  );
  assert.equal(
    attachedSetup.adapter.createCalls.length,
    attachedCreateCalls,
  );

  const finalizeFailure = await claimManualRecovery({
    id: "finalize-failure-after-active",
    ipv4: "192.0.2.51",
  });
  const finalizePending = await processHealthCheckRetryJob(
    finalizeFailure.claimedJob.id,
    finalizeFailure.adapter,
    {
      claimToken: finalizeFailure.claimedJob.claimToken,
      healthProbe: async () => true,
      beforeFinalizeJob: () => {
        throw new Error("injected_finalize_failure");
      },
    },
  );
  assert.equal(finalizePending?.healthy, true);
  assert.equal(
    "finalizePending" in finalizePending! &&
      finalizePending.finalizePending,
    true,
  );
  const activeAfterFinalizeFailure =
    await db.infrastructureOrder.findUniqueOrThrow({
      where: {
        id: finalizeFailure.infrastructureOrderId,
      },
      select: {
        status: true,
        productFlowState: true,
      },
    });
  assert.deepEqual(activeAfterFinalizeFailure, {
    status: InfrastructureOrderStatus.PROVISIONING,
    productFlowState: "WAITING_ADMIN_DELIVERY_APPROVAL",
  });
  const staleClaimToken = finalizeFailure.claimedJob.claimToken;
  await db.provisioningJob.update({
    where: { id: finalizeFailure.job.id },
    data: { leaseExpiresAt: new Date(0) },
  });
  await recoverExpiredProvisioningJobs();
  const replacementClaim = await claimNextProvisioningJob(
    "worker-finalize-replacement",
  );
  assert.equal(replacementClaim?.id, finalizeFailure.job.id);
  await processHealthCheckRetryJob(
    replacementClaim!.id,
    finalizeFailure.adapter,
    {
      claimToken: replacementClaim!.claimToken,
      healthProbe: async () => true,
    },
  );
  const staleWorkerResult = await processHealthCheckRetryJob(
    finalizeFailure.job.id,
    finalizeFailure.adapter,
    {
      claimToken: staleClaimToken,
      healthProbe: async () => false,
    },
  );
  assert.equal(staleWorkerResult, null);
  assert.deepEqual(
    await db.infrastructureOrder.findUniqueOrThrow({
      where: {
        id: finalizeFailure.infrastructureOrderId,
      },
      select: {
        status: true,
        productFlowState: true,
      },
    }),
    {
      status: InfrastructureOrderStatus.PROVISIONING,
      productFlowState: "WAITING_ADMIN_DELIVERY_APPROVAL",
    },
  );
  assert.equal(
    finalizeFailure.adapter.createCalls.length,
    finalizeFailure.createCallsBefore,
  );

  const transitionFailure = await claimManualRecovery({
    id: "failure-after-health-transition",
    ipv4: "192.0.2.52",
  });
  await processHealthCheckRetryJob(
    transitionFailure.claimedJob.id,
    transitionFailure.adapter,
    {
      claimToken: transitionFailure.claimedJob.claimToken,
      healthProbe: async () => true,
      afterHealthTransition: () => {
        throw new Error("injected_after_health_transition");
      },
    },
  );
  const transitionFailureGraph = await db.$queryRawUnsafe<
    Array<{
      sessionState: string;
      serviceState: string;
      infrastructureState: string;
      sessionRevision: number;
      serviceRevision: number;
      infrastructureRevision: number;
      infrastructureStatus: string;
    }>
  >(`
    SELECT
      session."productFlowState" AS "sessionState",
      service."productFlowState" AS "serviceState",
      infrastructure."productFlowState" AS
        "infrastructureState",
      session."productFlowRevision" AS "sessionRevision",
      service."productFlowRevision" AS "serviceRevision",
      infrastructure."productFlowRevision" AS
        "infrastructureRevision",
      infrastructure.status::text AS "infrastructureStatus"
    FROM "InfrastructureOrder" infrastructure
    JOIN "ServiceOrder" service
      ON service.id = infrastructure."serviceOrderId"
    JOIN "RecommendationQuote" quote
      ON quote.id = service."recommendationQuoteId"
    JOIN "RecommendationSession" session
      ON session.id = quote."sessionId"
    WHERE infrastructure.id =
      '${transitionFailure.infrastructureOrderId}'
  `);
  assert.deepEqual(
    {
      ...transitionFailureGraph[0],
      aligned:
        transitionFailureGraph[0]?.sessionRevision ===
          transitionFailureGraph[0]?.serviceRevision &&
        transitionFailureGraph[0]?.serviceRevision ===
          transitionFailureGraph[0]?.infrastructureRevision,
    },
    {
      sessionState: "PROVISIONING_MANUAL_REVIEW",
      serviceState: "PROVISIONING_MANUAL_REVIEW",
      infrastructureState: "PROVISIONING_MANUAL_REVIEW",
      sessionRevision: 3,
      serviceRevision: 3,
      infrastructureRevision: 3,
      infrastructureStatus: "MANUAL_REVIEW",
      aligned: true,
    },
  );
  assert.equal(
    transitionFailure.adapter.createCalls.length,
    transitionFailure.createCallsBefore,
  );

  const auditNotificationFailure = await claimManualRecovery({
    id: "audit-notification-failure",
    ipv4: "192.0.2.53",
  });
  await processHealthCheckRetryJob(
    auditNotificationFailure.claimedJob.id,
    auditNotificationFailure.adapter,
    {
      claimToken: auditNotificationFailure.claimedJob.claimToken,
      healthProbe: async () => true,
      beforeResultAudit: () => {
        throw new Error("injected_result_audit_failure");
      },
      beforeSuccessNotification: () => {
        throw new Error("injected_notification_failure");
      },
    },
  );
  assert.deepEqual(
    await db.infrastructureOrder.findUniqueOrThrow({
      where: {
        id: auditNotificationFailure.infrastructureOrderId,
      },
      select: {
        status: true,
        productFlowState: true,
      },
    }),
    {
      status: InfrastructureOrderStatus.PROVISIONING,
      productFlowState: "WAITING_ADMIN_DELIVERY_APPROVAL",
    },
  );
  assert.equal(
    auditNotificationFailure.adapter.createCalls.length,
    auditNotificationFailure.createCallsBefore,
  );

  async function seedMainProvisioning(input: {
    id: string;
  }) {
    const seeded = await seedRuntimeOrder({
      id: input.id,
      infrastructureStatus: InfrastructureOrderStatus.QUEUED,
      productFlowState: "PROVISIONING_SUBMITTED",
    });
    const job = await db.provisioningJob.create({
      data: {
        infrastructureOrderId: seeded.infrastructureOrder.id,
        operation: "create_instance",
        status: ProvisioningJobStatus.QUEUED,
        idempotencyKey: `main-provisioning:${input.id}`,
        attempt: 1,
        availableAt: new Date(0),
      },
    });
    await db.adminCommandReceipt.create({
      data: {
        operation: "APPROVE_PROVISION",
        idempotencyKey:
          `admin-command:provision-approve:main-${input.id}`,
        requestFingerprint:
          `migration-main-provision-approval-${input.id}`,
        actorUserId: "migration-admin",
        infrastructureOrderId: seeded.infrastructureOrder.id,
        resultSnapshot: {
          approved: true,
          containsSecret: false,
        },
      },
    });
    return { ...seeded, job };
  }

  async function claimOnly(
    jobId: string,
    workerId: string,
  ) {
    await db.provisioningJob.updateMany({
      where: {
        status: ProvisioningJobStatus.QUEUED,
        id: { not: jobId },
      },
      data: {
        availableAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const claimed = await claimNextProvisioningJob(workerId);
    assert.equal(claimed?.id, jobId);
    assert.ok(claimed?.claimToken);
    return claimed!;
  }

  function mainAdapter() {
    return new FakeCloudProviderAdapter({
      provider: InfrastructureProvider.ARVAN,
      observedResource: {
        state: "active",
        ipv4: "192.0.2.80",
        networkIds: null,
        securityIds: null,
      },
    });
  }

  const noToken = await seedMainProvisioning({
    id: "claim-token-required",
  });
  const noTokenClaim = await claimOnly(
    noToken.job.id,
    "main-no-token-worker",
  );
  const noTokenBefore =
    await db.provisioningJob.findUniqueOrThrow({
      where: { id: noTokenClaim.id },
    });
  assert.equal(
    await processProvisioningJob(
      noTokenClaim.id,
      mainAdapter(),
      undefined,
    ),
    null,
  );
  const noTokenAfter =
    await db.provisioningJob.findUniqueOrThrow({
      where: { id: noTokenClaim.id },
    });
  assert.equal(noTokenAfter.status, noTokenBefore.status);
  assert.equal(noTokenAfter.claimToken, noTokenBefore.claimToken);
  assert.equal(noTokenAfter.createSentAt, null);
  await db.provisioningJob.update({
    where: { id: noTokenClaim.id },
    data: {
      status: ProvisioningJobStatus.FAILED,
      claimToken: null,
      workerId: null,
      leaseExpiresAt: null,
      finishedAt: new Date(),
    },
  });

  const staleMain = await seedMainProvisioning({
    id: "stale-create-fence",
  });
  const staleAdapter = mainAdapter();
  const originalCreate =
    staleAdapter.createServer.bind(staleAdapter);
  let providerAccepted!: () => void;
  let releaseProviderResponse!: () => void;
  const providerAcceptedPromise = new Promise<void>((resolve) => {
    providerAccepted = resolve;
  });
  const releaseProviderPromise = new Promise<void>((resolve) => {
    releaseProviderResponse = resolve;
  });
  staleAdapter.createServer = async (input) => {
    const task = await originalCreate(input);
    providerAccepted();
    await releaseProviderPromise;
    return task;
  };
  const workerA = await claimOnly(
    staleMain.job.id,
    "main-stale-worker-a",
  );
  const workerAPromise = processProvisioningJob(
    workerA.id,
    staleAdapter,
    {
      claimToken: workerA.claimToken!,
      healthProbe: async () => true,
    },
  );
  await providerAcceptedPromise;
  await db.provisioningJob.update({
    where: { id: workerA.id },
    data: { leaseExpiresAt: new Date(Date.now() - 1000) },
  });
  await recoverExpiredProvisioningJobs();
  const workerB = await claimOnly(
    staleMain.job.id,
    "main-stale-worker-b",
  );
  const workerBResult = await processProvisioningJob(
    workerB.id,
    staleAdapter,
    {
      claimToken: workerB.claimToken!,
      healthProbe: async () => true,
    },
  );
  releaseProviderResponse();
  const workerAResult = await workerAPromise;
  assert.equal(workerAResult, null);
  assert.equal(workerBResult?.healthy, true);
  assert.equal(staleAdapter.createCalls.length, 1);
  const staleFinal =
    await db.provisioningJob.findUniqueOrThrow({
      where: { id: staleMain.job.id },
    });
  assert.equal(staleFinal.status, ProvisioningJobStatus.SUCCEEDED);
  assert.equal(staleFinal.workerId, null);
  assert.equal(staleFinal.claimToken, null);
  assert.equal(
    (
      await db.infrastructureOrder.findUniqueOrThrow({
        where: { id: staleMain.infrastructureOrder.id },
      })
    ).status,
    InfrastructureOrderStatus.PROVISIONING,
  );

  const staleDesiredName = await seedMainProvisioning({
    id: "stale-desired-name-fence",
  });
  await db.infrastructureOrder.update({
    where: { id: staleDesiredName.infrastructureOrder.id },
    data: { desiredInstanceName: null },
  });
  const desiredNameAdapter = mainAdapter();
  const desiredNameA = await claimOnly(
    staleDesiredName.job.id,
    "desired-name-stale-worker-a",
  );
  let desiredNameBResult: Awaited<
    ReturnType<typeof processProvisioningJob>
  > = null;
  const desiredNameAResult = await processProvisioningJob(
    desiredNameA.id,
    desiredNameAdapter,
    {
      claimToken: desiredNameA.claimToken!,
      healthProbe: async () => true,
      beforeDesiredNamePersist: async () => {
        await db.provisioningJob.update({
          where: { id: desiredNameA.id },
          data: { leaseExpiresAt: new Date(Date.now() - 1000) },
        });
        await recoverExpiredProvisioningJobs();
        const desiredNameB = await claimOnly(
          desiredNameA.id,
          "desired-name-current-worker-b",
        );
        desiredNameBResult = await processProvisioningJob(
          desiredNameB.id,
          desiredNameAdapter,
          {
            claimToken: desiredNameB.claimToken!,
            healthProbe: async () => true,
          },
        );
      },
    },
  );
  assert.equal(desiredNameAResult, null);
  assert.equal(desiredNameBResult?.healthy, true);
  assert.equal(desiredNameAdapter.createCalls.length, 1);
  const desiredNameFinal =
    await db.infrastructureOrder.findUniqueOrThrow({
      where: { id: staleDesiredName.infrastructureOrder.id },
      select: {
        desiredInstanceName: true,
        status: true,
        productFlowState: true,
      },
    });
  assert.ok(desiredNameFinal.desiredInstanceName);
  assert.equal(
    desiredNameFinal.status,
    InfrastructureOrderStatus.PROVISIONING,
  );
  assert.equal(
    desiredNameFinal.productFlowState,
    "WAITING_ADMIN_DELIVERY_APPROVAL",
  );

  const staleReconciling = await seedMainProvisioning({
    id: "stale-reconciling-fence",
  });
  const reconcilingAdapter = new FakeCloudProviderAdapter({
    provider: InfrastructureProvider.ARVAN,
    createBehavior: "timeout_after_accept",
    observedResource: {
      state: "active",
      ipv4: "192.0.2.81",
      networkIds: null,
      securityIds: null,
    },
  });
  const reconcilingA = await claimOnly(
    staleReconciling.job.id,
    "reconciling-stale-worker-a",
  );
  let reconcilingBResult: Awaited<
    ReturnType<typeof processProvisioningJob>
  > = null;
  const reconcilingAResult = await processProvisioningJob(
    reconcilingA.id,
    reconcilingAdapter,
    {
      claimToken: reconcilingA.claimToken!,
      healthProbe: async () => true,
      beforeReconcilingPersist: async () => {
        await db.provisioningJob.update({
          where: { id: reconcilingA.id },
          data: { leaseExpiresAt: new Date(Date.now() - 1000) },
        });
        await recoverExpiredProvisioningJobs();
        const reconcilingB = await claimOnly(
          reconcilingA.id,
          "reconciling-current-worker-b",
        );
        reconcilingBResult = await processProvisioningJob(
          reconcilingB.id,
          reconcilingAdapter,
          {
            claimToken: reconcilingB.claimToken!,
            healthProbe: async () => true,
          },
        );
      },
    },
  );
  assert.equal(reconcilingAResult, null);
  assert.equal(reconcilingBResult?.healthy, true);
  assert.equal(reconcilingAdapter.createCalls.length, 1);
  assert.deepEqual(
    await db.infrastructureOrder.findUniqueOrThrow({
      where: { id: staleReconciling.infrastructureOrder.id },
      select: { status: true, productFlowState: true },
    }),
    {
      status: InfrastructureOrderStatus.PROVISIONING,
      productFlowState: "WAITING_ADMIN_DELIVERY_APPROVAL",
    },
  );
  const staleReconcilingTransitions =
    await db.productFlowTransition.findMany({
      where: {
        infrastructureOrderId:
          staleReconciling.infrastructureOrder.id,
      },
      select: { reason: true },
    });
  assert.equal(
    staleReconcilingTransitions.some(
      (transition) =>
        transition.reason ===
        "provider_create_requires_reconciliation",
    ),
    false,
  );

  const durableFailure = await seedMainProvisioning({
    id: "transactional-failure-outbox",
  });
  const durableFailureAdapter = new FakeCloudProviderAdapter({
    provider: InfrastructureProvider.ARVAN,
    createBehavior: "failure",
  });
  const durableFailureClaim = await claimOnly(
    durableFailure.job.id,
    "transactional-failure-worker",
  );
  const durableFailureResult = await processProvisioningJob(
    durableFailureClaim.id,
    durableFailureAdapter,
    { claimToken: durableFailureClaim.claimToken! },
  );
  assert.equal(durableFailureResult?.state, "PROVIDER_FAILED");
  assert.equal(durableFailureAdapter.createCalls.length, 1);
  assert.equal(
    await db.provisioningNotificationOutbox.count({
      where: {
        idempotencyKey: `provider-failure:${durableFailure.job.id}`,
      },
    }),
    1,
  );
  assert.equal(
    (
      await db.provisioningJob.findUniqueOrThrow({
        where: { id: durableFailure.job.id },
      })
    ).phase,
    "PROVIDER_FAILED",
  );

  const notificationFailure = await seedMainProvisioning({
    id: "main-notification-outbox",
  });
  const notificationAdapter = mainAdapter();
  const notificationClaim = await claimOnly(
    notificationFailure.job.id,
    "main-notification-worker",
  );
  await processProvisioningJob(
    notificationClaim.id,
    notificationAdapter,
    {
      claimToken: notificationClaim.claimToken!,
      healthProbe: async () => true,
      beforeNotificationDelivery: () => {
        throw new Error("injected_notification_failure");
      },
    },
  );
  const activeOwners = await db.$queryRawUnsafe<
    Array<{
      sessionState: string;
      serviceState: string;
      infrastructureState: string;
      sessionRevision: number;
      serviceRevision: number;
      infrastructureRevision: number;
      infrastructureStatus: string;
      cloudStatus: string;
      jobStatus: string;
    }>
  >(`
    SELECT
      session."productFlowState" AS "sessionState",
      service_order."productFlowState" AS "serviceState",
      infrastructure_order."productFlowState"
        AS "infrastructureState",
      session."productFlowRevision" AS "sessionRevision",
      service_order."productFlowRevision" AS "serviceRevision",
      infrastructure_order."productFlowRevision"
        AS "infrastructureRevision",
      infrastructure_order.status::text
        AS "infrastructureStatus",
      cloud.status::text AS "cloudStatus",
      job.status::text AS "jobStatus"
    FROM "InfrastructureOrder" infrastructure_order
    JOIN "ServiceOrder" service_order
      ON service_order.id =
        infrastructure_order."serviceOrderId"
    JOIN "RecommendationQuote" quote
      ON quote.id = service_order."recommendationQuoteId"
    JOIN "RecommendationSession" session
      ON session.id = quote."sessionId"
    JOIN "CloudInstance" cloud
      ON cloud."infrastructureOrderId" =
        infrastructure_order.id
    JOIN "ProvisioningJob" job
      ON job."infrastructureOrderId" =
        infrastructure_order.id
     AND job.operation = 'create_instance'
    WHERE infrastructure_order.id =
      '${notificationFailure.infrastructureOrder.id}'
  `);
  assert.deepEqual(
    activeOwners.map((row) => ({
      states: [
        row.sessionState,
        row.serviceState,
        row.infrastructureState,
      ],
      revisions: [
        row.sessionRevision,
        row.serviceRevision,
        row.infrastructureRevision,
      ],
      infrastructureStatus: row.infrastructureStatus,
      cloudStatus: row.cloudStatus,
      jobStatus: row.jobStatus,
    })),
    [
      {
        states: [
          "WAITING_ADMIN_DELIVERY_APPROVAL",
          "WAITING_ADMIN_DELIVERY_APPROVAL",
          "WAITING_ADMIN_DELIVERY_APPROVAL",
        ],
        revisions: [3, 3, 3],
        infrastructureStatus: "PROVISIONING",
        cloudStatus: "PENDING",
        jobStatus: "SUCCEEDED",
      },
    ],
  );
  assert.equal(
    await db.provisioningNotificationOutbox.count({
      where: {
        idempotencyKey:
          `instance-active:${notificationFailure.infrastructureOrder.id}`,
      },
    }),
    0,
  );
  await Promise.all([
    reconcileProvisioningDispatches(),
    reconcileProvisioningDispatches(),
  ]);
  assert.equal(
    await db.provisioningNotificationOutbox.count({
      where: {
        idempotencyKey:
          `instance-active:${notificationFailure.infrastructureOrder.id}`,
      },
    }),
    0,
  );

  const reconciledActive = await seedMainProvisioning({
    id: "pre-delivery-outbox-reconciler",
  });
  const reconciledActiveClaim = await claimOnly(
    reconciledActive.job.id,
    "pre-delivery-outbox-reconciler-worker",
  );
  await processProvisioningJob(
    reconciledActiveClaim.id,
    mainAdapter(),
    {
      claimToken: reconciledActiveClaim.claimToken!,
      healthProbe: async () => true,
    },
  );
  await Promise.all([
    reconcileProvisioningDispatches(),
    reconcileProvisioningDispatches(),
  ]);
  assert.equal(
    await db.provisioningNotificationOutbox.count({
      where: {
        idempotencyKey:
          `instance-active:${reconciledActive.infrastructureOrder.id}`,
      },
    }),
    0,
  );

  async function assertFinalizeOnly(input: {
    id: string;
    healthy: boolean;
  }) {
    const seeded = await seedMainProvisioning({ id: input.id });
    const adapter = mainAdapter();
    const claimed = await claimOnly(
      seeded.job.id,
      `main-finalize-a-${input.id}`,
    );
    let probeCalls = 0;
    const first = await processProvisioningJob(
      claimed.id,
      adapter,
      {
        claimToken: claimed.claimToken!,
        healthProbe: async () => {
          probeCalls += 1;
          return input.healthy;
        },
        beforeFinalizeJob: () => {
          throw new Error("injected_finalize_failure");
        },
        ...(input.healthy
          ? {}
          : {
              beforeHealthRetrySchedule: () => {
                throw new Error("injected_schedule_failure");
              },
            }),
      },
    );
    assert.equal(first?.finalizePending, true);
    const probeCallsBeforeRecovery = probeCalls;
    assert.equal(
      probeCallsBeforeRecovery,
      input.healthy ? 1 : 3,
    );
    const persistedBeforeRecovery =
      await db.provisioningJob.findUniqueOrThrow({
        where: { id: seeded.job.id },
      });
    assert.ok(persistedBeforeRecovery.healthResultSnapshot);
    const checkCountBefore =
      await db.infrastructureHealthCheck.count({
        where: {
          infrastructureOrderId:
            seeded.infrastructureOrder.id,
        },
      });
    assert.equal(checkCountBefore, 1);
    await db.provisioningJob.update({
      where: { id: seeded.job.id },
      data: {
        leaseExpiresAt: new Date(Date.now() - 1000),
      },
    });
    await recoverExpiredProvisioningJobs();
    const replacement = await claimOnly(
      seeded.job.id,
      `main-finalize-b-${input.id}`,
    );
    const replay = await processProvisioningJob(
      replacement.id,
      adapter,
      {
        claimToken: replacement.claimToken!,
        healthProbe: async () => {
          probeCalls += 1;
          throw new Error("health_probe_must_not_replay");
        },
        ...(input.healthy
          ? {}
          : {
              beforeHealthRetrySchedule: () => {
                throw new Error("injected_schedule_failure");
              },
            }),
      },
    );
    assert.equal(replay?.finalizeOnly, true);
    assert.equal(replay?.healthy, input.healthy);
    assert.equal(probeCalls, probeCallsBeforeRecovery);
    assert.equal(
      await db.infrastructureHealthCheck.count({
        where: {
          infrastructureOrderId:
            seeded.infrastructureOrder.id,
        },
      }),
      1,
    );
    assert.equal(
      await db.infrastructureHealthCheck.count({
        where: {
          infrastructureOrderId:
            seeded.infrastructureOrder.id,
          status: "RUNNING",
        },
      }),
      0,
    );
    assert.equal(adapter.createCalls.length, 1);
    assert.equal(
      (
        await db.provisioningJob.findUniqueOrThrow({
          where: { id: seeded.job.id },
        })
      ).status,
      ProvisioningJobStatus.SUCCEEDED,
    );
    if (!input.healthy) {
      const dispatch = await db.healthRetryDispatch.findFirstOrThrow({
        where: {
          infrastructureOrderId:
            seeded.infrastructureOrder.id,
        },
      });
      assert.equal(dispatch.status, "PENDING");
      assert.equal(dispatch.attemptCount, 1);
      assert.ok(dispatch.nextAttemptAt > new Date());
      await db.healthRetryDispatch.update({
        where: { id: dispatch.id },
        data: { nextAttemptAt: new Date(0) },
      });
      await Promise.all([
        processPendingHealthRetryDispatches(100),
        processPendingHealthRetryDispatches(100),
      ]);
      const dispatched =
        await db.healthRetryDispatch.findUniqueOrThrow({
          where: { id: dispatch.id },
        });
      assert.equal(dispatched.status, "DISPATCHED");
      assert.ok(dispatched.dispatchedJobId);
      assert.equal(
        await db.provisioningJob.count({
          where: {
            infrastructureOrderId:
              seeded.infrastructureOrder.id,
            operation: "health_check_retry",
          },
        }),
        1,
      );
    }
  }

  await assertFinalizeOnly({
    id: "main-finalize-success",
    healthy: true,
  });
  await assertFinalizeOnly({
    id: "main-finalize-failure",
    healthy: false,
  });

  // Reconciler progress: rows that already have their deterministic
  // outbox key must never consume a bounded batch.
  for (let cycle = 0; cycle < 20; cycle += 1) {
    const baseline = await reconcileProvisioningDispatches(50);
    if (
      baseline.activeNotifications === 0 &&
      baseline.failureNotifications === 0
    ) {
      break;
    }
  }
  async function seedActiveOutboxCandidate(
    id: string,
    existingOutbox = false,
  ) {
    const seeded = await seedRuntimeOrder({
      id,
      infrastructureStatus: InfrastructureOrderStatus.ACTIVE,
      productFlowState: "ACTIVE",
    });
    await db.cloudInstance.create({
      data: {
        id: `outbox-instance-${id}`,
        infrastructureOrderId: seeded.infrastructureOrder.id,
        userId: "migration-user",
        provider: InfrastructureProvider.ARVAN,
        providerApiVersion: "v1",
        providerInstanceId: `outbox-provider-${id}`,
        name: `abrchin-outbox-${id}`,
        region: "tehran",
        size: "s1",
        image: "ubuntu",
        deliveryMode: "MANAGED",
        ipv4: "192.0.2.90",
        providerState: "active",
        providerObservedAt: now,
        status: CloudInstanceStatus.ACTIVE,
      },
    });
    await db.infrastructureOrder.update({
      where: { id: seeded.infrastructureOrder.id },
      data: { updatedAt: new Date("2020-01-01T00:00:00.000Z") },
    });
    if (existingOutbox) {
      await db.provisioningNotificationOutbox.create({
        data: {
          idempotencyKey:
            `instance-active:${seeded.infrastructureOrder.id}`,
          infrastructureOrderId: seeded.infrastructureOrder.id,
          type: AdminNotificationType.INSTANCE_ACTIVE,
          title: "already queued",
          message: "already queued",
        },
      });
    }
    return seeded.infrastructureOrder.id;
  }

  async function seedFailureOutboxCandidate(
    id: string,
    existingOutbox = false,
  ) {
    const seeded = await seedRuntimeOrder({
      id,
      infrastructureStatus: InfrastructureOrderStatus.FAILED,
      productFlowState: "PROVISIONING_MANUAL_REVIEW",
    });
    const job = await db.provisioningJob.create({
      data: {
        infrastructureOrderId: seeded.infrastructureOrder.id,
        operation: "create_instance",
        status: ProvisioningJobStatus.FAILED,
        phase: "PROVIDER_FAILED",
        idempotencyKey: `outbox-provider-failure-${id}`,
        attempt: 1,
        availableAt: new Date(0),
        finishedAt: now,
        updatedAt: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    if (existingOutbox) {
      await db.provisioningNotificationOutbox.create({
        data: {
          idempotencyKey: `provider-failure:${job.id}`,
          infrastructureOrderId: seeded.infrastructureOrder.id,
          type: AdminNotificationType.PROVISIONING_FAILED,
          title: "already queued",
          message: "already queued",
        },
      });
    }
    return job.id;
  }

  const existingActiveOutbox = await seedActiveOutboxCandidate(
    "outbox-active-existing",
    true,
  );
  const existingFailureOutbox = await seedFailureOutboxCandidate(
    "outbox-failure-existing",
    true,
  );
  const missingActiveOutboxes: string[] = [];
  const missingFailureOutboxes: string[] = [];
  for (let index = 1; index <= 6; index += 1) {
    missingActiveOutboxes.push(
      await seedActiveOutboxCandidate(`outbox-active-${index}`),
    );
    missingFailureOutboxes.push(
      await seedFailureOutboxCandidate(`outbox-failure-${index}`),
    );
  }
  const firstBoundedReconciliation =
    await reconcileProvisioningDispatches(2);
  assert.deepEqual(
    {
      active: firstBoundedReconciliation.activeNotifications,
      failed: firstBoundedReconciliation.failureNotifications,
    },
    { active: 2, failed: 2 },
  );
  await Promise.all([
    reconcileProvisioningDispatches(2),
    reconcileProvisioningDispatches(2),
  ]);
  for (let cycle = 0; cycle < 10; cycle += 1) {
    const progress = await reconcileProvisioningDispatches(2);
    if (
      progress.activeNotifications === 0 &&
      progress.failureNotifications === 0
    ) {
      break;
    }
  }
  const expectedActiveOutboxKeys = [
    existingActiveOutbox,
    ...missingActiveOutboxes,
  ].map((id) => `instance-active:${id}`);
  const expectedFailureOutboxKeys = [
    existingFailureOutbox,
    ...missingFailureOutboxes,
  ].map((id) => `provider-failure:${id}`);
  assert.equal(
    await db.provisioningNotificationOutbox.count({
      where: { idempotencyKey: { in: expectedActiveOutboxKeys } },
    }),
    expectedActiveOutboxKeys.length,
  );
  assert.equal(
    await db.provisioningNotificationOutbox.count({
      where: { idempotencyKey: { in: expectedFailureOutboxKeys } },
    }),
    expectedFailureOutboxKeys.length,
  );
  const reconciliationNoop = await reconcileProvisioningDispatches(2);
  assert.equal(reconciliationNoop.activeNotifications, 0);
  assert.equal(reconciliationNoop.failureNotifications, 0);

  // Dispatch starvation: an older permanently obsolete row cannot block a
  // healthy dispatch, even when two workers run concurrently.
  const dispatchFakeAdapter = new FakeCloudProviderAdapter({
    provider: InfrastructureProvider.ARVAN,
  });
  const poisonInfrastructureId = await seedHealthGraph({
    id: "dispatch-poison-active",
    provider: InfrastructureProvider.ARVAN,
    flowState: "HEALTH_CHECK_FAILED",
    providerState: "active",
    ipv4: "192.0.2.101",
    networkId: "network-1",
    securityId: "security-1",
    providerObservedAt: now,
  });
  const poisonInfrastructure =
    await db.infrastructureOrder.findUniqueOrThrow({
      where: { id: poisonInfrastructureId },
      include: {
        serviceOrder: { include: { recommendationQuote: true } },
        cloudInstance: true,
      },
    });
  await db.$transaction([
    db.recommendationSession.update({
      where: {
        id: poisonInfrastructure.serviceOrder.recommendationQuote!
          .sessionId,
      },
      data: { productFlowState: "ACTIVE", productFlowRevision: 1 },
    }),
    db.serviceOrder.update({
      where: { id: poisonInfrastructure.serviceOrderId },
      data: { productFlowState: "ACTIVE", productFlowRevision: 1 },
    }),
    db.infrastructureOrder.update({
      where: { id: poisonInfrastructure.id },
      data: {
        status: InfrastructureOrderStatus.ACTIVE,
        productFlowState: "ACTIVE",
        productFlowRevision: 1,
      },
    }),
    db.cloudInstance.update({
      where: { id: poisonInfrastructure.cloudInstance!.id },
      data: { status: CloudInstanceStatus.ACTIVE },
    }),
  ]);
  const healthyDispatchInfrastructureId = await seedHealthGraph({
    id: "dispatch-healthy-next",
    provider: InfrastructureProvider.ARVAN,
    flowState: "HEALTH_CHECK_FAILED",
    providerState: "active",
    ipv4: "192.0.2.102",
    networkId: "network-1",
    securityId: "security-1",
    providerObservedAt: now,
  });
  const poisonDispatch = await db.healthRetryDispatch.create({
    data: {
      idempotencyKey: "health-dispatch-poison-active",
      infrastructureOrderId: poisonInfrastructureId,
      sourceHealthCheckId: "poison-active-source",
      nextAttemptAt: new Date(0),
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
    },
  });
  const healthyDispatch = await db.healthRetryDispatch.create({
    data: {
      idempotencyKey: "health-dispatch-healthy-next",
      infrastructureOrderId: healthyDispatchInfrastructureId,
      sourceHealthCheckId: "healthy-next-source",
      nextAttemptAt: new Date(0),
      createdAt: new Date("2020-01-02T00:00:00.000Z"),
    },
  });
  await Promise.all([
    processPendingHealthRetryDispatches(2),
    processPendingHealthRetryDispatches(2),
  ]);
  assert.deepEqual(
    await db.healthRetryDispatch.findUniqueOrThrow({
      where: { id: poisonDispatch.id },
      select: { status: true, terminalReason: true },
    }),
    {
      status: "OBSOLETE",
      terminalReason: "service_already_healthy_or_delivered",
    },
  );
  const healthyDispatchAfter =
    await db.healthRetryDispatch.findUniqueOrThrow({
      where: { id: healthyDispatch.id },
    });
  assert.equal(healthyDispatchAfter.status, "DISPATCHED");
  assert.ok(healthyDispatchAfter.dispatchedJobId);
  assert.equal(
    await db.provisioningJob.count({
      where: {
        infrastructureOrderId: healthyDispatchInfrastructureId,
        operation: "health_check_retry",
      },
    }),
    1,
  );

  const retryLimitInfrastructureId = await seedHealthGraph({
    id: "dispatch-three-attempt-limit",
    provider: InfrastructureProvider.ARVAN,
    flowState: "HEALTH_CHECK_FAILED",
    providerState: "active",
    ipv4: "192.0.2.103",
    networkId: "network-1",
    securityId: "security-1",
    providerObservedAt: now,
  });
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const dispatch = await db.healthRetryDispatch.create({
      data: {
        idempotencyKey: `health-dispatch-limit-${attempt}`,
        infrastructureOrderId: retryLimitInfrastructureId,
        sourceHealthCheckId: `health-dispatch-limit-source-${attempt}`,
        nextAttemptAt: new Date(0),
      },
    });
    await processPendingHealthRetryDispatches(1);
    const processedDispatch =
      await db.healthRetryDispatch.findUniqueOrThrow({
        where: { id: dispatch.id },
      });
    if (attempt <= 3) {
      assert.equal(processedDispatch.status, "DISPATCHED");
      await db.provisioningJob.update({
        where: { id: processedDispatch.dispatchedJobId! },
        data: {
          status: ProvisioningJobStatus.FAILED,
          finishedAt: new Date(),
        },
      });
    } else {
      assert.equal(processedDispatch.status, "EXHAUSTED");
      assert.equal(processedDispatch.dispatchedJobId, null);
    }
  }
  assert.equal(
    await db.provisioningJob.count({
      where: {
        infrastructureOrderId: retryLimitInfrastructureId,
        operation: "health_check_retry",
      },
    }),
    3,
  );

  const transientInfrastructureId = await seedHealthGraph({
    id: "dispatch-transient-backoff",
    provider: InfrastructureProvider.ARVAN,
    flowState: "HEALTH_CHECK_FAILED",
    providerState: "active",
    ipv4: "192.0.2.104",
    networkId: "network-1",
    securityId: "security-1",
    providerObservedAt: now,
  });
  const transientDispatch = await db.healthRetryDispatch.create({
    data: {
      idempotencyKey: "health-dispatch-transient",
      infrastructureOrderId: transientInfrastructureId,
      sourceHealthCheckId: "health-dispatch-transient-source",
      nextAttemptAt: new Date(0),
    },
  });
  await db.healthRetryDispatch.updateMany({
    where: {
      status: "PENDING",
      id: { not: transientDispatch.id },
    },
    data: { nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000) },
  });
  await processPendingHealthRetryDispatches(1, {
    beforeSchedule: () => {
      throw new Error("injected_transient_dispatch_failure");
    },
  });
  const transientAfter =
    await db.healthRetryDispatch.findUniqueOrThrow({
      where: { id: transientDispatch.id },
    });
  assert.equal(transientAfter.status, "PENDING");
  assert.equal(transientAfter.attemptCount, 1);
  assert.ok(transientAfter.nextAttemptAt > new Date());
  await processPendingHealthRetryDispatches(1);
  assert.deepEqual(
    await db.healthRetryDispatch.findUniqueOrThrow({
      where: { id: transientDispatch.id },
      select: { status: true, attemptCount: true },
    }),
    { status: "PENDING", attemptCount: 1 },
  );

  const deadLetterInfrastructureId = await seedHealthGraph({
    id: "dispatch-dead-letter",
    provider: InfrastructureProvider.ARVAN,
    flowState: "HEALTH_CHECK_FAILED",
    providerState: "active",
    ipv4: "192.0.2.105",
    networkId: "network-1",
    securityId: "security-1",
    providerObservedAt: now,
  });
  const deadLetterDispatch = await db.healthRetryDispatch.create({
    data: {
      idempotencyKey: "health-dispatch-dead-letter",
      infrastructureOrderId: deadLetterInfrastructureId,
      sourceHealthCheckId: "health-dispatch-dead-letter-source",
      attemptCount: 4,
      nextAttemptAt: new Date(0),
    },
  });
  await db.healthRetryDispatch.updateMany({
    where: {
      status: "PENDING",
      id: { not: deadLetterDispatch.id },
    },
    data: { nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000) },
  });
  await processPendingHealthRetryDispatches(1, {
    beforeSchedule: () => {
      throw new Error("injected_final_dispatch_failure");
    },
  });
  const deadLetterAfter =
    await db.healthRetryDispatch.findUniqueOrThrow({
      where: { id: deadLetterDispatch.id },
    });
  assert.equal(deadLetterAfter.status, "DEAD_LETTER");
  assert.equal(deadLetterAfter.attemptCount, 5);
  assert.equal(
    deadLetterAfter.terminalReason,
    "dispatch_retry_limit_exhausted",
  );
  assert.ok(deadLetterAfter.deadLetteredAt);
  assert.deepEqual(
    await db.infrastructureOrder.findUniqueOrThrow({
      where: { id: deadLetterInfrastructureId },
      select: { status: true, productFlowState: true },
    }),
    {
      status: InfrastructureOrderStatus.MANUAL_REVIEW,
      productFlowState: "PROVISIONING_MANUAL_REVIEW",
    },
  );
  assert.equal(
    await db.providerOperationLog.count({
      where: {
        infrastructureOrderId: deadLetterInfrastructureId,
        operation: "health_retry_dispatch",
        status: "DEAD_LETTER",
      },
    }),
    1,
  );
  assert.equal(
    await db.adminNotification.count({
      where: {
        infrastructureOrderId: deadLetterInfrastructureId,
        type: AdminNotificationType.NEEDS_RECONCILIATION,
      },
    }),
    1,
  );
  assert.equal(dispatchFakeAdapter.createCalls.length, 0);

  const adminSafety = await seedRuntimeOrder({
    id: "admin-safety-source-of-truth",
    infrastructureStatus: InfrastructureOrderStatus.FAILED,
    productFlowState: "PROVISIONING_MANUAL_REVIEW",
  });
  const adminSafetyJob = await db.provisioningJob.create({
    data: {
      infrastructureOrderId:
        adminSafety.infrastructureOrder.id,
      operation: "create_instance",
      status: ProvisioningJobStatus.FAILED,
      idempotencyKey: "admin-safety-create-attempt",
      attempt: 1,
      createSentAt: new Date(),
      lastErrorCode: "provider_ambiguous",
      finishedAt: new Date(),
    },
  });
  await db.infrastructureOrder.update({
    where: { id: adminSafety.infrastructureOrder.id },
    data: {
      reconcileNoResourceConfirmedAt: new Date(),
      reconcileNoResourceConfirmedJobId: adminSafetyJob.id,
      reconcileNoResourceConfirmedAttempt: 1,
    },
  });
  const { listInfrastructureOrders } = await import(
    "../lib/admin/dashboard.ts"
  );
  const adminWithoutAudit = (
    await listInfrastructureOrders()
  ).find(
    (order) =>
      order.id === adminSafety.infrastructureOrder.id,
  );
  assert.ok(adminWithoutAudit);
  assert.deepEqual(adminWithoutAudit.recovery.allowedActions, [
    "reconcile",
    "confirm-no-resource",
  ]);
  assert.equal(
    adminWithoutAudit.recovery.resourceDispositionReason,
    "RECONCILIATION_REQUIRED",
  );
  const absenceKey =
    `provider-absence-confirmed:${adminSafety.infrastructureOrder.id}:${adminSafetyJob.id}:1`;
  await db.auditLog.create({
    data: {
      actorUserId: "migration-admin",
      action: "reconciliation",
      entityType: "infrastructure_order",
      entityId: adminSafety.infrastructureOrder.id,
      afterData: {
        noResourceConfirmed: true,
        provisioningJobId: adminSafetyJob.id,
        attempt: 1,
      },
      idempotencyKey: absenceKey,
    },
  });
  const adminWithAudit = (
    await listInfrastructureOrders()
  ).find(
    (order) =>
      order.id === adminSafety.infrastructureOrder.id,
  );
  assert.ok(adminWithAudit);
  assert.deepEqual(adminWithAudit.recovery.allowedActions, [
    "retry",
    "refund",
  ]);
  assert.equal(
    adminWithAudit.recovery.resourceDispositionReason,
    "LATEST_ATTEMPT_CONFIRMED_ABSENT",
  );
  await db.auditLog.delete({
    where: { idempotencyKey: absenceKey },
  });
  const adminAfterAuditRemoval = (
    await listInfrastructureOrders()
  ).find(
    (order) =>
      order.id === adminSafety.infrastructureOrder.id,
  );
  assert.deepEqual(
    adminAfterAuditRemoval?.recovery.allowedActions,
    ["reconcile", "confirm-no-resource"],
  );

  const adminParity = await seedRuntimeOrder({
    id: "admin-action-backend-parity",
    infrastructureStatus: InfrastructureOrderStatus.MANUAL_REVIEW,
    productFlowState: "PROVISIONING_MANUAL_REVIEW",
  });
  const adminParityUi = (
    await listInfrastructureOrders()
  ).find(
    (order) => order.id === adminParity.infrastructureOrder.id,
  );
  assert.deepEqual(adminParityUi?.recovery.allowedActions, [
    "retry",
    "refund",
  ]);
  const parityRetry = await retryFailedProvisioning({
    infrastructureOrderId: adminParity.infrastructureOrder.id,
    adminUserId: "migration-admin",
    reason: "Retry کنترل‌شده از Manual Review بدون Create",
    idempotencyKey: "admin-parity-retry-0001",
  });
  assert.equal(parityRetry.job.attempt, 1);
  assert.equal(parityRetry.job.status, ProvisioningJobStatus.QUEUED);
  assert.deepEqual(
    await db.infrastructureOrder.findUniqueOrThrow({
      where: { id: adminParity.infrastructureOrder.id },
      select: { status: true, productFlowState: true },
    }),
    {
      status: InfrastructureOrderStatus.QUEUED,
      productFlowState: "PROVISIONING_SUBMITTED",
    },
  );
  const parityReplay = await retryFailedProvisioning({
    infrastructureOrderId: adminParity.infrastructureOrder.id,
    adminUserId: "migration-admin",
    reason: "Retry کنترل‌شده از Manual Review بدون Create",
    idempotencyKey: "admin-parity-retry-0001",
  });
  assert.equal(parityReplay.job.id, parityRetry.job.id);
  assert.equal(parityReplay.job.status, ProvisioningJobStatus.QUEUED);
  await assert.rejects(
    retryFailedProvisioning({
      infrastructureOrderId: adminParity.infrastructureOrder.id,
      adminUserId: "migration-admin",
      reason: "Payload متفاوت برای همان کلید",
      idempotencyKey: "admin-parity-retry-0001",
    }),
    /idempotency_conflict/,
  );

  const { InfrastructureError } = await import(
    "../lib/infrastructure/errors.ts"
  );
  const { syncMultiProviderCatalog } = await import(
    "../lib/infrastructure/multi-provider-catalog-service.ts"
  );

  const arvanRegionGood = "ir-runtime-good";
  const arvanRegionOther = "ir-runtime-other";
  const regionalPlan = (region: string, monthlyPrice: bigint) => ({
    externalPlanId: "runtime-g2",
    region,
    name: `Runtime ${region}`,
    vcpu: 2,
    ramMb: 2048,
    diskGb: 40,
    resourceContractValid: true,
    resourceContractError: null,
    available: true,
    priceHourlyIrr: 1_000n,
    priceMonthlyIrr: monthlyPrice,
    sourceMoneyUnit: "IRR",
    rawUpdatedAt: null,
    rawPayload: { id: "runtime-g2", region },
  });
  const regionalImage = (region: string) => ({
    externalId: "runtime-ubuntu",
    region,
    name: "Runtime Ubuntu",
    operatingSystem: "Ubuntu",
    minDiskGb: 20,
    minRamMb: 1024,
    available: true,
    sshKeySupported: true,
    sshPasswordSupported: true,
    rawUpdatedAt: null,
    rawPayload: { id: "runtime-ubuntu", region },
  });
  const regionalNetwork = (region: string) => ({
    externalId: `runtime-network-${region}`,
    region,
    name: "Runtime Network",
    isDefault: true,
    available: true,
    rawUpdatedAt: null,
    rawPayload: { id: `runtime-network-${region}` },
  });
  const regionalSecurity = (region: string) => ({
    externalId: `runtime-security-${region}`,
    region,
    name: "Runtime Security",
    isDefault: true,
    available: true,
    rawUpdatedAt: null,
    rawPayload: { id: `runtime-security-${region}` },
  });
  const arvanInitial = new FakeCloudProviderAdapter({
    provider: InfrastructureProvider.ARVAN,
    regions: [arvanRegionGood, arvanRegionOther].map((code) => ({
      code,
      name: code,
      available: true,
      rawPayload: { code, source: "test_configuration" },
    })),
    plansByRegion: {
      [arvanRegionGood]: [regionalPlan(arvanRegionGood, 8_000_000n)],
      [arvanRegionOther]: [regionalPlan(arvanRegionOther, 9_000_000n)],
    },
    imagesByRegion: {
      [arvanRegionGood]: [regionalImage(arvanRegionGood)],
      [arvanRegionOther]: [regionalImage(arvanRegionOther)],
    },
    networksByRegion: {
      [arvanRegionGood]: [regionalNetwork(arvanRegionGood)],
      [arvanRegionOther]: [regionalNetwork(arvanRegionOther)],
    },
    securityByRegion: {
      [arvanRegionGood]: [regionalSecurity(arvanRegionGood)],
      [arvanRegionOther]: [regionalSecurity(arvanRegionOther)],
    },
  });
  const arvanInitialResult = await syncMultiProviderCatalog(
    arvanInitial,
    new Date("2026-08-01T00:00:00.000Z"),
  );
  assert.equal(arvanInitialResult.status, "SUCCEEDED");
  const arvanGoodBefore =
    await db.providerCatalogItem.findUniqueOrThrow({
      where: {
        provider_apiVersion_regionCode_externalPlanId: {
          provider: InfrastructureProvider.ARVAN,
          apiVersion: "v1",
          regionCode: arvanRegionGood,
          externalPlanId: "runtime-g2",
        },
      },
      select: {
        id: true,
        providerMonthlyPriceIrr: true,
        status: true,
        available: true,
        lastSeenAt: true,
        catalogVersion: true,
        payloadHash: true,
      },
    });
  assert.equal(
    await db.infrastructurePlan.count({
      where: { catalogItemId: arvanGoodBefore.id },
    }),
    0,
    "provider sync must not auto-publish storefront plans",
  );
  const curatedArvanPlan = await db.infrastructurePlan.create({
    data: {
      code: "ADMIN_CURATED_RUNTIME_G2",
      title: "پلن منتخب ادمین",
      provider: InfrastructureProvider.ARVAN,
      providerApiVersion: "v1",
      productKind: InfrastructureProductKind.CLOUD_SERVER,
      regionCode: arvanRegionGood,
      sizeCode: "runtime-g2",
      imageCode: "runtime-ubuntu",
      deliveryMode: "MANAGED",
      vcpu: 2,
      ramGb: 2,
      storageGb: 40,
      salePriceRial: 8_000_000n,
      renewalPriceRial: 8_000_000n,
      estimatedProviderCostRial: 8_000_000n,
      deliveryEstimateMinutes: 15,
      parchinIncluded: true,
      minimumParchinLevel: "PARCHIN_START",
      active: true,
      publicationStatus: "PUBLISHED",
      displayDuringProviderOutage: true,
      sortOrder: 7,
      catalogItemId: arvanGoodBefore.id,
      catalogMappingStatus: "MAPPED",
      catalogMappedAt: new Date("2026-08-01T00:00:00.000Z"),
    },
  });
  const arvanPartial = new FakeCloudProviderAdapter({
    provider: InfrastructureProvider.ARVAN,
    regions: [arvanRegionGood, arvanRegionOther].map((code) => ({
      code,
      name: code,
      available: true,
      rawPayload: { code, source: "test_configuration" },
    })),
    plansByRegion: {
      [arvanRegionOther]: [regionalPlan(arvanRegionOther, 9_500_000n)],
    },
    imagesByRegion: {
      [arvanRegionGood]: [regionalImage(arvanRegionGood)],
      [arvanRegionOther]: [regionalImage(arvanRegionOther)],
    },
    networksByRegion: {
      [arvanRegionGood]: [regionalNetwork(arvanRegionGood)],
      [arvanRegionOther]: [regionalNetwork(arvanRegionOther)],
    },
    securityByRegion: {
      [arvanRegionGood]: [regionalSecurity(arvanRegionGood)],
      [arvanRegionOther]: [regionalSecurity(arvanRegionOther)],
    },
  });
  arvanPartial.syncPlans = async (region: string) => {
    if (region === arvanRegionGood) {
      throw new InfrastructureError(
        "provider_timeout",
        "unsafe-provider-detail-must-not-persist",
      );
    }
    return [regionalPlan(arvanRegionOther, 9_500_000n)];
  };
  const arvanPartialResult = await syncMultiProviderCatalog(
    arvanPartial,
    new Date("2026-08-01T00:05:00.000Z"),
  );
  assert.equal(arvanPartialResult.status, "PARTIAL");
  assert.equal(arvanPartialResult.successfulRegions, 1);
  assert.equal(arvanPartialResult.failedRegions, 1);
  assert.deepEqual(
    await db.providerCatalogItem.findUniqueOrThrow({
      where: {
        provider_apiVersion_regionCode_externalPlanId: {
          provider: InfrastructureProvider.ARVAN,
          apiVersion: "v1",
          regionCode: arvanRegionGood,
          externalPlanId: "runtime-g2",
        },
      },
      select: {
        id: true,
        providerMonthlyPriceIrr: true,
        status: true,
        available: true,
        lastSeenAt: true,
        catalogVersion: true,
        payloadHash: true,
      },
    }),
    arvanGoodBefore,
  );
  assert.deepEqual(
    await db.infrastructurePlan.findUniqueOrThrow({
      where: { id: curatedArvanPlan.id },
      select: {
        title: true,
        active: true,
        publicationStatus: true,
        displayDuringProviderOutage: true,
        sortOrder: true,
      },
    }),
    {
      title: "پلن منتخب ادمین",
      active: true,
      publicationStatus: "PUBLISHED",
      displayDuringProviderOutage: true,
      sortOrder: 7,
    },
    "partial provider sync must not overwrite Admin publication intent",
  );
  assert.equal(
    (
      await db.providerCatalogItem.findUniqueOrThrow({
        where: {
          provider_apiVersion_regionCode_externalPlanId: {
            provider: InfrastructureProvider.ARVAN,
            apiVersion: "v1",
            regionCode: arvanRegionOther,
            externalPlanId: "runtime-g2",
          },
        },
      })
    ).providerMonthlyPriceIrr,
    9_500_000n,
  );
  const arvanPartialRun =
    await db.providerCatalogSyncRun.findFirstOrThrow({
      where: {
        provider: InfrastructureProvider.ARVAN,
        status: "PARTIAL",
      },
      orderBy: { startedAt: "desc" },
    });
  assert.equal(
    JSON.stringify(arvanPartialRun.report).includes(
      "unsafe-provider-detail-must-not-persist",
    ),
    false,
  );

  // Published ready-server offer used by the sale-gate replay below. A raw
  // catalog row plus an explicit Admin publication — provider sync never
  // materializes a sellable SKU on its own.
  const runtimeReadyNow = new Date();
  await db.providerRegionConfig.upsert({
    where: {
      provider_apiVersion_regionCode: {
        provider: InfrastructureProvider.ARVAN,
        apiVersion: "v1",
        regionCode: "runtime-tehran",
      },
    },
    update: { saleEnabled: true, syncEnabled: true },
    create: {
      provider: InfrastructureProvider.ARVAN,
      apiVersion: "v1",
      regionCode: "runtime-tehran",
      displayName: "تهران ۹، ایران",
      saleEnabled: true,
      syncEnabled: true,
    },
  });
  const runtimeReadyCatalogItem = await db.providerCatalogItem.create({
    data: {
      id: "runtime-ready-catalog",
      provider: InfrastructureProvider.ARVAN,
      apiVersion: "v1",
      productKind: InfrastructureProductKind.READY_INSTANT_SERVER,
      source: "API_CATALOG",
      regionCode: "runtime-tehran",
      sizeCode: "runtime-priced",
      externalPlanId: "runtime-priced",
      externalKey: "arvan:v1:runtime-tehran:runtime-priced",
      sizeName: "Runtime Priced",
      compatibleImageCodes: ["ubuntu24-cloudinit-qcow2"],
      vcpu: 2,
      ramMb: 2048,
      diskGb: 40,
      available: true,
      active: true,
      status: "ACTIVE",
      priceMonthlyAmount: 8_294_400n,
      priceScale: 0,
      currencyCode: "IRR",
      amountUnit: "RIAL",
      providerMonthlyPriceIrr: 8_294_400n,
      providerHourlyPriceIrr: 12_000n,
      lastSyncedAt: runtimeReadyNow,
      lastSeenAt: runtimeReadyNow,
      rawPayload: {},
      payloadHash: "runtime-ready-hash",
      catalogVersion: "runtime-ready-v1",
    },
  });
  const arvanPublishedReadyPlan =
    await db.infrastructurePlan.create({
      data: {
        id: "runtime-arvan-ready-plan",
        code: "READY_SERVER_RUNTIME_PRICED",
        title: "Runtime Arvan Ready",
        provider: InfrastructureProvider.ARVAN,
        providerApiVersion: "v1",
        productKind:
          InfrastructureProductKind.READY_INSTANT_SERVER,
        regionCode: "runtime-tehran",
        sizeCode: "runtime-priced",
        imageCode: "ubuntu24-cloudinit-qcow2",
        deliveryMode: "MANAGED",
        vcpu: 2,
        ramGb: 2,
        storageGb: 40,
        salePriceRial: 10_368_000n,
        renewalPriceRial: 10_368_000n,
        estimatedProviderCostRial: 8_294_400n,
        parchinIncluded: true,
        minimumParchinLevel: ParchinLevel.PARCHIN_START,
        active: true,
        publicationStatus: "PUBLISHED",
        catalogItemId: runtimeReadyCatalogItem.id,
        catalogMappingStatus: "MAPPED",
        catalogMappedAt: runtimeReadyNow,
      },
    });

  const {
    ProviderCatalogSyncError,
    settleProviderCatalogSyncTasks,
  } = await import(
    "../lib/infrastructure/catalog-sync-observability.ts"
  );
  const previousSmsProvider = process.env.SMS_PROVIDER;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.SMS_PROVIDER = "console";
  process.env.NODE_ENV = "development";
  try {
    for (let occurrence = 0; occurrence < 2; occurrence += 1) {
      await settleProviderCatalogSyncTasks(
        [{
          provider: InfrastructureProvider.ARVAN,
          apiVersion: "v1",
          operation: "catalog_sync",
          promise: Promise.reject(new ProviderCatalogSyncError({
            provider: InfrastructureProvider.ARVAN,
            apiVersion: "v1",
            operation: "catalog_sync",
            code: "provider_auth_failed",
          })),
        }],
        () => undefined,
        { persistIncidents: true },
      );
    }
    const incident = await db.operationalIncident.findFirstOrThrow({
      where: {
        provider: InfrastructureProvider.ARVAN,
        operation: "catalog_sync",
        safeCode: "provider_auth_failed",
        status: "OPEN",
      },
    });
    assert.equal(incident.occurrenceCount, 2);
    assert.equal(
      await db.operationalAlertOutbox.count({
        where: { incidentId: incident.id },
      }),
      1,
      "a repeated critical incident must not spam duplicate SMS rows",
    );
    const { processOperationalAlertOutbox } = await import(
      "../lib/operations/alert-worker.ts"
    );
    assert.equal(await processOperationalAlertOutbox(10), 1);
    assert.equal(
      await db.operationalAlertOutbox.count({
        where: { incidentId: incident.id, status: "SENT" },
      }),
      1,
    );
    await settleProviderCatalogSyncTasks(
      [{
        provider: InfrastructureProvider.ARVAN,
        apiVersion: "v1",
        operation: "catalog_sync",
        promise: Promise.resolve({ status: "SUCCEEDED" }),
      }],
      () => undefined,
      { persistIncidents: true },
    );
    assert.equal(
      (
        await db.operationalIncident.findUniqueOrThrow({
          where: { id: incident.id },
        })
      ).status,
      "RESOLVED",
    );
  } finally {
    if (previousSmsProvider === undefined) delete process.env.SMS_PROVIDER;
    else process.env.SMS_PROVIDER = previousSmsProvider;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }

  const inventoryNow = new Date();
  const inventoryExpiry = new Date(
    inventoryNow.getTime() + 24 * 60 * 60 * 1000,
  );
  await db.user.upsert({
    where: { mobile: "09121112233" },
    update: {},
    create: {
      id: "inventory-customer",
      mobile: "09121112233",
      displayName: "Inventory Customer",
      mobileVerifiedAt: inventoryNow,
    },
  });
  await db.wallet.upsert({
    where: { userId: "inventory-customer" },
    update: { availableBalance: 500_000_000n, status: "ACTIVE" },
    create: {
      id: "inventory-wallet",
      userId: "inventory-customer",
      availableBalance: 500_000_000n,
      status: "ACTIVE",
    },
  });
  await db.providerPricingConfig.upsert({
    where: { provider: InfrastructureProvider.ARVAN },
    update: { enabled: true, sourceMoneyUnit: "IRR" },
    create: {
      id: "arvan-inventory-pricing",
      provider: InfrastructureProvider.ARVAN,
      apiVersion: "v1",
      enabled: true,
      sourceMoneyUnit: "IRR",
      markupBasisPoints: 0,
    },
  });
  await db.productPricingConfig.upsert({
    where: {
      provider_apiVersion_productKind: {
        provider: InfrastructureProvider.ARVAN,
        apiVersion: "v1",
        productKind: InfrastructureProductKind.CLOUD_SERVER,
      },
    },
    update: { enabled: true, markupBasisPoints: 0 },
    create: {
      provider: InfrastructureProvider.ARVAN,
      apiVersion: "v1",
      productKind: InfrastructureProductKind.CLOUD_SERVER,
      enabled: true,
      markupBasisPoints: 0,
    },
  });
  await db.commercePricingConfig.upsert({
    where: { id: "default" },
    update: { taxBps: 0 },
    create: { id: "default", taxBps: 0 },
  });
  await db.profitCurveConfiguration.upsert({
    where: { id: "default" },
    update: { enabled: false },
    create: {
      id: "default",
      enabled: false,
      minimumPostDiscountGrossMarginBps: 2_000,
    },
  });
  await db.parchinPricingConfig.upsert({
    where: { level: ParchinLevel.PARCHIN_START },
    update: { active: true, priceRial: 100_000n },
    create: {
      level: ParchinLevel.PARCHIN_START,
      title: "پرچین شروع",
      priceRial: 100_000n,
      active: true,
    },
  });
  await db.providerRegionConfig.upsert({
    where: {
      provider_apiVersion_regionCode: {
        provider: InfrastructureProvider.ARVAN,
        apiVersion: "v1",
        regionCode: "ir-inventory-1",
      },
    },
    update: { saleEnabled: true, syncEnabled: true },
    create: {
      provider: InfrastructureProvider.ARVAN,
      apiVersion: "v1",
      regionCode: "ir-inventory-1",
      displayName: "Inventory Test",
      saleEnabled: true,
      syncEnabled: true,
    },
  });
  await db.providerCatalogState.upsert({
    where: { provider: InfrastructureProvider.ARVAN },
    update: {
      enabled: true,
      lastCatalogSync: new Date(0),
      lastHealthCheck: new Date(0),
      lastSyncStatus: "FAILED",
      freshnessSlaSeconds: 60,
    },
    create: {
      id: "inventory-arvan-state",
      provider: InfrastructureProvider.ARVAN,
      apiVersion: "v1",
      enabled: true,
      lastCatalogSync: new Date(0),
      lastHealthCheck: new Date(0),
      lastSyncStatus: "FAILED",
      freshnessSlaSeconds: 60,
    },
  });
  const inventoryImage = await db.providerCatalogAsset.upsert({
    where: {
      provider_apiVersion_regionCode_kind_externalId: {
        provider: InfrastructureProvider.ARVAN,
        apiVersion: "v1",
        regionCode: "ir-inventory-1",
        kind: "IMAGE",
        externalId: "inventory-ubuntu",
      },
    },
    update: { available: true, status: "ACTIVE" },
    create: {
      provider: InfrastructureProvider.ARVAN,
      apiVersion: "v1",
      regionCode: "ir-inventory-1",
      kind: "IMAGE",
      externalId: "inventory-ubuntu",
      name: "Ubuntu Inventory",
      status: "ACTIVE",
      available: true,
      lastSeenAt: inventoryNow,
      lastSyncedAt: inventoryNow,
      rawPayload: { ssh_password: true },
      payloadHash: "inventory-image-hash",
    },
  });
  const inventoryCatalog = await db.providerCatalogItem.create({
    data: {
      id: "inventory-catalog",
      provider: InfrastructureProvider.ARVAN,
      apiVersion: "v1",
      productKind: InfrastructureProductKind.CLOUD_SERVER,
      source: "API_CATALOG",
      regionCode: "ir-inventory-1",
      sizeCode: "inventory-g2",
      externalPlanId: "inventory-g2",
      externalKey: "arvan:v1:ir-inventory-1:inventory-g2",
      sizeName: "Inventory G2",
      compatibleImageCodes: [inventoryImage.externalId],
      vcpu: 2,
      ramMb: 4096,
      diskGb: 50,
      available: true,
      active: true,
      status: "ACTIVE",
      providerMonthlyPriceIrr: 8_000_000n,
      providerHourlyPriceIrr: 12_000n,
      currencyCode: "IRR",
      amountUnit: "RIAL",
      lastSyncedAt: inventoryNow,
      lastSeenAt: inventoryNow,
      rawPayload: {},
      payloadHash: "inventory-catalog-hash",
      catalogVersion: "inventory-v1",
    },
  });
  const preprovisionedPlan = await db.infrastructurePlan.create({
    data: {
      id: "preprovisioned-plan",
      code: "PREPROVISIONED_PLAN",
      title: "سرور واقعاً آماده",
      provider: InfrastructureProvider.ARVAN,
      providerApiVersion: "v1",
      productKind: InfrastructureProductKind.CLOUD_SERVER,
      regionCode: "ir-inventory-1",
      sizeCode: "inventory-g2",
      imageCode: inventoryImage.externalId,
      deliveryMode: "MANAGED",
      vcpu: 2,
      ramGb: 4,
      storageGb: 50,
      salePriceRial: 8_100_000n,
      renewalPriceRial: 8_100_000n,
      estimatedProviderCostRial: 8_000_000n,
      deliveryEstimateMinutes: 5,
      parchinIncluded: true,
      minimumParchinLevel: ParchinLevel.PARCHIN_START,
      active: true,
      publicationStatus: "PUBLISHED",
      instantDelivery: true,
      displayDuringProviderOutage: true,
      offerSource: "PREPROVISIONED_INVENTORY",
      offerPriceValidUntil: inventoryExpiry,
      offerLastVerifiedAt: inventoryNow,
      catalogItemId: inventoryCatalog.id,
      catalogMappingStatus: "MAPPED",
      catalogMappedAt: inventoryNow,
    },
  });
  const manualApiPlan = await db.infrastructurePlan.create({
    data: {
      id: "manual-api-backed-plan",
      code: "MANUAL_API_BACKED_PLAN",
      title: "پلن دستی متکی به API",
      provider: InfrastructureProvider.ARVAN,
      providerApiVersion: "v1",
      productKind: InfrastructureProductKind.CLOUD_SERVER,
      regionCode: "ir-inventory-1",
      sizeCode: "inventory-g2",
      imageCode: inventoryImage.externalId,
      deliveryMode: "MANAGED",
      vcpu: 2,
      ramGb: 4,
      storageGb: 50,
      salePriceRial: 8_100_000n,
      renewalPriceRial: 8_100_000n,
      estimatedProviderCostRial: 8_000_000n,
      deliveryEstimateMinutes: 15,
      parchinIncluded: true,
      minimumParchinLevel: ParchinLevel.PARCHIN_START,
      active: true,
      publicationStatus: "PUBLISHED",
      displayDuringProviderOutage: true,
      offerSource: "MANUAL_API_BACKED",
      offerPriceValidUntil: inventoryExpiry,
      offerLastVerifiedAt: inventoryNow,
      catalogItemId: inventoryCatalog.id,
      catalogMappingStatus: "MAPPED",
      catalogMappedAt: inventoryNow,
    },
  });
  await db.infrastructurePlan.create({
    data: {
      id: "api-lkg-plan",
      code: "API_LKG_PLAN",
      title: "آخرین کاتالوگ سالم",
      provider: InfrastructureProvider.ARVAN,
      providerApiVersion: "v1",
      productKind: InfrastructureProductKind.CLOUD_SERVER,
      regionCode: "ir-inventory-1",
      sizeCode: "inventory-g2",
      imageCode: inventoryImage.externalId,
      deliveryMode: "MANAGED",
      vcpu: 2,
      ramGb: 4,
      storageGb: 50,
      salePriceRial: 8_100_000n,
      renewalPriceRial: 8_100_000n,
      estimatedProviderCostRial: 8_000_000n,
      deliveryEstimateMinutes: 15,
      parchinIncluded: true,
      minimumParchinLevel: ParchinLevel.PARCHIN_START,
      active: true,
      publicationStatus: "PUBLISHED",
      displayDuringProviderOutage: true,
      offerSource: "API_CATALOG",
      catalogItemId: inventoryCatalog.id,
      catalogMappingStatus: "MAPPED",
      catalogMappedAt: inventoryNow,
    },
  });

  const inventoryAdapter = new FakeCloudProviderAdapter({
    provider: InfrastructureProvider.ARVAN,
  });
  inventoryAdapter.seedObservedResource({
    id: "provider-inventory-resource-1",
    name: "prebuilt-one",
    region: "ir-inventory-1",
    externalPlanId: "inventory-g2",
    externalImageId: "inventory-ubuntu",
    state: "active",
    ipv4: "192.0.2.210",
    networkIds: ["inventory-network"],
    securityIds: ["inventory-security"],
    observedAt: new Date(),
    rawPayload: {},
  });
  const {
    observeAndRegisterPreprovisionedInventory,
    findFreshAvailableInventory,
    lockAvailableInventoryTx,
    releaseExpiredInventoryReservations,
    releaseInventoryReservationForOrder,
    storePreprovisionedInventoryCredential,
  } = await import(
    "../lib/infrastructure/preprovisioned-inventory.ts"
  );
  const previousCredentialKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  const previousArvanPublicSale = process.env.ARVAN_PUBLIC_SALE_ENABLED;
  const previousArvanMutations = process.env.ARVAN_MUTATIONS_ENABLED;
  const previousManualReadyPublicSale = process.env.MANUAL_READY_PUBLIC_SALE_ENABLED;
  process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.ARVAN_PUBLIC_SALE_ENABLED = "false";
  process.env.ARVAN_MUTATIONS_ENABLED = "false";
  process.env.MANUAL_READY_PUBLIC_SALE_ENABLED = "false";
  const inventoryItem =
    await observeAndRegisterPreprovisionedInventory({
      planId: preprovisionedPlan.id,
      providerResourceId: "provider-inventory-resource-1",
      actorUserId: "migration-admin",
      reason: "PostgreSQL inventory registration",
      adapterOverride: inventoryAdapter,
      probe: async () => true,
    });
  assert.equal(inventoryItem.inventoryStatus, "STALE");
  assert.equal(inventoryItem.healthStatus, "HEALTHY");
  assert.equal(inventoryAdapter.createCalls.length, 0);

  const inventorySelection = {
    planId: preprovisionedPlan.id,
    catalogItemId: inventoryCatalog.id,
    provider: InfrastructureProvider.ARVAN,
    apiVersion: "v1",
    regionCode: "ir-inventory-1",
    externalPlanId: "inventory-g2",
    externalImageId: inventoryImage.externalId,
    externalNetworkId: "inventory-network",
    externalSecurityId: "inventory-security",
  } as const;
  assert.equal(
    await findFreshAvailableInventory(inventorySelection),
    null,
    "healthy inventory without a READY credential must not expose capacity",
  );
  await assert.rejects(
    db.$transaction((tx) => lockAvailableInventoryTx(tx, inventorySelection)),
    /Credential|موجود نیست|سالم/,
  );
  const rawInventorySecret = "Unique-Inventory-Password-001!";
  const inventoryCredential =
    await storePreprovisionedInventoryCredential({
      inventoryItemId: inventoryItem.id,
      actorUserId: "migration-admin",
      username: "root",
      secret: rawInventorySecret,
    });
  assert.equal(inventoryCredential.status, "READY");
  assert.notEqual(inventoryCredential.ciphertext, rawInventorySecret);
  assert.equal(
    (
      await db.preprovisionedInventoryItem.findUniqueOrThrow({
        where: { id: inventoryItem.id },
      })
    ).inventoryStatus,
    "AVAILABLE",
  );

  const duplicateInventory = await db.preprovisionedInventoryItem.create({
    data: {
      id: "duplicate-password-inventory",
      catalogItemId: inventoryCatalog.id,
      planId: preprovisionedPlan.id,
      provider: InfrastructureProvider.ARVAN,
      apiVersion: "v1",
      providerResourceId: "provider-inventory-resource-duplicate",
      regionCode: "ir-inventory-1",
      externalPlanId: "inventory-g2",
      externalImageId: inventoryImage.externalId,
      observedState: "active",
      observedIpv4: "192.0.2.211",
      observedNetworkId: "inventory-network",
      observedSecurityId: "inventory-security",
      lastObservedAt: new Date(),
      lastHealthCheckedAt: new Date(),
      healthStatus: "HEALTHY",
      inventoryStatus: "STALE",
    },
  });
  await assert.rejects(
    storePreprovisionedInventoryCredential({
      inventoryItemId: duplicateInventory.id,
      actorUserId: "migration-admin",
      username: "root",
      secret: rawInventorySecret,
    }),
    /Password یکتا/,
  );

  const { listLiveCloudServerOffers, listLiveReadyServerOffers } =
    await import("../lib/orders/plans.ts");
  const degradedOffers = await listLiveCloudServerOffers();
  const manualOffer = degradedOffers.offers.find(
    (offer) => offer.id === manualApiPlan.id,
  );
  const apiOffer = degradedOffers.offers.find(
    (offer) => offer.id === "api-lkg-plan",
  );
  const inventoryOffer = degradedOffers.offers.find(
    (offer) => offer.id === preprovisionedPlan.id,
  );
  assert.equal(degradedOffers.degraded, true);
  // Cloud offers are keyed by catalog item; the shared inventory item maps to
  // the published API plan only.
  assert.equal(manualOffer, undefined);
  assert.equal(inventoryOffer, undefined);
  // Admin publication keeps the plan browse-visible during outage, but sale
  // stays fail-closed: never purchasable, clearly stale, no leaked base price.
  assert.ok(apiOffer);
  assert.equal(apiOffer.purchasable, false);
  assert.equal(apiOffer.purchaseState, "SALE_DISABLED");
  assert.equal(apiOffer.available, false);
  assert.equal(apiOffer.catalogStatus, "STALE");
  assert.equal(Object.hasOwn(apiOffer, "providerBaseHourlyPriceRial"), false);
  assert.equal(Object.hasOwn(apiOffer, "providerBaseMonthlyPriceRial"), false);
  assert.equal(Object.hasOwn(apiOffer, "sourceCurrencyCode"), false);
  assert.equal(Object.hasOwn(apiOffer, "markupBasisPoints"), false);
  const {
    createCloudServerQuote,
  } = await import("../lib/recommendation/quote-service.ts");
  await assert.rejects(
    createCloudServerQuote({
      planId: preprovisionedPlan.id,
      userId: "inventory-customer",
      idempotencyKey: "inventory-sale-gate-disabled-quote",
      delivery: {
        imageAssetId: inventoryImage.id,
        accessMethod: "ONE_TIME_PASSWORD",
        serverName: "inventory-live",
      },
    }),
    /فروش عمومی/,
  );
  process.env.ARVAN_PUBLIC_SALE_ENABLED = "true";
  process.env.MANUAL_READY_PUBLIC_SALE_ENABLED = "true";
  assert.equal(
    (
      await findFreshAvailableInventory(inventorySelection)
    )?.id,
    inventoryItem.id,
  );
  assert.equal(
    (
      await db.$transaction((tx) =>
        lockAvailableInventoryTx(tx, inventorySelection),
      )
    ).id,
    inventoryItem.id,
  );
  await db.preprovisionedInventoryCredential.update({
    where: { inventoryItemId: inventoryItem.id },
    data: { status: "REVOKED" },
  });
  assert.equal(await findFreshAvailableInventory(inventorySelection), null);
  await db.preprovisionedInventoryCredential.update({
    where: { inventoryItemId: inventoryItem.id },
    data: { status: "TRANSFERRED", transferredAt: new Date() },
  });
  assert.equal(await findFreshAvailableInventory(inventorySelection), null);
  await db.preprovisionedInventoryCredential.update({
    where: { inventoryItemId: inventoryItem.id },
    data: { status: "READY", transferredAt: null },
  });
  await assert.rejects(
    db.preprovisionedInventoryCredential.update({
      where: { inventoryItemId: inventoryItem.id },
      data: { ciphertext: "" },
    }),
    /constraint|check/i,
  );

  const previousArvanEnabledForManual = process.env.ARVAN_ENABLED;
  process.env.ARVAN_ENABLED = "false";
  await assert.rejects(
    createCloudServerQuote({
      planId: manualApiPlan.id,
      userId: "inventory-customer",
      idempotencyKey: "manual-api-outage-quote-0001",
      delivery: {
        imageAssetId: inventoryImage.id,
        accessMethod: "ONE_TIME_PASSWORD",
        serverName: "inventory-live",
      },
    }),
    /فروش عمومی|ساخت این سرور|فعال نشده/i,
  );
  const apiBackedBlockedOrder = await db.serviceOrder.create({
    data: {
      userId: "inventory-customer",
      title: "API backed gate test",
      amount: 8_100_000n,
      currency: "IRR",
      status: "PENDING_PAYMENT",
      planCode: manualApiPlan.code,
      planId: manualApiPlan.id,
      planSnapshot: {},
      provider: InfrastructureProvider.ARVAN,
      providerApiVersion: "v1",
      productKind: InfrastructureProductKind.CLOUD_SERVER,
      parchinLevel: ParchinLevel.PARCHIN_START,
      productFlowState: "AWAITING_PAYMENT",
    },
  });
  const apiBackedWalletBefore =
    await db.wallet.findUniqueOrThrow({
      where: { userId: "inventory-customer" },
    });
  const { payOrderWithWallet: payGateCheckedOrder } =
    await import("../lib/orders/service.ts");
  await assert.rejects(
    payGateCheckedOrder("inventory-customer", apiBackedBlockedOrder.id),
    /فروش عمومی|ساخت این سرور|فعال نشده/i,
  );
  assert.equal(
    (
      await db.wallet.findUniqueOrThrow({
        where: { userId: "inventory-customer" },
      })
    ).availableBalance,
    apiBackedWalletBefore.availableBalance,
  );
  assert.equal(
    await db.walletLedgerEntry.count({
      where: {
        referenceType: "order",
        referenceId: apiBackedBlockedOrder.id,
      },
    }),
    0,
  );
  if (previousArvanEnabledForManual === undefined) {
    delete process.env.ARVAN_ENABLED;
  } else {
    process.env.ARVAN_ENABLED = previousArvanEnabledForManual;
  }

  const concurrentQuotes = await Promise.allSettled([
    createCloudServerQuote({
      planId: preprovisionedPlan.id,
      userId: "inventory-customer",
      idempotencyKey: "inventory-concurrent-quote-a",
      delivery: {
        imageAssetId: inventoryImage.id,
        accessMethod: "ONE_TIME_PASSWORD",
        serverName: "inventory-live",
      },
    }),
    createCloudServerQuote({
      planId: preprovisionedPlan.id,
      userId: "inventory-customer",
      idempotencyKey: "inventory-concurrent-quote-b",
      delivery: {
        imageAssetId: inventoryImage.id,
        accessMethod: "ONE_TIME_PASSWORD",
        serverName: "inventory-live",
      },
    }),
  ]);
  assert.equal(
    concurrentQuotes.filter((result) => result.status === "fulfilled")
      .length,
    1,
    concurrentQuotes
      .map((result) =>
        result.status === "rejected"
          ? result.reason instanceof Error
            ? `${result.reason.name}:${result.reason.message}`
            : String(result.reason)
          : "fulfilled",
      )
      .join(" | "),
  );
  assert.equal(
    concurrentQuotes.filter((result) => result.status === "rejected")
      .length,
    1,
  );
  const firstReservation =
    await db.preprovisionedInventoryItem.findUniqueOrThrow({
      where: { id: inventoryItem.id },
    });
  assert.equal(firstReservation.inventoryStatus, "RESERVED");
  assert.ok(firstReservation.reservedByQuoteId);
  const { createServiceOrderFromQuote, payOrderWithWallet } =
    await import("../lib/orders/service.ts");
  const saleGateQuote = await db.recommendationQuote.findUniqueOrThrow({
    where: { id: firstReservation.reservedByQuoteId! },
  });
  const saleGateOrder = await createServiceOrderFromQuote(
    "inventory-customer",
    saleGateQuote.id,
  );
  const saleGateWalletBefore =
    await db.wallet.findUniqueOrThrow({
      where: { userId: "inventory-customer" },
    });
  process.env.ARVAN_PUBLIC_SALE_ENABLED = "false";
  process.env.MANUAL_READY_PUBLIC_SALE_ENABLED = "false";
  await assert.rejects(
    payOrderWithWallet("inventory-customer", saleGateOrder.id),
    /فروش عمومی/,
  );
  assert.equal(
    (
      await db.wallet.findUniqueOrThrow({
        where: { userId: "inventory-customer" },
      })
    ).availableBalance,
    saleGateWalletBefore.availableBalance,
  );
  assert.equal(
    await db.walletLedgerEntry.count({
      where: { referenceType: "order", referenceId: saleGateOrder.id },
    }),
    0,
  );
  process.env.ARVAN_PUBLIC_SALE_ENABLED = "true";
  process.env.MANUAL_READY_PUBLIC_SALE_ENABLED = "true";
  await db.preprovisionedInventoryItem.update({
    where: { id: inventoryItem.id },
    data: { reservationExpiresAt: new Date(Date.now() - 1_000) },
  });
  assert.equal(await releaseExpiredInventoryReservations(), 1);
  assert.equal(
    (
      await db.preprovisionedInventoryItem.findUniqueOrThrow({
        where: { id: inventoryItem.id },
      })
    ).inventoryStatus,
    "AVAILABLE",
  );

  const failureQuoteResult = await createCloudServerQuote({
    planId: preprovisionedPlan.id,
    userId: "inventory-customer",
    idempotencyKey: "inventory-payment-failure-quote",
    delivery: {
      imageAssetId: inventoryImage.id,
      accessMethod: "ONE_TIME_PASSWORD",
      serverName: "inventory-live",
    },
  });
  const failureQuote = await db.recommendationQuote.findFirstOrThrow({
    where: { sessionId: failureQuoteResult.sessionId },
  });
  const failureOrder = await createServiceOrderFromQuote(
    "inventory-customer",
    failureQuote.id,
  );
  const walletBeforeFailure =
    await db.wallet.findUniqueOrThrow({
      where: { userId: "inventory-customer" },
    });
  await assert.rejects(
    payOrderWithWallet("inventory-customer", failureOrder.id, {
      testInjectFailureAfterDebit: true,
    }),
    /Injected failure after debit/,
  );
  const walletAfterFailure = await db.wallet.findUniqueOrThrow({
    where: { userId: "inventory-customer" },
  });
  assert.equal(
    walletAfterFailure.availableBalance,
    walletBeforeFailure.availableBalance,
  );
  assert.equal(
    await db.walletLedgerEntry.count({
      where: { referenceType: "order", referenceId: failureOrder.id },
    }),
    0,
  );
  assert.equal(
    await db.infrastructureOrder.count({
      where: { serviceOrderId: failureOrder.id },
    }),
    0,
  );
  assert.equal(
    await db.instanceCredential.count({
      where: { cloudInstance: { infrastructureOrder: { serviceOrderId: failureOrder.id } } },
    }),
    0,
  );
  assert.equal(
    (
      await db.preprovisionedInventoryCredential.findUniqueOrThrow({
        where: { inventoryItemId: inventoryItem.id },
      })
    ).status,
    "READY",
  );
  assert.equal(
    (
      await db.preprovisionedInventoryItem.findUniqueOrThrow({
        where: { id: inventoryItem.id },
      })
    ).inventoryStatus,
    "AVAILABLE",
  );
  assert.equal(
    await releaseInventoryReservationForOrder(
      failureOrder.id,
      "idempotent_replay",
    ),
    false,
  );

  const successQuoteResult = await createCloudServerQuote({
    planId: preprovisionedPlan.id,
    userId: "inventory-customer",
    idempotencyKey: "inventory-payment-success-quote",
    delivery: {
      imageAssetId: inventoryImage.id,
      accessMethod: "ONE_TIME_PASSWORD",
      serverName: "inventory-live",
    },
  });
  const successQuote = await db.recommendationQuote.findFirstOrThrow({
    where: { sessionId: successQuoteResult.sessionId },
  });
  const successOrder = await createServiceOrderFromQuote(
    "inventory-customer",
    successQuote.id,
  );
  const [successfulPayment, concurrentPaymentReplay] = await Promise.all([
    payOrderWithWallet("inventory-customer", successOrder.id),
    payOrderWithWallet("inventory-customer", successOrder.id),
  ]);
  assert.equal(successfulPayment.order.status, "PAID");
  assert.equal(concurrentPaymentReplay.order.id, successfulPayment.order.id);
  const reservedInventory =
    await db.preprovisionedInventoryItem.findUniqueOrThrow({
      where: { id: inventoryItem.id },
    });
  assert.equal(reservedInventory.inventoryStatus, "RESERVED");
  assert.equal(reservedInventory.assignedOrderId, null);
  assert.equal(
    successfulPayment.infrastructureOrder?.preprovisionedInventoryItemId,
    inventoryItem.id,
  );
  assert.equal(
    successfulPayment.infrastructureOrder?.status,
    InfrastructureOrderStatus.WAITING_ADMIN_FUNDING,
  );
  assert.equal(
    await db.cloudInstance.count({
      where: { infrastructureOrderId: successfulPayment.infrastructureOrder!.id },
    }),
    0,
  );
  assert.equal(
    await db.provisioningJob.count({
      where: { infrastructureOrderId: successfulPayment.infrastructureOrder!.id },
    }),
    0,
  );
  const retainedInventoryCredential =
    await db.preprovisionedInventoryCredential.findUniqueOrThrow({
      where: { inventoryItemId: inventoryItem.id },
    });
  assert.equal(retainedInventoryCredential.status, "READY");
  assert.equal(retainedInventoryCredential.transferredAt, null);
  const persistedNonSecretSurfaces = JSON.stringify({
    planSnapshot: successQuote.planSnapshot,
    quoteDelivery: successQuote.deliveryConfigurationSnapshot,
    providerSelection:
      (
        await db.infrastructureOrder.findUniqueOrThrow({
          where: { id: successfulPayment.infrastructureOrder!.id },
        })
      ).providerSelectionSnapshot,
    inventoryAudit: reservedInventory.adminAudit,
    audits: await db.auditLog.findMany({
      where: { entityId: inventoryItem.id },
    }),
  });
  assert.equal(persistedNonSecretSurfaces.includes(rawInventorySecret), false);
  await payOrderWithWallet("inventory-customer", successOrder.id);
  assert.equal(
    await db.walletLedgerEntry.count({
      where: { referenceType: "order", referenceId: successOrder.id },
    }),
    1,
  );
  assert.equal(
    await db.preprovisionedInventoryItem.count({
      where: { assignedOrderId: successOrder.id },
    }),
    0,
  );
  assert.equal(
    await db.cloudInstance.count({
      where: { infrastructureOrderId: successfulPayment.infrastructureOrder!.id },
    }),
    0,
  );

  await storePreprovisionedInventoryCredential({
    inventoryItemId: duplicateInventory.id,
    actorUserId: "migration-admin",
    username: "root",
    secret: "Unique-Inventory-Password-002!",
  });
  await db.preprovisionedInventoryItem.update({
    where: { id: duplicateInventory.id },
    data: {
      observedNetworkId: null,
      inventoryStatus: "AVAILABLE",
    },
  });
  assert.equal(
    await findFreshAvailableInventory(inventorySelection),
    null,
    "preview must reject a resource without an observed network",
  );
  await assert.rejects(
    db.$transaction((tx) => lockAvailableInventoryTx(tx, inventorySelection)),
    /سالم|موجود نیست/,
    "the transactional lock must apply the same network/security eligibility",
  );

  await db.preprovisionedInventoryItem.createMany({
    data: [
      ["UNHEALTHY", "UNHEALTHY"],
      ["STALE", "HEALTHY"],
      ["DISABLED", "HEALTHY"],
      ["ASSIGNED", "HEALTHY"],
    ].map(([inventoryStatus, healthStatus], index) => ({
      id: `unsellable-inventory-${index}`,
      catalogItemId: inventoryCatalog.id,
      planId: preprovisionedPlan.id,
      provider: InfrastructureProvider.ARVAN,
      apiVersion: "v1",
      providerResourceId: `unsellable-resource-${index}`,
      regionCode: "ir-inventory-1",
      externalPlanId: "inventory-g2",
      externalImageId: "inventory-ubuntu",
      observedState: "active",
      observedIpv4: `192.0.2.${220 + index}`,
      observedNetworkId: "inventory-network",
      observedSecurityId: "inventory-security",
      lastObservedAt: new Date(),
      lastHealthCheckedAt: new Date(),
      healthStatus: healthStatus as "HEALTHY" | "UNHEALTHY",
      inventoryStatus: inventoryStatus as
        | "UNHEALTHY"
        | "STALE"
        | "DISABLED"
        | "ASSIGNED",
      ...(inventoryStatus === "ASSIGNED"
        ? {
            assignedOrderId: successOrder.id,
            assignedAt: new Date(),
          }
        : {}),
    })),
    skipDuplicates: true,
  });
  assert.equal(
    await (
      await import(
        "../lib/infrastructure/preprovisioned-inventory.ts"
      )
    ).countAvailableInventoryByPlan([preprovisionedPlan.id]).then(
      (counts) => counts.get(preprovisionedPlan.id) ?? 0,
    ),
    0,
  );

  const awaitingPreprovisionedOrder =
    await db.infrastructureOrder.findUniqueOrThrow({
      where: { id: successfulPayment.infrastructureOrder!.id },
      include: { serviceOrder: true, cloudInstance: true },
    });
  assert.equal(awaitingPreprovisionedOrder.status, "WAITING_ADMIN_FUNDING");
  assert.equal(awaitingPreprovisionedOrder.productFlowState, "PAID");
  assert.equal(awaitingPreprovisionedOrder.serviceOrder.productFlowState, "PAID");
  assert.equal(awaitingPreprovisionedOrder.cloudInstance, null);
  assert.equal(
    await db.secureDeliveryEvent.count({
      where: {
        infrastructureOrderId: awaitingPreprovisionedOrder.id,
        resultCode: "secure_delivery_pending",
      },
    }),
    0,
  );
  assert.equal(
    (
      await db.preprovisionedInventoryItem.findUniqueOrThrow({
        where: { id: inventoryItem.id },
      })
    ).inventoryStatus,
    "RESERVED",
  );

  const previousReadyGateEnv = {
    sale: process.env.ARVAN_PUBLIC_SALE_ENABLED,
    readySale: process.env.ARVAN_READY_PUBLIC_SALE_ENABLED,
    enabled: process.env.ARVAN_ENABLED,
    apiKey: process.env.ARVAN_API_KEY,
    baseUrl: process.env.ARVAN_API_BASE_URL,
  };
  try {
    process.env.ARVAN_ENABLED = "true";
    process.env.ARVAN_API_KEY = "postgres-contract-key";
    process.env.ARVAN_API_BASE_URL =
      "https://napi.arvancloud.ir/ecc/v1";
    process.env.ARVAN_READY_PUBLIC_SALE_ENABLED = "true";
    process.env.ARVAN_PUBLIC_SALE_ENABLED = "true";
    await db.providerCatalogState.update({
      where: { provider: InfrastructureProvider.ARVAN },
      data: {
        enabled: true,
        lastSyncStatus: "SUCCEEDED",
        lastCatalogSync: new Date(),
        freshnessSlaSeconds: 900,
      },
    });
    // Selling requires Admin-enabled pricing configs (Financial Center):
    // provider margin + product markup must be switched on for the route.
    await db.providerPricingConfig.upsert({
      where: { provider: InfrastructureProvider.ARVAN },
      update: { enabled: true },
      create: {
        id: "arvan-v1",
        provider: InfrastructureProvider.ARVAN,
        apiVersion: "v1",
        enabled: true,
        markupBasisPoints: 2500,
      },
    });
    await db.productPricingConfig.upsert({
      where: {
        provider_apiVersion_productKind: {
          provider: InfrastructureProvider.ARVAN,
          apiVersion: "v1",
          productKind: InfrastructureProductKind.READY_INSTANT_SERVER,
        },
      },
      update: { enabled: true },
      create: {
        provider: InfrastructureProvider.ARVAN,
        apiVersion: "v1",
        productKind: InfrastructureProductKind.READY_INSTANT_SERVER,
        enabled: true,
        markupBasisPoints: 0,
      },
    });
    await db.profitCurveConfiguration.upsert({
      where: { id: "default" },
      update: { enabled: false },
      create: {
        id: "default",
        enabled: false,
        minimumPostDiscountGrossMarginBps: 2_000,
      },
    });
    const readyPlan =
      await db.infrastructurePlan.findUniqueOrThrow({
        where: { id: arvanPublishedReadyPlan.id },
      });
    const readyImage = await db.providerCatalogAsset.upsert({
      where: {
        provider_apiVersion_regionCode_kind_externalId: {
          provider: InfrastructureProvider.ARVAN,
          apiVersion: "v1",
          regionCode: "runtime-tehran",
          kind: "IMAGE",
          externalId: "ubuntu24-cloudinit-qcow2",
        },
      },
      update: { status: "ACTIVE", available: true },
      create: {
        provider: InfrastructureProvider.ARVAN,
        apiVersion: "v1",
        regionCode: "runtime-tehran",
        kind: "IMAGE",
        externalId: "ubuntu24-cloudinit-qcow2",
        name: "Ubuntu 24.04",
        status: "ACTIVE",
        available: true,
        lastSeenAt: new Date(),
        lastSyncedAt: new Date(),
        rawPayload: { ssh_password: true },
        payloadHash: "arvan-ready-gate-image",
      },
    });
    const {
      createReadyServerQuote,
      getCatalogServerDeliveryOptions,
    } = await import("../lib/recommendation/quote-service.ts");
    const readyDelivery = {
      imageAssetId: readyImage.id,
      accessMethod: "ONE_TIME_PASSWORD" as const,
      serverName: "arvan-gate",
    };
    const deliveryOptions = await getCatalogServerDeliveryOptions({
      planId: readyPlan.id,
      expectedProductKind:
        InfrastructureProductKind.READY_INSTANT_SERVER,
    });
    assert.equal(
      deliveryOptions.images.some((image) => image.id === readyImage.id),
      true,
    );
    const quoteBeforeGateClosed = await createReadyServerQuote({
      planId: readyPlan.id,
      userId: "inventory-customer",
      idempotencyKey: "arvan-gate-quote-before-close",
      delivery: readyDelivery,
    });

    process.env.ARVAN_PUBLIC_SALE_ENABLED = "false";
    // Admin publication keeps the offer browse-visible; the sale flag only
    // closes purchase (fail-closed), it no longer hides the listing.
    const saleClosedReadyOffers = await listLiveReadyServerOffers();
    assert.equal(saleClosedReadyOffers.offers.length, 1);
    assert.equal(
      saleClosedReadyOffers.offers[0]?.id,
      "runtime-arvan-ready-plan",
    );
    assert.equal(saleClosedReadyOffers.offers[0]?.purchasable, false);
    assert.equal(
      saleClosedReadyOffers.offers[0]?.purchaseState,
      "SALE_DISABLED",
    );
    await assert.rejects(
      getCatalogServerDeliveryOptions({
        planId: readyPlan.id,
        expectedProductKind:
          InfrastructureProductKind.READY_INSTANT_SERVER,
      }),
      /فروش عمومی/,
    );
    await assert.rejects(
      createReadyServerQuote({
        planId: readyPlan.id,
        userId: "inventory-customer",
        idempotencyKey: "arvan-gate-new-quote-blocked",
        delivery: readyDelivery,
      }),
      /فروش عمومی/,
    );
    const ordersBeforeBlockedConversion = await db.serviceOrder.count();
    await assert.rejects(
      createServiceOrderFromQuote(
        "inventory-customer",
        quoteBeforeGateClosed.quote.id,
      ),
      /فروش عمومی.*مبلغی برداشت نشد/,
    );
    assert.equal(
      await db.serviceOrder.count(),
      ordersBeforeBlockedConversion,
    );

    process.env.ARVAN_PUBLIC_SALE_ENABLED = "true";
    const payableQuote = await createReadyServerQuote({
      planId: readyPlan.id,
      userId: "inventory-customer",
      idempotencyKey: "arvan-gate-old-order-payment",
      delivery: readyDelivery,
    });
    const oldArvanOrder = await createServiceOrderFromQuote(
      "inventory-customer",
      payableQuote.quote.id,
    );
    const walletBeforeArvanGate =
      await db.wallet.findUniqueOrThrow({
        where: { userId: "inventory-customer" },
      });
    const ledgerBeforeArvanGate = await db.walletLedgerEntry.count({
      where: {
        referenceType: "order",
        referenceId: oldArvanOrder.id,
      },
    });
    const topupsBeforeArvanGate = await db.walletTopUp.count();
    const orderBeforeArvanGate =
      await db.serviceOrder.findUniqueOrThrow({
        where: { id: oldArvanOrder.id },
        select: {
          status: true,
          paidAt: true,
          amount: true,
          planSnapshot: true,
          provider: true,
          providerApiVersion: true,
          productKind: true,
        },
      });
    process.env.ARVAN_PUBLIC_SALE_ENABLED = "false";
    await assert.rejects(
      payOrderWithWallet("inventory-customer", oldArvanOrder.id),
      /فروش عمومی.*مبلغی برداشت نشد/,
    );
    assert.deepEqual(
      await db.wallet.findUniqueOrThrow({
        where: { userId: "inventory-customer" },
      }),
      walletBeforeArvanGate,
    );
    assert.equal(
      await db.walletLedgerEntry.count({
        where: {
          referenceType: "order",
          referenceId: oldArvanOrder.id,
        },
      }),
      ledgerBeforeArvanGate,
    );
    assert.equal(await db.walletTopUp.count(), topupsBeforeArvanGate);
    assert.deepEqual(
      await db.serviceOrder.findUniqueOrThrow({
        where: { id: oldArvanOrder.id },
        select: {
          status: true,
          paidAt: true,
          amount: true,
          planSnapshot: true,
          provider: true,
          providerApiVersion: true,
          productKind: true,
        },
      }),
      orderBeforeArvanGate,
    );
    assert.equal(
      await db.infrastructureOrder.count({
        where: { serviceOrderId: oldArvanOrder.id },
      }),
      0,
    );
  } finally {
    const restore = (
      name: string,
      value: string | undefined,
    ) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore("ARVAN_PUBLIC_SALE_ENABLED", previousReadyGateEnv.sale);
    restore(
      "ARVAN_READY_PUBLIC_SALE_ENABLED",
      previousReadyGateEnv.readySale,
    );
    restore("ARVAN_ENABLED", previousReadyGateEnv.enabled);
    restore("ARVAN_API_KEY", previousReadyGateEnv.apiKey);
    restore("ARVAN_API_BASE_URL", previousReadyGateEnv.baseUrl);
  }
  const { assertProviderRoute } = await import(
    "../lib/infrastructure/provider-routing.ts"
  );
  assert.doesNotThrow(() =>
    assertProviderRoute({
      productKind: InfrastructureProductKind.READY_INSTANT_SERVER,
      provider: InfrastructureProvider.ARVAN,
      apiVersion: "v1",
    }),
  );

  if (previousCredentialKey === undefined) {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  } else {
    process.env.CREDENTIAL_ENCRYPTION_KEY = previousCredentialKey;
  }
  if (previousArvanPublicSale === undefined) {
    delete process.env.ARVAN_PUBLIC_SALE_ENABLED;
  } else {
    process.env.ARVAN_PUBLIC_SALE_ENABLED = previousArvanPublicSale;
  }
  if (previousArvanMutations === undefined) {
    delete process.env.ARVAN_MUTATIONS_ENABLED;
  } else {
    process.env.ARVAN_MUTATIONS_ENABLED = previousArvanMutations;
  }
  if (previousManualReadyPublicSale === undefined) {
    delete process.env.MANUAL_READY_PUBLIC_SALE_ENABLED;
  } else {
    process.env.MANUAL_READY_PUBLIC_SALE_ENABLED = previousManualReadyPublicSale;
  }

  const priorSmsProvider = process.env.SMS_PROVIDER;
  const priorKavenegarApiKey = process.env.KAVENEGAR_API_KEY;
  const priorAlertTemplate = process.env.KAVENEGAR_ALERT_TEMPLATE;
  const priorAdminMobiles = process.env.ADMIN_MOBILES;
  process.env.SMS_PROVIDER = "kavenegar";
  process.env.KAVENEGAR_API_KEY = "configured-but-not-logged";
  process.env.KAVENEGAR_ALERT_TEMPLATE = "";
  process.env.ADMIN_MOBILES = "09120000001";
  const { getOperationalAlertConfigurationStatus } = await import(
    "../lib/operations/alert-configuration.ts"
  );
  assert.equal(
    getOperationalAlertConfigurationStatus().status,
    "CONFIG_REQUIRED",
  );
  const { processOperationalAlertOutbox } = await import(
    "../lib/operations/alert-worker.ts"
  );
  assert.equal(await processOperationalAlertOutbox(10), 0);
  if (priorSmsProvider === undefined) delete process.env.SMS_PROVIDER;
  else process.env.SMS_PROVIDER = priorSmsProvider;
  if (priorKavenegarApiKey === undefined) delete process.env.KAVENEGAR_API_KEY;
  else process.env.KAVENEGAR_API_KEY = priorKavenegarApiKey;
  if (priorAlertTemplate === undefined) delete process.env.KAVENEGAR_ALERT_TEMPLATE;
  else process.env.KAVENEGAR_ALERT_TEMPLATE = priorAlertTemplate;
  if (priorAdminMobiles === undefined) delete process.env.ADMIN_MOBILES;
  else process.env.ADMIN_MOBILES = priorAdminMobiles;

  console.log(
    "PostgreSQL integration passed (139 scenarios): V6 PAYMENT_REVIEW recovery after V4/V5, V6 QUOTE_EXPIRED semantic recovery, monotonic revisions, stale-revision conflict, immutable financial/provider snapshots, multi-order terminal recovery, live-sibling protection, all-terminal alignment, transactional runtime refund, fail-closed resource disposition, global Admin receipt conflicts, direct-catalog audit, provider-capability health verification, manual recovery, Admin action/backend parity, mandatory main-worker claim tokens, fenced desired-name persistence, fenced stale-worker create recovery, RECONCILING fence rollback, one-create reconciliation, transactional failure outbox, ACTIVE outbox reconciliation and retry delivery, finalize-only replay for successful and failed health results, durable concurrent health-retry dispatch, poison dispatch isolation, persisted dispatch backoff, dead-letter manual review, three-attempt health retry ceiling, missing-outbox batch progress, concurrent outbox uniqueness, idempotent reconciler replay, forward-only Admin catalog, preprovisioned inventory and inventory-credential migrations with immutable commerce snapshots, Arvan master-sale gate at quote and pre-debit payment, old-quote gate revalidation, API-backed mutation-gate enforcement, inventory-only sale with mutations disabled, credentialless/revoked/transferred inventory exclusion, unique encrypted inventory credentials, raw-secret non-disclosure, atomic credential transfer, post-debit rollback, idempotent payment replay, concurrent no-double-sell, shared Network/Security eligibility, secure delivery to ACTIVE, zero-create inventory recovery, API/manual outage fail-closed behavior, real healthy inventory-only outage sale, atomic no-double-sell reservation, expired and failed-payment reservation release, exact post-payment assignment, idempotent debit/assignment replay, unsellable inventory states, Arvan fail-closed listing, delivery, new-quote, old-quote conversion and pre-debit payment gates with immutable wallet, ledger, order and payment state, immutable routing, Kavenegar CONFIG_REQUIRED safety, Admin-curated Arvan publication isolation, Arvan partial-region last-known-good preservation, critical incident deduplication, durable SMS outbox delivery, and incident recovery",
  );
} finally {
  try {
    await flowDb?.$disconnect();
    await db.$executeRawUnsafe(
      `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`,
    );
  } finally {
    try {
      await db.$disconnect();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}
