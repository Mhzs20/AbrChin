import { prisma } from "@/lib/db";

export type LegacyAdminOperationQueue =
  | "provision"
  | "delivery"
  | "attention"
  | null;

export function classifyAdminOperationQueue(input: {
  status: string;
  productFlowState: string | null;
}): LegacyAdminOperationQueue {
  if (
    [
      "BLOCKED_PROVIDER_BALANCE",
      "NEEDS_RECONCILIATION",
      "MANUAL_REVIEW",
      "FAILED",
    ].includes(input.status) ||
    [
      "PROVISIONING_RETRYABLE",
      "PROVISIONING_RECONCILING",
      "PROVISIONING_MANUAL_REVIEW",
      "HEALTH_CHECK_FAILED",
      "DELIVERY_RETRYABLE",
    ].includes(input.productFlowState ?? "")
  ) {
    return "attention";
  }
  if (input.status === "WAITING_ADMIN_FUNDING") {
    return "provision";
  }
  if (
    input.productFlowState === "WAITING_ADMIN_DELIVERY_APPROVAL" &&
    input.status !== "ACTIVE"
  ) {
    return "delivery";
  }
  return null;
}

export type AdminOperationsQueueKey =
  | "walletPaymentReview"
  | "walletCreditReconciliation"
  | "activationApproval"
  | "provisionRecovery"
  | "resourceChangeApproval"
  | "deliveryApproval"
  | "lowBalance"
  | "unpaidInvoice"
  | "suspensionReview"
  | "providerBillingReconciliation"
  | "controlledRefund"
  | "connectionFailure";

export type AdminOperationsActionKind =
  | "link"
  | "approve_activation"
  | "approve_resource_change"
  | "approve_suspension"
  | "review_reconciliation";

export type AdminOperationsQueueItem = {
  id: string;
  reference: string;
  summary: string;
  updatedAt: string;
  action: {
    kind: AdminOperationsActionKind;
    label: string;
    href?: string;
  };
};

export type AdminOperationsQueue = {
  key: AdminOperationsQueueKey;
  title: string;
  description: string;
  items: AdminOperationsQueueItem[];
};

const definitions: Record<
  AdminOperationsQueueKey,
  Pick<AdminOperationsQueue, "title" | "description">
> = {
  walletPaymentReview: {
    title: "بازبینی پرداخت شارژ Wallet",
    description: "Callback یا Verify نیازمند تصمیم اپراتور است.",
  },
  walletCreditReconciliation: {
    title: "تطبیق Credit کیف پول",
    description: "پرداخت تأیید شده و Credit/Ledger باید بازیابی شود.",
  },
  activationApproval: {
    title: "درخواست فعال‌سازی منتظر تأیید اول",
    description: "اعتبار و Estimate آماده است؛ هنوز Provider Mutation اجرا نشده است.",
  },
  provisionRecovery: {
    title: "Retry / Reconcile ساخت",
    description: "Provisioning حفظ شده و نیازمند Retry یا Reconcile کنترل‌شده است.",
  },
  resourceChangeApproval: {
    title: "تغییر منابع منتظر تأیید",
    description: "Resize، Stop، Resume یا تغییر Plan هنوز اجازه Provider ندارد.",
  },
  deliveryApproval: {
    title: "تحویل منتظر تأیید دوم",
    description: "Resource آماده است اما Credential هنوز برای Customer قابل Reveal نیست.",
  },
  lowBalance: {
    title: "Low Balance",
    description: "Runway کم شده است؛ ابتدا اطلاع‌رسانی و بررسی انجام می‌شود.",
  },
  unpaidInvoice: {
    title: "صورتحساب پرداخت‌نشده یا ناقص",
    description: "مصرف کامل ثبت شده ولی Wallet همه مبلغ را پوشش نداده است.",
  },
  suspensionReview: {
    title: "بازبینی Suspension",
    description: "Grace پایان یافته؛ Suspend فقط با اقدام صریح Admin مجاز است.",
  },
  providerBillingReconciliation: {
    title: "تطبیق Billing Provider",
    description: "اختلاف Provider و Billing داخلی بدون تغییر خاموش Wallet بررسی می‌شود.",
  },
  controlledRefund: {
    title: "Refund کنترل‌شده",
    description: "بازگشت بانکی و Ledger فقط پس از Review و با Idempotency انجام می‌شود.",
  },
  connectionFailure: {
    title: "شکست Connection Check",
    description: "آخرین Probe معتبر سرویس ناموفق بوده است.",
  },
};

export async function listAdminOperationsQueues(): Promise<
  AdminOperationsQueue[]
> {
  const [
    paymentReviews,
    creditReconciliations,
    activations,
    provisionRecoveries,
    resourceChanges,
    deliveries,
    lowBalances,
    unpaidInvoices,
    suspensionReviews,
    billingReconciliations,
    refunds,
    connectionFailures,
  ] = await Promise.all([
    prisma.paymentRecoveryCase.findMany({
      where: { status: { in: ["OPEN", "REFUND_REVIEW"] } },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: {
        id: true,
        reasonCode: true,
        safeMessage: true,
        updatedAt: true,
        attemptId: true,
      },
    }),
    prisma.paymentRecoveryCase.findMany({
      where: { status: "RECONCILING" },
      orderBy: { updatedAt: "asc" },
      take: 50,
      select: {
        id: true,
        reasonCode: true,
        safeMessage: true,
        updatedAt: true,
        attemptId: true,
      },
    }),
    prisma.activationRequest.findMany({
      where: { status: "WAITING_ADMIN_APPROVAL" },
      orderBy: { requestedAt: "asc" },
      take: 50,
      select: {
        id: true,
        requestedAt: true,
        serviceOrderId: true,
        plan: { select: { title: true } },
      },
    }),
    prisma.infrastructureOrder.findMany({
      where: {
        OR: [
          {
            status: {
              in: [
                "BLOCKED_PROVIDER_BALANCE",
                "NEEDS_RECONCILIATION",
                "MANUAL_REVIEW",
                "FAILED",
              ],
            },
          },
          {
            productFlowState: {
              in: [
                "PROVISIONING_RETRYABLE",
                "PROVISIONING_RECONCILING",
                "PROVISIONING_MANUAL_REVIEW",
                "HEALTH_CHECK_FAILED",
                "DELIVERY_RETRYABLE",
              ],
            },
          },
        ],
      },
      orderBy: { updatedAt: "asc" },
      take: 50,
      select: {
        id: true,
        serviceOrderId: true,
        status: true,
        productFlowState: true,
        updatedAt: true,
        plan: { select: { title: true } },
      },
    }),
    prisma.resourceChangeRequest.findMany({
      where: { status: { in: ["REQUESTED", "WAITING_ADMIN_APPROVAL"] } },
      orderBy: { requestedAt: "asc" },
      take: 50,
      select: {
        id: true,
        status: true,
        requestedAt: true,
        plan: { select: { title: true } },
        cloudInstance: { select: { name: true } },
      },
    }),
    prisma.infrastructureOrder.findMany({
      where: {
        productFlowState: "WAITING_ADMIN_DELIVERY_APPROVAL",
        status: { notIn: ["ACTIVE", "CANCELED", "REFUNDED"] },
      },
      orderBy: { updatedAt: "asc" },
      take: 50,
      select: {
        id: true,
        serviceOrderId: true,
        updatedAt: true,
        plan: { select: { title: true } },
      },
    }),
    prisma.dunningCase.findMany({
      where: {
        type: "LOW_BALANCE",
        status: { in: ["OPEN", "NOTIFIED", "GRACE", "ADMIN_REVIEW"] },
      },
      orderBy: { updatedAt: "asc" },
      take: 50,
      select: {
        id: true,
        updatedAt: true,
        runwaySeconds: true,
        cloudInstance: { select: { name: true } },
      },
    }),
    prisma.billingInvoice.findMany({
      where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] } },
      orderBy: { periodEnd: "asc" },
      take: 50,
      select: {
        id: true,
        updatedAt: true,
        outstandingAmountRial: true,
        cloudInstance: { select: { name: true } },
      },
    }),
    prisma.dunningCase.findMany({
      where: { type: "SUSPENSION_REVIEW", status: "ADMIN_REVIEW" },
      orderBy: { updatedAt: "asc" },
      take: 50,
      select: {
        id: true,
        updatedAt: true,
        cloudInstance: { select: { name: true } },
      },
    }),
    prisma.billingReconciliation.findMany({
      where: { status: { in: ["PENDING", "MISMATCH", "REVIEW"] } },
      orderBy: { detectedAt: "asc" },
      take: 50,
      select: {
        id: true,
        provider: true,
        kind: true,
        status: true,
        reason: true,
        detectedAt: true,
      },
    }),
    prisma.walletTopUpRefund.findMany({
      where: { status: { in: ["REQUESTED", "REVIEW_REQUIRED", "APPROVED"] } },
      orderBy: { requestedAt: "asc" },
      take: 50,
      select: {
        id: true,
        status: true,
        amount: true,
        requestedAt: true,
        walletTopUpId: true,
      },
    }),
    prisma.serviceConnectionCheck.findMany({
      where: { status: "ERROR" },
      orderBy: { checkedAt: "asc" },
      select: {
        service: true,
        errorCode: true,
        message: true,
        checkedAt: true,
      },
    }),
  ]);

  const queue = (
    key: AdminOperationsQueueKey,
    items: AdminOperationsQueueItem[],
  ): AdminOperationsQueue => ({ key, ...definitions[key], items });
  const link = (href: string, label: string) => ({
    kind: "link" as const,
    href,
    label,
  });

  return [
    queue(
      "walletPaymentReview",
      paymentReviews.map((item) => ({
        id: item.id,
        reference: item.attemptId,
        summary: `${item.reasonCode} — ${item.safeMessage}`,
        updatedAt: item.updatedAt.toISOString(),
        action: link("/admin/payment-recovery", "بازبینی پرداخت"),
      })),
    ),
    queue(
      "walletCreditReconciliation",
      creditReconciliations.map((item) => ({
        id: item.id,
        reference: item.attemptId,
        summary: `${item.reasonCode} — ${item.safeMessage}`,
        updatedAt: item.updatedAt.toISOString(),
        action: link("/admin/payment-recovery", "تطبیق Credit"),
      })),
    ),
    queue(
      "activationApproval",
      activations.map((item) => ({
        id: item.id,
        reference: item.serviceOrderId,
        summary: item.plan.title,
        updatedAt: item.requestedAt.toISOString(),
        action: { kind: "approve_activation", label: "تأیید اول" },
      })),
    ),
    queue(
      "provisionRecovery",
      provisionRecoveries.map((item) => ({
        id: item.id,
        reference: item.serviceOrderId,
        summary: `${item.plan.title} — ${item.productFlowState ?? item.status}`,
        updatedAt: item.updatedAt.toISOString(),
        action: link("/admin/infrastructure/orders", "Retry / Reconcile"),
      })),
    ),
    queue(
      "resourceChangeApproval",
      resourceChanges.map((item) => ({
        id: item.id,
        reference: item.cloudInstance.name,
        summary: `${item.plan.title} — ${item.status}`,
        updatedAt: item.requestedAt.toISOString(),
        action: {
          kind: "approve_resource_change",
          label: "تأیید تغییر منابع",
        },
      })),
    ),
    queue(
      "deliveryApproval",
      deliveries.map((item) => ({
        id: item.id,
        reference: item.serviceOrderId,
        summary: item.plan.title,
        updatedAt: item.updatedAt.toISOString(),
        action: link("/admin/infrastructure/orders", "بازبینی و تأیید دوم"),
      })),
    ),
    queue(
      "lowBalance",
      lowBalances.map((item) => ({
        id: item.id,
        reference: item.cloudInstance.name,
        summary: `Runway: ${item.runwaySeconds?.toString() ?? "نامشخص"} ثانیه`,
        updatedAt: item.updatedAt.toISOString(),
        action: link("/admin/wallets", "بررسی Wallet"),
      })),
    ),
    queue(
      "unpaidInvoice",
      unpaidInvoices.map((item) => ({
        id: item.id,
        reference: item.cloudInstance.name,
        summary: `مانده: ${item.outstandingAmountRial.toString()} ریال`,
        updatedAt: item.updatedAt.toISOString(),
        action: link("/admin/wallets", "بررسی مانده"),
      })),
    ),
    queue(
      "suspensionReview",
      suspensionReviews.map((item) => ({
        id: item.id,
        reference: item.cloudInstance.name,
        summary: "تعلیق خودکار اجرا نشده است.",
        updatedAt: item.updatedAt.toISOString(),
        action: { kind: "approve_suspension", label: "تأیید Suspension" },
      })),
    ),
    queue(
      "providerBillingReconciliation",
      billingReconciliations.map((item) => ({
        id: item.id,
        reference: `${item.provider}/${item.kind}`,
        summary: item.reason ?? item.status,
        updatedAt: item.detectedAt.toISOString(),
        action: {
          kind: "review_reconciliation",
          label: "ورود به Review",
        },
      })),
    ),
    queue(
      "controlledRefund",
      refunds.map((item) => ({
        id: item.id,
        reference: item.walletTopUpId,
        summary: `${item.amount.toString()} ریال — ${item.status}`,
        updatedAt: item.requestedAt.toISOString(),
        action: link("/admin/payment-recovery", "بازبینی Refund"),
      })),
    ),
    queue(
      "connectionFailure",
      connectionFailures.map((item) => ({
        id: item.service,
        reference: item.service,
        summary: `${item.errorCode ?? "unknown"} — ${item.message ?? "ناموفق"}`,
        updatedAt: item.checkedAt.toISOString(),
        action: link("/admin/connections", "اجرای Connection Check"),
      })),
    ),
  ];
}
