import {
  OperationalAlertDeliveryStatus,
  type OperationalAlertOutbox,
  type OperationalIncident,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { createSmsProvider, SmsDeliveryError } from "@/lib/sms/index";

const MAX_ALERT_ATTEMPTS = 3;
const STALE_SENDING_MS = 5 * 60 * 1000;

type ClaimedAlert = OperationalAlertOutbox & {
  incident: OperationalIncident;
};

async function claimAlert(now: Date): Promise<ClaimedAlert | null> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "OperationalAlertOutbox"
      WHERE "status" IN ('PENDING', 'RETRY')
        AND "nextAttemptAt" <= ${now}
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    const claimed = await tx.operationalAlertOutbox.updateMany({
      where: {
        id: row.id,
        status: { in: [
          OperationalAlertDeliveryStatus.PENDING,
          OperationalAlertDeliveryStatus.RETRY,
        ] },
        nextAttemptAt: { lte: now },
      },
      data: {
        status: OperationalAlertDeliveryStatus.SENDING,
        attemptCount: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return null;
    return tx.operationalAlertOutbox.findUnique({
      where: { id: row.id },
      include: { incident: true },
    });
  });
}

export async function processOperationalAlertOutbox(limit = 10) {
  const now = new Date();
  await prisma.operationalAlertOutbox.updateMany({
    where: {
      status: OperationalAlertDeliveryStatus.SENDING,
      updatedAt: { lte: new Date(now.getTime() - STALE_SENDING_MS) },
    },
    data: {
      status: OperationalAlertDeliveryStatus.RETRY,
      nextAttemptAt: now,
      lastErrorCode: "stale_claim_recovered",
    },
  });
  let processed = 0;
  for (let index = 0; index < limit; index += 1) {
    const alert = await claimAlert(new Date());
    if (!alert) break;
    processed += 1;
    try {
      const sms = createSmsProvider();
      if (!sms.sendOperationalAlert) {
        throw new SmsDeliveryError("unsupported", "Operational SMS is unsupported");
      }
      await sms.sendOperationalAlert({
        mobile: alert.recipient,
        safeCode: alert.incident.safeCode,
        provider: alert.incident.provider ?? "SYSTEM",
        severity: alert.incident.severity,
      });
      await prisma.operationalAlertOutbox.updateMany({
        where: { id: alert.id, status: OperationalAlertDeliveryStatus.SENDING },
        data: {
          status: OperationalAlertDeliveryStatus.SENT,
          sentAt: new Date(),
          lastErrorCode: null,
        },
      });
    } catch (error) {
      const exhausted = alert.attemptCount >= MAX_ALERT_ATTEMPTS;
      const code = error instanceof SmsDeliveryError ? error.code : "unknown";
      const backoffSeconds = 30 * 2 ** Math.max(alert.attemptCount - 1, 0);
      await prisma.operationalAlertOutbox.updateMany({
        where: { id: alert.id, status: OperationalAlertDeliveryStatus.SENDING },
        data: {
          status: exhausted
            ? OperationalAlertDeliveryStatus.EXHAUSTED
            : OperationalAlertDeliveryStatus.RETRY,
          nextAttemptAt: new Date(Date.now() + backoffSeconds * 1000),
          lastErrorCode: code,
        },
      });
    }
  }
  return processed;
}
