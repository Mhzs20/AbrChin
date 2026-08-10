import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    ...(process.env.ABRCHIN_ISOLATED_TEST === "1"
      ? {
          // PGlite's PostgreSQL socket is slower and serializes more work than
          // production PostgreSQL. This never changes runtime defaults.
          transactionOptions: { maxWait: 30_000, timeout: 30_000 },
        }
      : {}),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
