import { PrismaClient } from "@prisma/client";

const staleMs = Number.parseInt(process.env.WORKER_STALE_AFTER_MS ?? "60000", 10);

async function main() {
  const prisma = new PrismaClient();
  try {
    const row = await prisma.workerHeartbeat.findUnique({ where: { id: "provisioning" } });
    if (!row) process.exit(1);
    const ageMs = Date.now() - row.lastSeenAt.getTime();
    if (ageMs > staleMs * 2) process.exit(1);
    if (row.status !== "healthy") process.exit(1);
    if (!row.lastCycleAt) process.exit(1);
    process.exit(0);
  } catch {
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
