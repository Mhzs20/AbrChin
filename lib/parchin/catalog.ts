export const parchinBase = {
  code: "BASE",
  title: "پرچین شروع",
  shortDescription: "راه‌اندازی امن، بازبینی ماهانه و گزارش سلامت قابل پیگیری",
  included: [
    "آماده اعلام‌کردن سرور فقط بعد از فعال‌شدن و دریافت IP",
    "ثبت رمزنگاری‌شده و نمایش یک‌بارمصرف مشخصات ورود",
    "نمایش وضعیت سفارش، ساخت، تحویل و تمدید در حساب",
    "ثبت رخدادهای حساس تحویل برای پیگیری عملیاتی",
  ],
  excluded: ["پایش شبانه‌روزی", "بکاپ مدیریت‌شده", "نگه‌داری Application"],
} as const;

/** Suggested service scope per Parchin tier (Admin can edit copy in pricing). */
export const parchinTierServiceSuggestions = {
  PARCHIN_START: [
    "راه‌اندازی و سخت‌سازی پایه",
    "بازبینی ماهانه منابع و دسترسی",
    "گزارش سلامت و یک اقدام روتین ماهانه",
  ],
  PARCHIN_ACTIVE: [
    "همهٔ خدمات پرچین شروع",
    "پایش Uptime پنج‌دقیقه‌ای",
    "بکاپ روزانه و Patch ماهانه",
    "گزارش عملیاتی و پاسخ حداکثر چهار ساعت کاری",
  ],
  PARCHIN_STABLE: [
    "همهٔ خدمات پرچین استوار",
    "پایش حیاتی و مدیریت رخداد P1",
    "آزمون Restore و مدیریت تغییر",
    "گزارش ظرفیت و پاسخ رخداد حیاتی حداکثر سی دقیقه",
  ],
} as const;

export function parchinPlanLabel(included: boolean) {
  return included ? parchinBase.title : "بدون پرچین";
}

export function parchinLevelLabel(
  level?: "PARCHIN_START" | "PARCHIN_ACTIVE" | "PARCHIN_STABLE" | null,
) {
  if (level === "PARCHIN_ACTIVE") return "پرچین استوار";
  if (level === "PARCHIN_STABLE") return "پرچین کهکشان";
  return "پرچین شروع";
}

export function parchinPlanSummary(included: boolean) {
  return included
    ? "راه‌اندازی امن، بازبینی ماهانه و گزارش سلامت قابل پیگیری."
    : "مدیریت، پایش، بکاپ و نگه‌داری سرور با خودت است.";
}
