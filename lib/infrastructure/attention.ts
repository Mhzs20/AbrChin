import type { InfrastructureRecoveryAction } from "@/lib/infrastructure/resource-disposition";

type Attempt = {
  operation: string;
  attempt: number;
  status: string;
  lastErrorCode: string | null;
  updatedAt: Date;
};

const actionLabels: Record<InfrastructureRecoveryAction, string> = {
  reconcile: "تطبیق فقط‌خواندنی با Provider",
  retry: "Retry کنترل‌شده",
  "health-retry": "Retry بررسی سلامت",
  "health-observe": "مشاهدهٔ Provider",
  "health-recovery": "Recovery دستی سلامت",
  refund: "لغو و بازگشت به کیف پول داخلی",
  "confirm-no-resource": "تأیید نبود Resource",
};

const errorDetails: Record<string, { title: string; detail: string }> = {
  provider_auth_failed: {
    title: "دسترسی Provider نیاز به بررسی دارد",
    detail: "اعتبار اتصال Provider را از صفحهٔ اتصال سرویس‌ها بررسی کنید.",
  },
  provider_insufficient_balance: {
    title: "موجودی Provider کافی نیست",
    detail: "پس از بررسی یا شارژ دستی Provider، Retry کنترل‌شده را اجرا کنید.",
  },
  provider_timeout: {
    title: "پاسخ Provider به‌موقع نرسید",
    detail: "پیش از هر ساخت مجدد، تطبیق Resource یا تأیید نبود آن لازم است.",
  },
  provider_ambiguous: {
    title: "نتیجهٔ ساخت Provider مبهم است",
    detail: "ابتدا فقط‌خواندنی با Provider تطبیق دهید؛ ساخت مجدد مسدود است.",
  },
  provider_lock_incomplete: {
    title: "Snapshot پرداخت‌شده ناقص یا ناسازگار است",
    detail: "این سفارش باید دستی بررسی یا در صورت امن‌بودن بازپرداخت شود.",
  },
  health_check_failed: {
    title: "بررسی سلامت ناموفق بود",
    detail: "Provider و شبکه را مشاهده کنید یا Retry سلامت را اجرا کنید.",
  },
  credential_not_ready: {
    title: "Credential برای تحویل آماده نیست",
    detail: "Credential را فقط در محدودهٔ Admin ثبت و دوباره بررسی کنید.",
  },
};

function fromState(input: {
  status: string;
  productFlowState: string | null;
  hasResource: boolean;
}) {
  if (input.status === "BLOCKED_PROVIDER_BALANCE") {
    return errorDetails.provider_insufficient_balance;
  }
  if (
    input.status === "NEEDS_RECONCILIATION" ||
    input.productFlowState === "PROVISIONING_RECONCILING"
  ) {
    return errorDetails.provider_ambiguous;
  }
  if (input.productFlowState === "HEALTH_CHECK_FAILED") {
    return errorDetails.health_check_failed;
  }
  if (
    input.productFlowState === "DELIVERY_RETRYABLE" ||
    (input.productFlowState === "PROVISIONING_MANUAL_REVIEW" &&
      input.hasResource)
  ) {
    return {
      title: "Resource یا تحویل نیاز به بررسی دستی دارد",
      detail: "Resource، Health و Credential را در پنل Admin بررسی کنید؛ مشتری همچنان در حال آماده‌سازی می‌بیند.",
    };
  }
  if (input.productFlowState === "PROVISIONING_RETRYABLE") {
    return {
      title: "Provision ناموفق بود",
      detail: "Retry فقط پس از کنترل ایمنی Resource و در صورت لزوم Reconcile مجاز است.",
    };
  }
  return {
    title: "سفارش نیاز به بررسی دارد",
    detail: "یک اقدام کنترل‌شده را از همین صف انتخاب کنید.",
  };
}

/** Builds a customer-safe, operation-ready explanation without surfacing raw
 * Provider errors or secrets. It is derived from durable order/job state. */
export function getInfrastructureAttention(input: {
  status: string;
  productFlowState: string | null;
  updatedAt: Date;
  hasResource: boolean;
  attempts: Attempt[];
  allowedActions: InfrastructureRecoveryAction[];
}) {
  const isAttention = [
    "BLOCKED_PROVIDER_BALANCE",
    "NEEDS_RECONCILIATION",
    "MANUAL_REVIEW",
    "FAILED",
  ].includes(input.status) || [
    "PROVISIONING_RETRYABLE",
    "PROVISIONING_RECONCILING",
    "PROVISIONING_MANUAL_REVIEW",
    "HEALTH_CHECK_FAILED",
    "DELIVERY_RETRYABLE",
  ].includes(input.productFlowState ?? "");
  if (!isAttention) return null;

  const lastAttempt = [...input.attempts].sort(
    (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
  )[0] ?? null;
  const known = lastAttempt?.lastErrorCode
    ? errorDetails[lastAttempt.lastErrorCode]
    : null;
  const fallback = fromState(input);
  return {
    code: lastAttempt?.lastErrorCode ?? input.productFlowState ?? input.status,
    title: known?.title ?? fallback.title,
    detail: known?.detail ?? fallback.detail,
    occurredAt: (lastAttempt?.updatedAt ?? input.updatedAt).toISOString(),
    lastAttempt: lastAttempt
      ? {
          operation: lastAttempt.operation,
          attempt: lastAttempt.attempt,
          status: lastAttempt.status,
        }
      : null,
    nextActions: input.allowedActions.map((action) => actionLabels[action]),
  };
}
