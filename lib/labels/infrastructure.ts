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
  WAITING_ADMIN_FUNDING: "منتظر تأیید ساخت",
  FUNDING_CONFIRMED: "تأیید ساخت ثبت شد",
  QUEUED: "در صف آماده‌سازی",
  PROVISIONING: "در حال آماده‌سازی",
  ACTIVE: "فعال",
  BLOCKED_PROVIDER_BALANCE: "نیاز به بررسی تأمین",
  NEEDS_RECONCILIATION: "نیاز به بررسی",
  MANUAL_REVIEW: "بررسی دستی سلامت",
  FAILED: "ناموفق",
  CANCELED: "لغو شده",
  REFUNDED: "بازگشت وجه",
};

export const infrastructureOrderCustomerMessage: Record<InfrastructureOrderStatus, string> = {
  WAITING_ADMIN_FUNDING: "پرداخت شما انجام شد و سفارش منتظر تأیید ساخت است.",
  FUNDING_CONFIRMED: "تأیید ساخت ثبت شد و آماده‌سازی کنترل‌شده ادامه می‌یابد.",
  QUEUED: "سفارش برای آماده‌سازی در صف قرار گرفت.",
  PROVISIONING: "سرور شما در حال آماده‌سازی است.",
  ACTIVE: "سرور آماده استفاده است.",
  BLOCKED_PROVIDER_BALANCE: "تأمین زیرساخت نیاز به بررسی دارد و تیم پشتیبانی در حال پیگیری است.",
  NEEDS_RECONCILIATION: "سفارش شما در حال بررسی توسط پشتیبانی است.",
  MANUAL_REVIEW:
    "سرور ساخته شده و پشتیبانی در حال تطبیق Provider یا اجرای بررسی سلامت پس از اصلاح است.",
  FAILED: "آماده‌سازی با مشکل مواجه شده و توسط پشتیبانی در حال بررسی است.",
  CANCELED: "سفارش لغو شده است.",
  REFUNDED: "مبلغ سفارش به کیف پول شما بازگشت داده شد.",
};

export const provisioningJobStatusLabel: Record<ProvisioningJobStatus, string> = {
  QUEUED: "در صف",
  RUNNING: "در حال اجرا",
  SUCCEEDED: "موفق",
  FAILED: "ناموفق",
  BLOCKED_PROVIDER_BALANCE: "مسدود — اعتبار تأمین‌کننده",
  NEEDS_RECONCILIATION: "نیاز به تطبیق",
};

export const cloudInstanceStatusLabel: Record<CloudInstanceStatus, string> = {
  PENDING: "در حال آماده‌سازی",
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
