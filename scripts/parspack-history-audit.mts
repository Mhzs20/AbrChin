#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";

import {
  auditParsPackHistory,
  formatAudit,
} from "./parspack-history-lib.mts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
try {
  const audit = await auditParsPackHistory(db);
  console.log(formatAudit(audit));
  console.log(
    `[parspack-audit] commercialRowCount=${audit.commercialRowCount} dropApplied=${audit.dropApplied} enumPresent=${audit.parspackEnumPresent}`,
  );
} finally {
  await db.$disconnect();
}
