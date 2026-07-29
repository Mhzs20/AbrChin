import type { LedgerDirection, LedgerStatus, LedgerType } from "@prisma/client";

export const ledgerTypeLabel: Record<LedgerType, string> = {
  TOP_UP: "شارژ کیف پول",
  SERVICE_PURCHASE: "خرید سرویس",
  SERVICE_RENEWAL: "تمدید سرویس",
  REFUND: "بازگشت وجه",
  ADMIN_ADJUSTMENT: "تعدیل مدیر",
};

export const ledgerDirectionLabel: Record<LedgerDirection, string> = {
  CREDIT: "واریز",
  DEBIT: "برداشت",
};

export const ledgerStatusLabel: Record<LedgerStatus, string> = {
  PENDING: "در انتظار",
  COMPLETED: "تکمیل‌شده",
  REVERSED: "برگشت‌خورده",
  FAILED: "ناموفق",
};
