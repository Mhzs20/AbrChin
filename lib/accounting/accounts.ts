/**
 * Chart of accounts for AbrChin operational accounting (phase-1 launch).
 * Codes are stable constants; Persian labels are for Admin UI only.
 */

export const ACCOUNT_CODES = [
  "CASH_GATEWAY",
  "PROVIDER_FUNDING_CLEARING",
  "CUSTOMER_WALLET_LIABILITY",
  "TAX_PAYABLE",
  "DEFERRED_REVENUE",
  "INFRASTRUCTURE_REVENUE",
  "PARCHIN_REVENUE",
  "ADDON_REVENUE",
  "TERM_DISCOUNT",
  "COUPON_DISCOUNT",
  "SALES_REFUND",
  "PROVIDER_INFRASTRUCTURE_COGS",
  "PROVIDER_ADDON_COGS",
  "GATEWAY_FEES",
  "SMS_EXPENSE",
  "SUPPORT_OPERATIONS",
  "HOSTING_OPERATIONS",
  "MARKETING_EXPENSE",
  "PAYROLL_CONTRACTOR",
  "OTHER_OPERATING_EXPENSE",
] as const;

export type AccountCode = (typeof ACCOUNT_CODES)[number];

export type AccountClass =
  | "asset"
  | "liability"
  | "revenue"
  | "contra_revenue"
  | "cogs"
  | "opex";

export type AccountDefinition = {
  code: AccountCode;
  labelFa: string;
  accountClass: AccountClass;
};

export const ACCOUNT_DEFINITIONS: Record<AccountCode, AccountDefinition> = {
  CASH_GATEWAY: {
    code: "CASH_GATEWAY",
    labelFa: "نقد درگاه پرداخت",
    accountClass: "asset",
  },
  PROVIDER_FUNDING_CLEARING: {
    code: "PROVIDER_FUNDING_CLEARING",
    labelFa: "تسویه تأمین ارائه‌دهنده",
    accountClass: "asset",
  },
  CUSTOMER_WALLET_LIABILITY: {
    code: "CUSTOMER_WALLET_LIABILITY",
    labelFa: "بدهی کیف پول مشتری",
    accountClass: "liability",
  },
  TAX_PAYABLE: {
    code: "TAX_PAYABLE",
    labelFa: "مالیات پرداختنی",
    accountClass: "liability",
  },
  DEFERRED_REVENUE: {
    code: "DEFERRED_REVENUE",
    labelFa: "درآمد معوق",
    accountClass: "liability",
  },
  INFRASTRUCTURE_REVENUE: {
    code: "INFRASTRUCTURE_REVENUE",
    labelFa: "درآمد زیرساخت",
    accountClass: "revenue",
  },
  PARCHIN_REVENUE: {
    code: "PARCHIN_REVENUE",
    labelFa: "درآمد پرچین",
    accountClass: "revenue",
  },
  ADDON_REVENUE: {
    code: "ADDON_REVENUE",
    labelFa: "درآمد افزونه",
    accountClass: "revenue",
  },
  TERM_DISCOUNT: {
    code: "TERM_DISCOUNT",
    labelFa: "تخفیف دوره",
    accountClass: "contra_revenue",
  },
  COUPON_DISCOUNT: {
    code: "COUPON_DISCOUNT",
    labelFa: "تخفیف کد",
    accountClass: "contra_revenue",
  },
  SALES_REFUND: {
    code: "SALES_REFUND",
    labelFa: "بازگشت فروش",
    accountClass: "contra_revenue",
  },
  PROVIDER_INFRASTRUCTURE_COGS: {
    code: "PROVIDER_INFRASTRUCTURE_COGS",
    labelFa: "بهای تمام‌شده زیرساخت ارائه‌دهنده",
    accountClass: "cogs",
  },
  PROVIDER_ADDON_COGS: {
    code: "PROVIDER_ADDON_COGS",
    labelFa: "بهای تمام‌شده افزونه ارائه‌دهنده",
    accountClass: "cogs",
  },
  GATEWAY_FEES: {
    code: "GATEWAY_FEES",
    labelFa: "کارمزد درگاه",
    accountClass: "opex",
  },
  SMS_EXPENSE: {
    code: "SMS_EXPENSE",
    labelFa: "هزینه پیامک",
    accountClass: "opex",
  },
  SUPPORT_OPERATIONS: {
    code: "SUPPORT_OPERATIONS",
    labelFa: "عملیات پشتیبانی",
    accountClass: "opex",
  },
  HOSTING_OPERATIONS: {
    code: "HOSTING_OPERATIONS",
    labelFa: "عملیات میزبانی",
    accountClass: "opex",
  },
  MARKETING_EXPENSE: {
    code: "MARKETING_EXPENSE",
    labelFa: "هزینه بازاریابی",
    accountClass: "opex",
  },
  PAYROLL_CONTRACTOR: {
    code: "PAYROLL_CONTRACTOR",
    labelFa: "حقوق و پیمانکار",
    accountClass: "opex",
  },
  OTHER_OPERATING_EXPENSE: {
    code: "OTHER_OPERATING_EXPENSE",
    labelFa: "سایر هزینه‌های عملیاتی",
    accountClass: "opex",
  },
};

export function isAccountCode(value: string): value is AccountCode {
  return (ACCOUNT_CODES as readonly string[]).includes(value);
}

export function assertAccountCode(value: string): AccountCode {
  if (!isAccountCode(value)) {
    throw new Error(`unknown_account_code:${value}`);
  }
  return value;
}

/** Opex accounts that may be used for manual OperatingExpense categories. */
export const MANUAL_OPEX_ACCOUNT_CODES = [
  "GATEWAY_FEES",
  "SMS_EXPENSE",
  "SUPPORT_OPERATIONS",
  "HOSTING_OPERATIONS",
  "MARKETING_EXPENSE",
  "PAYROLL_CONTRACTOR",
  "OTHER_OPERATING_EXPENSE",
] as const satisfies readonly AccountCode[];

export type ManualOpexAccountCode = (typeof MANUAL_OPEX_ACCOUNT_CODES)[number];

/** Automatic provider COGS — never selectable as manual expense category. */
export const AUTOMATIC_PROVIDER_COGS_CODES = [
  "PROVIDER_INFRASTRUCTURE_COGS",
  "PROVIDER_ADDON_COGS",
] as const satisfies readonly AccountCode[];
