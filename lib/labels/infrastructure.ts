import type {
  CloudInstanceStatus,
  DeliveryMode,
  InfrastructureOrderStatus,
  ProvisioningJobStatus,
  ServiceOrderStatus,
} from "@prisma/client";

export const serviceOrderStatusLabel: Record<ServiceOrderStatus, string> = {
  DRAFT: "پیش‌نویس",
  ACTIVATION_REQUESTED: "درخواست فعال‌سازی",
  PENDING_PAYMENT: "در انتظار پرداخت",
  PAID: "پرداخت‌شده",
  CANCELED: "لغو شده",
  REFUNDED: "بازگشت وجه",
};

export const infrastructureOrderStatusLabel: Record<InfrastructureOrderStatus, string> = {
  WAITING_ADMIN_FUNDING: "در حال ساخت سرور",
  FUNDING_CONFIRMED: "در حال ساخت سرور",
  QUEUED: "در حال ساخت سرور",
  PROVISIONING: "در حال ساخت سرور",
  ACTIVE: "فعال",
  BLOCKED_PROVIDER_BALANCE: "در حال بررسی توسط پشتیبانی",
  NEEDS_RECONCILIATION: "در حال بررسی توسط پشتیبانی",
  MANUAL_REVIEW: "در حال بررسی توسط پشتیبانی",
  FAILED: "ناموفق",
  CANCELED: "لغو شده",
  REFUNDED: "بازگشت وجه",
};

export const infrastructureOrderCustomerMessage: Record<InfrastructureOrderStatus, string> = {
  WAITING_ADMIN_FUNDING: "پرداخت انجام شد؛ سرور شما در حال ساخت است.",
  FUNDING_CONFIRMED: "سرور شما در حال ساخت است.",
  QUEUED: "سرور شما در صف ساخت قرار گرفت.",
  PROVISIONING: "سرور شما در حال ساخت است.",
  ACTIVE: "سرور آماده استفاده است.",
  BLOCKED_PROVIDER_BALANCE: "ساخت سرور نیاز به بررسی پشتیبانی دارد.",
  NEEDS_RECONCILIATION: "سفارش شما در حال بررسی توسط پشتیبانی است.",
  MANUAL_REVIEW: "سرور ثبت شده و پشتیبانی در حال تکمیل تحویل است.",
  FAILED: "ساخت با مشکل مواجه شده و پشتیبانی در حال بررسی است.",
  CANCELED: "سفارش لغو شده است.",
  REFUNDED: "مبلغ سفارش به کیف پول شما بازگشت داده شد.",
};

export const provisioningJobStatusLabel: Record<ProvisioningJobStatus, string> = {
  QUEUED: "در صف",
  RUNNING: "در حال اجرا",
  SUCCEEDED: "موفق",
  FAILED: "ناموفق",
  BLOCKED_PROVIDER_BALANCE: "مسدود — نیاز به بررسی پشتیبانی",
  NEEDS_RECONCILIATION: "نیاز به بررسی پشتیبانی",
};

export const cloudInstanceStatusLabel: Record<CloudInstanceStatus, string> = {
  PENDING: "در حال ساخت",
  ACTIVE: "فعال",
  FAILED: "ناموفق",
  TERMINATED: "خاتمه‌یافته",
};

export const deliveryModeLabel: Record<DeliveryMode, string> = {
  RAW: "خام",
  MANAGED: "مدیریت‌شده",
};

export function getInfrastructureStage(status: InfrastructureOrderStatus): string {
  return infrastructureOrderCustomerMessage[status] ?? infrastructureOrderStatusLabel[status];
}
