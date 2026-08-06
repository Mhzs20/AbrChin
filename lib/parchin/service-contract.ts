import type { ParchinLevel, Prisma } from "@prisma/client";

/**
 * Production-grade Parchin service contract (versioned).
 * Admin edits bump `version` and never rewrite Quote/Order snapshots.
 */

export type ParchinServiceLimits = {
  /** One standard initial setup — not unlimited ops. */
  setupScope: string;
  /** Customer software install is out of scope unless Compass add-on. */
  customSoftware: "excluded";
  continuousMonitoring: "excluded" | "add_on";
  scheduledBackup: "excluded" | "add_on";
  migration: "excluded" | "compass_coordination" | "add_on";
  osManagement: "excluded" | "initial_only";
  patchManagement: "excluded" | "add_on";
  applicationMaintenance: "excluded" | "add_on";
};

export type ParchinServiceContract = {
  level: ParchinLevel;
  version: number;
  title: string;
  subtitle: string;
  description: string;
  monthlyPriceRial: string;
  includedServices: string[];
  excludedServices: string[];
  serviceLimits: ParchinServiceLimits;
  supportWindow: string;
  firstResponseTarget: string;
  active: boolean;
  effectiveFrom: string;
};

export const PARCHIN_SHARED_SERVICES = [
  "ساخت سرور پس از تأیید ظرفیت",
  "نصب سیستم‌عامل انتخابی",
  "فعال‌شدن IP و تست دسترسی اولیه",
  "تحویل امن و رمزنگاری‌شده اطلاعات ورود",
  "نمایش یک‌بارمصرف رمز یا اتصال SSH Key",
  "نمایش وضعیت سفارش، ساخت، تحویل و تمدید",
  "ثبت رخدادهای حساس تحویل",
  "تحویل فوری در صورت موجودبودن ظرفیت",
] as const;

const START_INCLUDED = [
  ...PARCHIN_SHARED_SERVICES,
  "بررسی اولیه SSH یا RDP",
  "بررسی تطابق سیستم‌عامل و مشخصات سفارش",
  "راهنمای ورود اولیه",
  "یک درخواست پشتیبانی مرتبط با تحویل",
  "پاسخ‌گویی در ساعات اداری",
] as const;

const START_EXCLUDED = [
  "نصب نرم‌افزار اختصاصی مشتری",
  "مانیتورینگ مستمر",
  "بکاپ زمان‌بندی‌شده",
  "مهاجرت",
  "مدیریت سیستم‌عامل",
] as const;

const ACTIVE_INCLUDED = [
  ...START_INCLUDED,
  "به‌روزرسانی اولیه Packageهای سیستم‌عامل",
  "تنظیم اولیه Firewall",
  "تنظیم کاربر مدیریتی و دسترسی امن",
  "تنظیم Timezone و NTP",
  "نصب یک Stack استاندارد انتخابی مانند Docker یا Nginx",
  "بررسی سلامت اولیه پس از راه‌اندازی",
  "اولویت بالاتر در صف پشتیبانی",
] as const;

const ACTIVE_EXCLUDED = [
  "عملیات نامحدود پس از Setup اولیه",
  "مانیتورینگ ۲۴/۷",
  "بکاپ مدیریت‌شده",
  "Patch Management مستمر",
  "نگهداری Application",
  "مهاجرت واقعی (Add-on / قطب‌نما)",
] as const;

const STABLE_INCLUDED = [
  ...ACTIVE_INCLUDED,
  "چک‌لیست معماری پیش از راه‌اندازی",
  "بررسی شبکه، Firewall و دسترسی‌ها",
  "پیشنهاد Backup و Restore",
  "هماهنگی مهاجرت با قطب‌نما",
  "بررسی نهایی پس از تغییر یا مهاجرت",
  "بالاترین اولویت پشتیبانی",
  "مسیر مستقیم تمدید، ارتقا و تغییر منابع",
] as const;

const STABLE_EXCLUDED = [
  "مهاجرت واقعی به‌عنوان خدمت مستقل (قطب‌نما / Add-on)",
  "مانیتورینگ ۲۴/۷",
  "بکاپ مدیریت‌شده زمان‌بندی‌شده",
  "Patch Management مستمر",
  "نگهداری Application",
] as const;

const START_LIMITS: ParchinServiceLimits = {
  setupScope: "تحویل امن و بررسی اولیه دسترسی",
  customSoftware: "excluded",
  continuousMonitoring: "excluded",
  scheduledBackup: "excluded",
  migration: "excluded",
  osManagement: "excluded",
  patchManagement: "excluded",
  applicationMaintenance: "excluded",
};

const ACTIVE_LIMITS: ParchinServiceLimits = {
  setupScope: "یک Setup استاندارد اولیه، نه عملیات نامحدود",
  customSoftware: "excluded",
  continuousMonitoring: "excluded",
  scheduledBackup: "excluded",
  migration: "excluded",
  osManagement: "initial_only",
  patchManagement: "excluded",
  applicationMaintenance: "excluded",
};

const STABLE_LIMITS: ParchinServiceLimits = {
  setupScope: "آماده‌سازی پایداری + هماهنگی قطب‌نما؛ مهاجرت واقعی Add-on است",
  customSoftware: "excluded",
  continuousMonitoring: "add_on",
  scheduledBackup: "add_on",
  migration: "compass_coordination",
  osManagement: "initial_only",
  patchManagement: "add_on",
  applicationMaintenance: "add_on",
};

export const DEFAULT_PARCHIN_SERVICE_CONTRACTS: Record<
  ParchinLevel,
  Omit<ParchinServiceContract, "monthlyPriceRial" | "active" | "effectiveFrom">
> = {
  PARCHIN_START: {
    level: "PARCHIN_START",
    version: 1,
    title: "پرچین شروع",
    subtitle: "تحویل امن",
    description:
      "تحویل کنترل‌شده سرور با بررسی دسترسی اولیه و پشتیبانی راه‌اندازی در ساعات اداری.",
    includedServices: [...START_INCLUDED],
    excludedServices: [...START_EXCLUDED],
    serviceLimits: START_LIMITS,
    supportWindow: "ساعات اداری",
    firstResponseTarget: "در ساعات اداری در همان روز کاری",
  },
  PARCHIN_ACTIVE: {
    level: "PARCHIN_ACTIVE",
    version: 1,
    title: "پرچین فعال",
    subtitle: "راه‌اندازی همراه",
    description:
      "خدمات پرچین شروع به‌همراه یک Setup استاندارد اولیه (Firewall، کاربر امن، Stack انتخابی) و اولویت بالاتر پشتیبانی.",
    includedServices: [...ACTIVE_INCLUDED],
    excludedServices: [...ACTIVE_EXCLUDED],
    serviceLimits: ACTIVE_LIMITS,
    supportWindow: "ساعات اداری با اولویت بالاتر",
    firstResponseTarget: "اولویت بالاتر در صف پشتیبانی همان روز کاری",
  },
  PARCHIN_STABLE: {
    level: "PARCHIN_STABLE",
    version: 1,
    title: "پرچین پایدار",
    subtitle: "آماده‌سازی پایداری",
    description:
      "خدمات پرچین فعال به‌همراه چک‌لیست معماری، پیشنهاد Backup، هماهنگی مهاجرت با قطب‌نما و مسیر مستقیم تمدید و ارتقا.",
    includedServices: [...STABLE_INCLUDED],
    excludedServices: [...STABLE_EXCLUDED],
    serviceLimits: STABLE_LIMITS,
    supportWindow: "ساعات اداری با بالاترین اولویت",
    firstResponseTarget: "بالاترین اولویت در صف پشتیبانی",
  },
};

export function defaultParchinContractForLevel(
  level: ParchinLevel,
  options?: {
    monthlyPriceRial?: bigint | string;
    active?: boolean;
    effectiveFrom?: Date | string;
    version?: number;
  },
): ParchinServiceContract {
  const base = DEFAULT_PARCHIN_SERVICE_CONTRACTS[level];
  const effectiveFrom =
    options?.effectiveFrom instanceof Date
      ? options.effectiveFrom.toISOString()
      : (options?.effectiveFrom ?? new Date(0).toISOString());
  return {
    ...base,
    version: options?.version ?? base.version,
    monthlyPriceRial:
      options?.monthlyPriceRial == null
        ? "0"
        : typeof options.monthlyPriceRial === "bigint"
          ? options.monthlyPriceRial.toString()
          : options.monthlyPriceRial,
    active: options?.active ?? true,
    effectiveFrom,
  };
}

export function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseServiceLimits(value: unknown): ParchinServiceLimits {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return START_LIMITS;
  }
  const raw = value as Record<string, unknown>;
  return {
    setupScope:
      typeof raw.setupScope === "string" && raw.setupScope.trim()
        ? raw.setupScope.trim()
        : START_LIMITS.setupScope,
    customSoftware: "excluded",
    continuousMonitoring:
      raw.continuousMonitoring === "add_on" ? "add_on" : "excluded",
    scheduledBackup: raw.scheduledBackup === "add_on" ? "add_on" : "excluded",
    migration:
      raw.migration === "compass_coordination"
        ? "compass_coordination"
        : raw.migration === "add_on"
          ? "add_on"
          : "excluded",
    osManagement: raw.osManagement === "initial_only" ? "initial_only" : "excluded",
    patchManagement: raw.patchManagement === "add_on" ? "add_on" : "excluded",
    applicationMaintenance:
      raw.applicationMaintenance === "add_on" ? "add_on" : "excluded",
  };
}

export function toParchinServiceContract(row: {
  level: ParchinLevel;
  version?: number | null;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  priceRial: bigint;
  includedServices?: unknown;
  excludedServices?: unknown;
  serviceLimits?: unknown;
  supportWindow?: string | null;
  firstResponseTarget?: string | null;
  active: boolean;
  effectiveFrom?: Date | null;
}): ParchinServiceContract {
  const defaults = DEFAULT_PARCHIN_SERVICE_CONTRACTS[row.level];
  const included = parseStringList(row.includedServices);
  const excluded = parseStringList(row.excludedServices);
  return {
    level: row.level,
    version: row.version && row.version > 0 ? row.version : defaults.version,
    title: row.title.trim() || defaults.title,
    subtitle: (row.subtitle ?? "").trim() || defaults.subtitle,
    description: (row.description ?? "").trim() || defaults.description,
    monthlyPriceRial: row.priceRial.toString(),
    includedServices: included.length > 0 ? included : defaults.includedServices,
    excludedServices: excluded.length > 0 ? excluded : defaults.excludedServices,
    serviceLimits: row.serviceLimits
      ? parseServiceLimits(row.serviceLimits)
      : defaults.serviceLimits,
    supportWindow:
      (row.supportWindow ?? "").trim() || defaults.supportWindow,
    firstResponseTarget:
      (row.firstResponseTarget ?? "").trim() || defaults.firstResponseTarget,
    active: row.active,
    effectiveFrom: (row.effectiveFrom ?? new Date(0)).toISOString(),
  };
}

/** Immutable snapshot stored on Quote / Order. */
export function snapshotParchinServiceContract(
  contract: ParchinServiceContract,
): Prisma.InputJsonValue {
  return {
    level: contract.level,
    version: contract.version,
    title: contract.title,
    subtitle: contract.subtitle,
    description: contract.description,
    monthlyPriceRial: contract.monthlyPriceRial,
    includedServices: contract.includedServices,
    excludedServices: contract.excludedServices,
    serviceLimits: contract.serviceLimits,
    supportWindow: contract.supportWindow,
    firstResponseTarget: contract.firstResponseTarget,
    active: contract.active,
    effectiveFrom: contract.effectiveFrom,
    snapshottedAt: new Date().toISOString(),
  };
}

export function readParchinServiceSnapshot(
  value: unknown,
): ParchinServiceContract | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    raw.level !== "PARCHIN_START" &&
    raw.level !== "PARCHIN_ACTIVE" &&
    raw.level !== "PARCHIN_STABLE"
  ) {
    return null;
  }
  const level = raw.level as ParchinLevel;
  const defaults = DEFAULT_PARCHIN_SERVICE_CONTRACTS[level];
  return {
    level,
    version:
      typeof raw.version === "number" && Number.isInteger(raw.version)
        ? raw.version
        : defaults.version,
    title:
      typeof raw.title === "string" && raw.title.trim()
        ? raw.title.trim()
        : defaults.title,
    subtitle:
      typeof raw.subtitle === "string" && raw.subtitle.trim()
        ? raw.subtitle.trim()
        : defaults.subtitle,
    description:
      typeof raw.description === "string" && raw.description.trim()
        ? raw.description.trim()
        : defaults.description,
    monthlyPriceRial:
      typeof raw.monthlyPriceRial === "string"
        ? raw.monthlyPriceRial
        : typeof raw.monthlyPriceRial === "number"
          ? String(raw.monthlyPriceRial)
          : "0",
    includedServices: parseStringList(raw.includedServices),
    excludedServices: parseStringList(raw.excludedServices),
    serviceLimits: parseServiceLimits(raw.serviceLimits),
    supportWindow:
      typeof raw.supportWindow === "string" && raw.supportWindow.trim()
        ? raw.supportWindow.trim()
        : defaults.supportWindow,
    firstResponseTarget:
      typeof raw.firstResponseTarget === "string" &&
      raw.firstResponseTarget.trim()
        ? raw.firstResponseTarget.trim()
        : defaults.firstResponseTarget,
    active: raw.active !== false,
    effectiveFrom:
      typeof raw.effectiveFrom === "string"
        ? raw.effectiveFrom
        : new Date(0).toISOString(),
  };
}

export function parchinLineItemLabel(contract: {
  title: string;
  version: number;
}): string {
  return `${contract.title} · نسخه ${contract.version.toLocaleString("fa-IR")}`;
}

export function oneLineParchinSummary(contract: {
  subtitle: string;
  description: string;
}): string {
  return contract.subtitle.trim() || contract.description.trim();
}
