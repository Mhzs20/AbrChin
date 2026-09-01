#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";

import { archiveParsPackHistory } from "./parspack-history-lib.mts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
try {
  const result = await archiveParsPackHistory(db);
  console.log(
    JSON.stringify(
      {
        receiptId: result.receiptId,
        beforeChecksum: result.before.liveChecksum,
        afterChecksum: result.afterChecksum,
        commercialRowCount: result.before.commercialRowCount,
        counts: result.before.counts,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
