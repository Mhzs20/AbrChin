export const parchinBase = {
  code: "BASE",
  title: "پرچین پایه",
  shortDescription: "کنترل تحویل و دسترسی سرور، بدون وعده‌ی مبهمِ پایش یا بکاپ",
  included: [
    "آماده اعلام‌کردن سرور فقط بعد از فعال‌شدن و دریافت IP",
    "ثبت رمزنگاری‌شده و نمایش یک‌بارمصرف مشخصات ورود",
    "نمایش وضعیت سفارش، تأمین، تحویل و تمدید در حساب",
    "ثبت رخدادهای حساس تحویل برای پیگیری عملیاتی",
  ],
  excluded: [
    "پایش پیوسته‌ی Uptime، CPU، RAM و دیسک",
    "بکاپ زمان‌بندی‌شده و آزمون بازگردانی",
    "به‌روزرسانی سیستم‌عامل یا نگه‌داری برنامه",
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
