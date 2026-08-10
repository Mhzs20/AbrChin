import { TERM_DISCOUNT_BPS } from "@/lib/pricing/commercial-engine";

/** Customer-facing access method labels (never raw enums). */
export function accessMethodLabel(value: string | null | undefined): string {
  switch (value) {
    case "ONE_TIME_PASSWORD":
      return "رمز عبور امن";
    case "SSH_KEY":
      return "کلید SSH";
    case "WINDOWS_PASSWORD":
      return "رمز عبور ویندوز";
    default:
      return value?.trim() ? value : "—";
  }
}

/** Fixed term discount ceiling copy — margin floor may reduce actual discount. */
export function termDiscountCeilingLabel(
  termMonths: 1 | 3 | 6 | 12,
): string | null {
  const bps = TERM_DISCOUNT_BPS[termMonths];
  if (!bps) return null;
  return `تا ${Math.round(bps / 100).toLocaleString("fa-IR")}٪ تخفیف`;
}

/** Effective applied discount when snapshot bps is known. */
export function effectiveTermDiscountLabel(termDiscountBps: number): string | null {
  if (!Number.isFinite(termDiscountBps) || termDiscountBps <= 0) return null;
  return `${Math.round(termDiscountBps / 100).toLocaleString("fa-IR")}٪ تخفیف اعمال‌شده`;
}

export function customerBillingModelLabel(
  billingModel: string | null | undefined,
): string {
  if (billingModel === "PAYG_WALLET") {
    return "شارژ کیف پول (سرویس قدیمی)";
  }
  return "دوره‌ای پیش‌پرداخت";
}

export function supportPriorityFromParchin(
  level: string | null | undefined,
): "NORMAL" | "HIGH" | "URGENT" {
  if (level === "PARCHIN_STABLE") return "URGENT";
  if (level === "PARCHIN_ACTIVE") return "HIGH";
  return "NORMAL";
}

export const SUPPORT_CATEGORY_LABELS: Record<string, string> = {
  DELIVERY: "تحویل و راه‌اندازی",
  ACCESS: "دسترسی و ورود",
  BILLING: "پرداخت و کیف پول",
  RENEWAL: "تمدید",
  CHANGE: "تغییر منابع / حذف",
  OTHER: "سایر",
};

export const SUPPORT_KIND_LABELS: Record<string, string> = {
  GENERAL: "پشتیبانی عمومی",
  ROUTINE: "درخواست عملیاتی روتین",
  P1_INCIDENT: "رخداد بحرانی P1",
};

export const SUPPORT_STATUS_LABELS: Record<string, string> = {
  OPEN: "باز",
  IN_PROGRESS: "در حال رسیدگی",
  RESOLVED: "حل‌شده",
  CLOSED: "بسته‌شده",
};

export const SUPPORT_PRIORITY_LABELS: Record<string, string> = {
  NORMAL: "عادی",
  HIGH: "بالا",
  URGENT: "فوری",
};
