import {
  AdminNotificationStatus,
  AdminNotificationType,
  InfrastructureProvider,
  OperationalIncidentSeverity,
  OperationalIncidentStatus,
  type Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";

const MOBILE_PATTERN = /^09\d{9}$/;

function incidentFingerprint(input: {
  provider?: InfrastructureProvider | null;
  apiVersion?: string | null;
  operation: string;
  safeCode: string;
}) {
  return [
    input.provider ?? "SYSTEM",
    input.apiVersion ?? "none",
    input.operation,
    input.safeCode,
  ].join(":");
}

async function alertRecipients(
  tx: Prisma.TransactionClient,
  severity: OperationalIncidentSeverity,
) {
  const admins = await tx.user.findMany({
    where: { role: "ADMIN" },
    select: { mobile: true, alertSubscription: true },
  });
  const configured =
    severity === OperationalIncidentSeverity.CRITICAL
      ? getEnv().adminMobiles
      : [];
  return [
    ...new Set(
      [
        ...admins
          .filter((admin) => {
            const preference = admin.alertSubscription;
            if (preference && (!preference.active || !preference.smsEnabled)) return false;
            if (severity === OperationalIncidentSeverity.WARNING) {
              return preference?.criticalOnly === false;
            }
            return true;
          })
          .map((admin) => admin.mobile),
        ...configured,
      ]
        .map((mobile) => mobile.trim())
        .filter((mobile) => MOBILE_PATTERN.test(mobile)),
    ),
  ];
}

export async function recordOperationalIncident(input: {
  provider?: InfrastructureProvider | null;
  apiVersion?: string | null;
  operation: string;
  safeCode: string;
  title: string;
  safeMessage: string;
  severity: OperationalIncidentSeverity;
  occurredAt?: Date;
}) {
  const occurredAt = input.occurredAt ?? new Date();
  const fingerprint = incidentFingerprint(input);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`operational-incident:${fingerprint}`}, 0)
      )::text AS locked
    `;
    const existing = await tx.operationalIncident.findFirst({
      where: { fingerprint, status: OperationalIncidentStatus.OPEN },
    });
    if (existing) {
      return tx.operationalIncident.update({
        where: { id: existing.id },
        data: {
          occurrenceCount: { increment: 1 },
          lastOccurredAt: occurredAt,
          safeMessage: input.safeMessage,
          severity: input.severity,
        },
      });
    }
    const incident = await tx.operationalIncident.create({
      data: {
        provider: input.provider ?? null,
        apiVersion: input.apiVersion ?? null,
        operation: input.operation,
        safeCode: input.safeCode,
        title: input.title,
        safeMessage: input.safeMessage,
        severity: input.severity,
        fingerprint,
        firstOccurredAt: occurredAt,
        lastOccurredAt: occurredAt,
      },
    });
    await tx.adminNotification.create({
      data: {
        type: AdminNotificationType.PROVIDER_UNAVAILABLE,
        title: input.title,
        message: input.safeMessage,
        status: AdminNotificationStatus.UNREAD,
      },
    });
    const recipients = await alertRecipients(tx, input.severity);
    if (recipients.length > 0) {
      await tx.operationalAlertOutbox.createMany({
        data: recipients.map((recipient) => ({
          incidentId: incident.id,
          recipient,
          idempotencyKey: `incident-open:${incident.id}:${recipient}`,
        })),
        skipDuplicates: true,
      });
    }
    return incident;
  });
}

export async function resolveOperationalIncidents(input: {
  provider: InfrastructureProvider;
  apiVersion: string;
  operation: string;
  resolutionCode?: string;
}) {
  return prisma.operationalIncident.updateMany({
    where: {
      provider: input.provider,
      apiVersion: input.apiVersion,
      operation: input.operation,
      status: OperationalIncidentStatus.OPEN,
    },
    data: {
      status: OperationalIncidentStatus.RESOLVED,
      resolvedAt: new Date(),
      resolutionCode: input.resolutionCode ?? "provider_recovered",
    },
  });
}
