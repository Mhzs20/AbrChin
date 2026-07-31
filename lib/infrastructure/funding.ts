import {
  AdminNotificationStatus,
  AdminNotificationType,
  InfrastructureOrderStatus,
  InfrastructureProvider,
  ProvisioningJobStatus,
} from "@prisma/client";

import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { isProviderConfigured } from "@/lib/infrastructure/provider-factory";
import { transitionProductFlowTx } from "@/lib/product-flow/service";
import { assertPositiveIntegerToman, tomanToRial } from "@/lib/money";
import { WalletError } from "@/lib/wallet/errors";

const FUNDING_ALLOWED_STATUSES: InfrastructureOrderStatus[] = [
  InfrastructureOrderStatus.WAITING_ADMIN_FUNDING,
  InfrastructureOrderStatus.BLOCKED_PROVIDER_BALANCE,
];

export async function confirmProviderFunding(params: {
  infrastructureOrderId: string;
  adminUserId: string;
  fundedAmountToman: number;
  receiptReference?: string | null;
  note?: string | null;
  idempotencyKey?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const fundedAmountRial = tomanToRial(params.fundedAmountToman);
  const receiptReference = params.receiptReference?.trim() || null;
  const note = params.note?.trim() || null;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "InfrastructureOrder" WHERE id = ${params.infrastructureOrderId} FOR UPDATE`;

    const order = await tx.infrastructureOrder.findUnique({
      where: { id: params.infrastructureOrderId },
      include: {
        fundingConfirmations: { orderBy: { attempt: "desc" } },
        serviceOrder: { include: { recommendationQuote: true } },
        plan: true,
        cloudInstance: true,
      },
    });
    if (!order) throw new WalletError("not_found", "سفارش زیرساخت پیدا نشد.");

    const nextAttempt = (order.fundingConfirmations[0]?.attempt ?? 0) + 1;
    const confirmationKey =
      params.idempotencyKey?.trim() ||
      `funding_confirm_${order.id}_a${nextAttempt}_${params.adminUserId}`;

    const existingConfirmation = await tx.providerFundingConfirmation.findUnique({
      where: { idempotencyKey: confirmationKey },
    });
    if (existingConfirmation) {
      if (
        existingConfirmation.infrastructureOrderId !==
          params.infrastructureOrderId ||
        existingConfirmation.confirmedById !== params.adminUserId ||
        existingConfirmation.fundedAmountRial !== fundedAmountRial ||
        existingConfirmation.receiptReference !== receiptReference ||
        existingConfirmation.note !== note
      ) {
        throw new WalletError(
          "idempotency_conflict",
          "شناسه یکتا قبلاً برای تأیید شارژ دیگری استفاده شده است.",
        );
      }
      const job = await tx.provisioningJob.findFirst({
        where: {
          infrastructureOrderId: order.id,
          idempotencyKey: `parspack_create_${order.id}_a${existingConfirmation.attempt}`,
        },
      });
      return { order, fundingConfirmation: existingConfirmation, job };
    }

    if (!FUNDING_ALLOWED_STATUSES.includes(order.status)) {
      throw new WalletError("invalid_status", "این سفارش در وضعیت تأیید شارژ نیست.");
    }
    if (order.provider !== InfrastructureProvider.PARSPACK) {
      throw new WalletError(
        "provider_route_mismatch",
        "تأیید شارژ دستی فقط برای سفارش سرور آماده مجاز است.",
      );
    }
    if (!isProviderConfigured()) {
      throw new WalletError("provider_disabled", "Provider فعال نیست؛ صف‌بندی مجاز نیست.");
    }
    if (fundedAmountRial <= 0n) {
      throw new WalletError("invalid_amount", "مبلغ شارژ باید مثبت باشد.");
    }
    if (fundedAmountRial < order.requiredFundingRial) {
      throw new WalletError(
        "invalid_amount",
        "مبلغ شارژ تأییدشده باید حداقل برابر هزینه موردنیاز Provider باشد.",
      );
    }

    const activeCreateJob = await tx.provisioningJob.findFirst({
      where: {
        infrastructureOrderId: order.id,
        operation: "create_instance",
        status: { in: [ProvisioningJobStatus.QUEUED, ProvisioningJobStatus.RUNNING] },
      },
    });
    if (activeCreateJob) {
      throw new WalletError("invalid_status", "Job ساخت فعال در حال اجراست.");
    }

    const fundingConfirmation = await tx.providerFundingConfirmation.create({
      data: {
        infrastructureOrderId: order.id,
        attempt: nextAttempt,
        provider: order.provider,
        requiredAmountRial: order.requiredFundingRial,
        fundedAmountRial,
        receiptReference,
        note,
        confirmedById: params.adminUserId,
        idempotencyKey: confirmationKey,
        ip: params.ip?.slice(0, 64) ?? null,
        userAgent: params.userAgent?.slice(0, 255) ?? null,
      },
    });

    const jobIdempotencyKey = `parspack_create_${order.id}_a${nextAttempt}`;
    let job = await tx.provisioningJob.findUnique({ where: { idempotencyKey: jobIdempotencyKey } });
    if (!job) {
      job = await tx.provisioningJob.create({
        data: {
          infrastructureOrderId: order.id,
          operation: "create_instance",
          status: ProvisioningJobStatus.QUEUED,
          idempotencyKey: jobIdempotencyKey,
          attempt: nextAttempt,
        },
      });
    }

    await tx.infrastructureOrder.update({
      where: { id: order.id },
      data: { status: InfrastructureOrderStatus.QUEUED },
    });
    const fundingFromState =
      order.productFlowState === "PAID" ||
      order.productFlowState === "PROVISIONING_RETRYABLE" ||
      order.productFlowState === "PROVISIONING_MANUAL_REVIEW"
        ? order.productFlowState
        : null;
    if (!fundingFromState) {
      throw new WalletError(
        "invalid_status",
        "وضعیت جریان سفارش برای تأیید شارژ معتبر نیست.",
      );
    }
    await transitionProductFlowTx(tx, {
      owner: {
        recommendationSessionId:
          order.serviceOrder.recommendationQuote?.sessionId ?? null,
        serviceOrderId: order.serviceOrderId,
        infrastructureOrderId: order.id,
      },
      from: fundingFromState,
      to: "PROVISIONING_SUBMITTED",
      reason: "provider_funding_confirmed",
      idempotencyKey: `funding-flow:${fundingConfirmation.id}`,
      actorUserId: params.adminUserId,
    });

    await tx.adminNotification.updateMany({
      where: {
        infrastructureOrderId: order.id,
        type: {
          in: [
            AdminNotificationType.ORDER_WAITING_PROVIDER_FUNDING,
            AdminNotificationType.PROVIDER_BALANCE_BLOCKED,
          ],
        },
        status: { in: [AdminNotificationStatus.UNREAD, AdminNotificationStatus.READ] },
      },
      data: { status: AdminNotificationStatus.RESOLVED, resolvedAt: new Date() },
    });

    await writeAuditLog(
      {
        actorUserId: params.adminUserId,
        action: AuditActions.FUNDING_CONFIRMATION,
        entityType: "infrastructure_order",
        entityId: order.id,
        afterData: {
          attempt: nextAttempt,
          fundedAmountRial: fundedAmountRial.toString(),
          receiptReference,
          note,
        },
        ip: params.ip,
        userAgent: params.userAgent,
        idempotencyKey: `audit:funding:${confirmationKey}`,
      },
      tx,
    );

    const updatedOrder = await tx.infrastructureOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { fundingConfirmations: { orderBy: { attempt: "desc" } } },
    });

    return { order: updatedOrder, fundingConfirmation, job };
  });
}

export function parseFundedAmountToman(value: unknown): number {
  return assertPositiveIntegerToman(value);
}
