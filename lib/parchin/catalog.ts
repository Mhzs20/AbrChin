export const parchinBase = {
  code: "BASE",
  title: "پرچین پایه",
  shortDescription: "کنترل تحویل و دسترسی سرور، بدون وعده‌ی مبهمِ پایش یا بکاپ",
  included: [
    "آماده اعلام‌کردن سرور فقط بعد از فعال‌شدن و دریافت IP",
    "ثبت رمزنگاری‌شده و نمایش یک‌بارمصرف مشخصات ورود",
    "نمایش وضعیت سفارش، ساخت، تحویل و تمدید در حساب",
    "ثبت رخدادهای حساس تحویل برای پیگیری عملیاتی",
  ],
  excluded: [
    "پایش پیوسته‌ی Uptime، CPU، RAM و دیسک",
    "بکاپ زمان‌بندی‌شده و آزمون بازگردانی",
    "به‌روزرسانی سیستم‌عامل یا نگه‌داری برنامه",
  ],
} as const;

/** Suggested service scope per Parchin tier (Admin can edit copy in pricing). */
export const parchinTierServiceSuggestions = {
  PARCHIN_START: [
    "تحویل کنترل‌شده سرور نو با نام و سیستم‌عامل انتخابی",
    "دسترسی یک‌بارمصرف و راهنمای ورود اولیه",
    "پاسخ پشتیبانی در ساعات اداری برای راه‌اندازی",
  ],
  PARCHIN_ACTIVE: [
    "همهٔ خدمات پرچین شروع",
    "همراهی راه‌اندازی اولیه سرویس روی سرور",
    "بررسی سلامت اولیه پس از تحویل",
    "اولویت بالاتر در صف پشتیبانی ساخت و تحویل",
  ],
  PARCHIN_STABLE: [
    "همهٔ خدمات پرچین فعال",
    "هماهنگی مهاجرت سایت/سورس با تیم ابرچین (قطب‌نما)",
    "بازبینی معماری پیشنهادی قبل از تحویل",
    "مسیر مستقیم پشتیبانی برای تغییر و تمدید",
  ],
} as const;

export function parchinPlanLabel(included: boolean) {
  return included ? parchinBase.title : "بدون پرچین";
}

export function parchinLevelLabel(
  level?: "PARCHIN_START" | "PARCHIN_ACTIVE" | "PARCHIN_STABLE" | null,
) {
  if (level === "PARCHIN_ACTIVE") return "پرچین فعال";
  if (level === "PARCHIN_STABLE") return "پرچین پایدار";
  return "پرچین شروع";
}

export function parchinPlanSummary(included: boolean) {
  return included
    ? "تحویل کنترل‌شده و دسترسی یک‌بارمصرف؛ پایش و بکاپ فقط وقتی جداگانه در سفارش ثبت شوند."
    : "مدیریت، پایش، بکاپ و نگه‌داری سرور با خودت است.";
}
