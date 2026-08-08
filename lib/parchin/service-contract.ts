import type { ParchinLevel, Prisma } from "@prisma/client";

/**
 * Production-grade Parchin service contract (versioned).
 * Admin edits bump `version` and never rewrite Quote/Order snapshots.
 */

export type ParchinServiceLimits = {
  /** The operational promise shown to Customer and Admin. */
  setupScope: string;
  /** Customer software install is out of scope unless Compass add-on. */
  customSoftware: "excluded";
  continuousMonitoring: "excluded" | "add_on" | "included";
  scheduledBackup: "excluded" | "add_on" | "included";
  migration: "excluded" | "compass_coordination" | "add_on";
  osManagement: "excluded" | "initial_only" | "included";
  patchManagement: "excluded" | "add_on" | "included";
  applicationMaintenance: "excluded" | "add_on" | "included";
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
  "کنترل مشخصات سفارش پیش از ساخت",
  "نصب سیستم‌عامل و فعال‌سازی IP",
  "تحویل امن و رمزنگاری‌شده اطلاعات ورود",
  "پیگیری وضعیت ساخت، تحویل، تمدید و تغییرات در پنل",
  "یادآوری سررسید و ثبت رخدادهای عملیاتی",
] as const;

const START_INCLUDED = [
  ...PARCHIN_SHARED_SERVICES,
  "سخت‌سازی پایه دسترسی و Firewall در شروع",
  "به‌روزرسانی امنیتی سیستم‌عامل هنگام تحویل",
  "بازبینی ماهانه دسترسی و فشار CPU، RAM و Disk",
  "گزارش سلامت ماهانه با اقدام پیشنهادی",
  "یک درخواست عملیاتی روتین در هر ماه",
  "پاسخ اولیه حداکثر تا پایان روز کاری",
] as const;

const START_EXCLUDED = [
  "پایش خودکار شبانه‌روزی و مدیریت رخداد",
  "بکاپ مدیریت‌شده و آزمون Restore",
  "نگهداری کد و Application مشتری",
  "مهاجرت سایت یا داده",
] as const;

const ACTIVE_INCLUDED = [
  ...START_INCLUDED,
  "پایش Uptime پنج‌دقیقه‌ای با رسیدگی هشدار در ساعات کاری",
  "بکاپ روزانه مدیریت‌شده با نگهداری هفت نسخه",
  "بررسی ماهانه امکان بازیابی آخرین بکاپ",
  "اعمال Patch امنیتی سیستم‌عامل در پنجره نگهداری ماهانه",
  "دو درخواست عملیاتی روتین در هر ماه",
  "گزارش ماهانه Uptime، بکاپ، منابع و Patch",
  "پاسخ اولیه حداکثر چهار ساعت کاری",
] as const;

const ACTIVE_EXCLUDED = [
  "رسیدگی انسانی شبانه‌روزی به رخداد",
  "آزمون دوره‌ای Restore در محیط جدا",
  "نگهداری کد و دیتابیس Application",
  "مهاجرت کامل سایت یا سرویس",
] as const;

const STABLE_INCLUDED = [
  ...ACTIVE_INCLUDED,
  "پایش حیاتی شبانه‌روزی و شروع مدیریت رخدادهای P1",
  "بکاپ روزانه با نگهداری چهارده نسخه",
  "آزمون Restore ماهانه و ثبت نتیجه",
  "بازبینی هفتگی Patch و وضعیت امنیتی سیستم‌عامل",
  "مدیریت تغییرات زیرساخت با برنامه بازگشت",
  "گزارش ظرفیت و پیشنهاد ارتقا پیش از گلوگاه",
  "چهار درخواست عملیاتی روتین در هر ماه",
  "پاسخ رخداد حیاتی حداکثر سی دقیقه",
] as const;

const STABLE_EXCLUDED = [
  "توسعه یا رفع باگ کد Application",
  "DBA اختصاصی و بهینه‌سازی Query",
  "مهاجرت کامل سایت یا سرویس بدون سفارش قطب‌نما",
] as const;

const START_LIMITS: ParchinServiceLimits = {
  setupScope: "راه‌اندازی امن + یک بازبینی و گزارش سلامت در هر ماه",
  customSoftware: "excluded",
  continuousMonitoring: "excluded",
  scheduledBackup: "excluded",
  migration: "excluded",
  osManagement: "initial_only",
  patchManagement: "excluded",
  applicationMaintenance: "excluded",
};

const ACTIVE_LIMITS: ParchinServiceLimits = {
  setupScope: "پایش، بکاپ، Patch ماهانه و دو اقدام روتین در هر ماه",
  customSoftware: "excluded",
  continuousMonitoring: "included",
  scheduledBackup: "included",
  migration: "excluded",
  osManagement: "included",
  patchManagement: "included",
  applicationMaintenance: "excluded",
};

const STABLE_LIMITS: ParchinServiceLimits = {
  setupScope: "عملیات Production، مدیریت رخداد و چهار اقدام روتین در هر ماه",
  customSoftware: "excluded",
  continuousMonitoring: "included",
  scheduledBackup: "included",
  migration: "compass_coordination",
  osManagement: "included",
  patchManagement: "included",
  applicationMaintenance: "excluded",
};

export const DEFAULT_PARCHIN_SERVICE_CONTRACTS: Record<
  ParchinLevel,
  Omit<ParchinServiceContract, "monthlyPriceRial" | "active" | "effectiveFrom">
> = {
  PARCHIN_START: {
    level: "PARCHIN_START",
    version: 2,
    title: "پرچین شروع",
    subtitle: "سلامت پایه هر ماه",
    description:
      "راه‌اندازی امن، بازبینی ماهانه منابع و یک گزارش روشن برای جلوگیری از غافلگیری.",
    includedServices: [...START_INCLUDED],
    excludedServices: [...START_EXCLUDED],
    serviceLimits: START_LIMITS,
    supportWindow: "ساعات اداری",
    firstResponseTarget: "حداکثر تا پایان همان روز کاری",
  },
  PARCHIN_ACTIVE: {
    level: "PARCHIN_ACTIVE",
    version: 2,
    title: "پرچین استوار",
    subtitle: "پایش، بکاپ و نگهداری",
    description:
      "پایش Uptime، بکاپ روزانه، Patch ماهانه و گزارش عملیاتی برای سرویس‌های در حال رشد.",
    includedServices: [...ACTIVE_INCLUDED],
    excludedServices: [...ACTIVE_EXCLUDED],
    serviceLimits: ACTIVE_LIMITS,
    supportWindow: "رسیدگی هشدار در ساعات کاری",
    firstResponseTarget: "حداکثر ۴ ساعت کاری",
  },
  PARCHIN_STABLE: {
    level: "PARCHIN_STABLE",
    version: 2,
    title: "پرچین کهکشان",
    subtitle: "عملیات Production",
    description:
      "پایش حیاتی ۲۴/۷، مدیریت رخداد، آزمون Restore و مدیریت تغییر برای سرویس‌های حساس.",
    includedServices: [...STABLE_INCLUDED],
    excludedServices: [...STABLE_EXCLUDED],
    serviceLimits: STABLE_LIMITS,
    supportWindow: "رخداد حیاتی ۲۴/۷؛ درخواست روتین در ساعات کاری",
    firstResponseTarget: "رخداد حیاتی حداکثر ۳۰ دقیقه",
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
      raw.continuousMonitoring === "included"
        ? "included"
        : raw.continuousMonitoring === "add_on"
          ? "add_on"
          : "excluded",
    scheduledBackup:
      raw.scheduledBackup === "included"
        ? "included"
        : raw.scheduledBackup === "add_on"
          ? "add_on"
          : "excluded",
    migration:
      raw.migration === "compass_coordination"
        ? "compass_coordination"
        : raw.migration === "add_on"
          ? "add_on"
          : "excluded",
    osManagement:
      raw.osManagement === "included"
        ? "included"
        : raw.osManagement === "initial_only"
          ? "initial_only"
          : "excluded",
    patchManagement:
      raw.patchManagement === "included"
        ? "included"
        : raw.patchManagement === "add_on"
          ? "add_on"
          : "excluded",
    applicationMaintenance:
      raw.applicationMaintenance === "included"
        ? "included"
        : raw.applicationMaintenance === "add_on"
          ? "add_on"
          : "excluded",
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
