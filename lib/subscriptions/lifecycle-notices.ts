import {
  AdminNotificationStatus,
  AdminNotificationType,
  SubscriptionStatus,
} from "@prisma/client";

import { getLifecyclePolicy } from "@/lib/billing/lifecycle-policy";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { KavenegarSmsProvider } from "@/lib/sms/kavenegar";

function daysFromNow(days: number, now: Date) {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1_000);
}

export async function sendLifecycleSms(input: {
  mobile: string;
  serverName: string;
  kind: "reminder" | "past_due" | "suspended";
  daysLeft?: number;
}) {
  const env = getEnv();
  if (env.smsProvider !== "kavenegar" || !env.kavenegarApiKey) return;
  const template = env.kavenegarAlertTemplate || env.kavenegarTemplate;
  if (!template) return;
  const provider = new KavenegarSmsProvider({
    apiKey: env.kavenegarApiKey,
    template,
    alertTemplate: env.kavenegarAlertTemplate || undefined,
    timeoutMs: env.kavenegarTimeoutMs,
  });
  const safeCode =
    input.kind === "reminder"
      ? `renew-${Math.min(input.daysLeft ?? 1, 99)}d`
      : input.kind === "past_due"
        ? "past-due"
        : "suspended";
  // Reuse alert lookup tokens with safe non-secret values.
  if (env.kavenegarAlertTemplate) {
    await provider.sendOperationalAlert({
      mobile: input.mobile,
      safeCode,
      provider: input.serverName.slice(0, 32),
      severity: input.kind === "reminder" ? "WARNING" : "CRITICAL",
    });
    return;
  }
  await provider.sendOtp({
    mobile: input.mobile,
    code: String(Math.min(input.daysLeft ?? 1, 99)).padStart(2, "0"),
    purpose:
      input.kind === "reminder"
        ? "renewal_reminder"
        : input.kind === "past_due"
          ? "renewal_past_due"
          : "renewal_suspended",
  });
}

async function sendReminderSms(mobile: string, serverName: string, daysLeft: number) {
  await sendLifecycleSms({
    mobile,
    serverName,
    kind: "reminder",
    daysLeft,
  });
}

/** Reminder SMS + Admin review for suspend/delete using Commerce lifecycle days. */
export async function processLifecycleNotices(now = new Date()) {
  const policy = await getLifecyclePolicy();
  const reminderWindowEnd = daysFromNow(policy.reminderDaysBeforeDue, now);

  const dueSoon = await prisma.serviceSubscription.findMany({
    where: {
      status: SubscriptionStatus.ACTIVE,
      nextRenewalAt: { gt: now, lte: reminderWindowEnd },
      OR: [{ lastReminderSentAt: null }, { lastReminderSentAt: { lt: now } }],
    },
    include: {
      user: { select: { id: true, mobile: true } },
      cloudInstance: { select: { name: true, infrastructureOrderId: true } },
    },
    take: 50,
    orderBy: { nextRenewalAt: "asc" },
  });

  let reminders = 0;
  for (const subscription of dueSoon) {
    if (subscription.lastReminderSentAt) {
      const sameCycle =
        subscription.lastReminderSentAt.getTime() >=
        subscription.currentPeriodStart.getTime();
      if (sameCycle) continue;
    }
    const daysLeft = Math.max(
      1,
      Math.ceil(
        (subscription.nextRenewalAt.getTime() - now.getTime()) /
          (24 * 60 * 60 * 1000),
      ),
    );
    try {
      if (subscription.user.mobile) {
        await sendReminderSms(
          subscription.user.mobile,
          subscription.cloudInstance.name,
          daysLeft,
        );
      }
    } catch (error) {
      console.error(
        "[lifecycle:reminder-sms]",
        error instanceof Error ? error.message : "unknown",
      );
    }
    await prisma.serviceSubscription.update({
      where: { id: subscription.id },
      data: { lastReminderSentAt: now },
    });
    await prisma.adminNotification.create({
      data: {
        type: AdminNotificationType.RENEWAL_DUE,
        infrastructureOrderId: subscription.cloudInstance.infrastructureOrderId,
        title: "یادآوری تمدید نزدیک است",
        message: `سرور ${subscription.cloudInstance.name} تا ${daysLeft} روز دیگر به سررسید می‌رسد.`,
        status: AdminNotificationStatus.UNREAD,
      },
    });
    reminders += 1;
  }

  const deleteCandidates = await prisma.serviceSubscription.findMany({
    where: {
      status: SubscriptionStatus.SUSPENDED,
      suspendedAt: {
        lte: new Date(
          now.getTime() -
            policy.deleteDaysAfterSuspend * 24 * 60 * 60 * 1000,
        ),
      },
      deleteReviewAt: null,
    },
    include: {
      cloudInstance: { select: { name: true, infrastructureOrderId: true, id: true } },
    },
    take: 50,
  });

  let deleteReviews = 0;
  for (const subscription of deleteCandidates) {
    await prisma.$transaction(async (tx) => {
      await tx.serviceSubscription.update({
        where: { id: subscription.id },
        data: { deleteReviewAt: now },
      });
      await tx.adminNotification.create({
        data: {
          type: AdminNotificationType.RENEWAL_DUE,
          infrastructureOrderId:
            subscription.cloudInstance.infrastructureOrderId,
          title: "بررسی حذف سرور پس از مهلت تعلیق",
          message: `مهلت تمدید سرور ${subscription.cloudInstance.name} تمام شد؛ حذف نیازمند تأیید Admin است.`,
          status: AdminNotificationStatus.UNREAD,
        },
      });
      await tx.resourceChangeRequest.create({
        data: {
          cloudInstanceId: subscription.cloudInstance.id,
          planId: subscription.planId,
          requestedById: subscription.userId,
          requestedResources: {
            action: "TERMINATE",
            source: "LIFECYCLE_DELETE_REVIEW",
            providerMutationExecuted: false,
          },
          estimateSnapshot: { note: "delete_review_after_grace" },
          incrementalBufferRial: 0n,
          status: "WAITING_ADMIN_APPROVAL",
          idempotencyKey: `lifecycle-delete:${subscription.id}`,
        },
      });
    });
    deleteReviews += 1;
  }

  return { reminders, deleteReviews };
}
