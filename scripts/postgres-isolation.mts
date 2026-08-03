import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";

import { PrismaClient } from "@prisma/client";

const execFileAsync = promisify(execFile);

export async function withIsolatedPostgres<T>(
  label: string,
  operation: (databaseUrl: string) => Promise<T>,
) {
  const baseUrl = process.env.POSTGRES_TEST_DATABASE_URL;
  if (!baseUrl) {
    throw new Error(
      "POSTGRES_TEST_DATABASE_URL is required for isolated PostgreSQL tests",
    );
  }
  const databaseUrl = new URL(baseUrl);
  const schemaName = `abrchin_${label}_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
  databaseUrl.searchParams.set("schema", schemaName);
  const isolatedUrl = databaseUrl.toString();
  const admin = new PrismaClient({
    datasources: { db: { url: isolatedUrl } },
  });
  try {
    await execFileAsync(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["prisma", "migrate", "deploy"],
      {
        env: { ...process.env, DATABASE_URL: isolatedUrl },
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    return await operation(isolatedUrl);
  } finally {
    await admin.$executeRawUnsafe(
      `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`,
    );
    await admin.$disconnect();
  }
}
