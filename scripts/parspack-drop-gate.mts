#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";

import { assertParsPackDropGate, formatAudit } from "./parspack-history-lib.mts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
try {
  const result = await assertParsPackDropGate(db);
  console.log(`[parspack-drop-gate] ${result.ok ? "PASS" : "FAIL"} ${result.reason}`);
  console.log(formatAudit(result.audit));
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
