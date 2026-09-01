/**
 * Deterministic refund and cancellation behavior. Wording on /refund-policy
 * must match these facts. Wallet credit is the only automated destination.
 */

export const REFUND_BEHAVIOR_VERSION = "2026-09-01.1";

export const REFUND_DESTINATION = "abrchin_wallet" as const;

export const REFUND_SCENARIOS = [
  {
    id: "cancel_before_wallet_debit",
    title: "لغو پیش از برداشت کیف پول",
    behavior:
      "اگر سفارش پرداخت نشده باشد، برداشت کیف پول انجام نشده و بازپرداخت معنی ندارد. سفارش پرداخت‌نشده قابل refundOrder نیست.",
    destination: "none",
    automatic: false,
  },
  {
    id: "cancel_after_debit_before_fulfillment",
    title: "لغو پس از برداشت و پیش از ساخت",
    behavior:
      "مشتری مسیر خودکار ledger ندارد؛ درخواست از پشتیبانی با موضوع لغو پیش از تحویل ثبت می‌شود. ادمین فقط وقتی refundOrder را اجرا می‌کند که وضعیت منبع در مجموعهٔ امن باشد و نبود Resource تأیید شده باشد. مقصد اعتبار، کیف پول ابرچین است.",
    destination: REFUND_DESTINATION,
    automatic: false,
  },
  {
    id: "fulfillment_failure",
    title: "شکست ساخت یا تحویل",
    behavior:
      "شکست Provider سفارش یا پرداخت را حذف نمی‌کند. بازگشت وجه ادمینی فقط برای وضعیت‌های WAITING_ADMIN_FUNDING، BLOCKED_PROVIDER_BALANCE، MANUAL_REVIEW، FAILED یا CANCELED مجاز است و در صورت Job فعال یا نامشخص‌بودن Resource مسدود می‌شود.",
    destination: REFUND_DESTINATION,
    automatic: false,
  },
  {
    id: "duplicate_debit",
    title: "برداشت تکراری",
    behavior:
      "پرداخت سفارش با کلید idempotency order_pay_{orderId} و برداشت شرطی ledger یک‌بار انجام می‌شود. تلاش هم‌زمان دوم سند دوم نمی‌سازد.",
    destination: "none",
    automatic: false,
  },
  {
    id: "provider_failure",
    title: "شکست تأمین‌کننده",
    behavior:
      "خطای Provider پرداخت موفق یا سفارش را پاک نمی‌کند. بازپرداخت خودکار بانکی یا کیف پول اجرا نمی‌شود تا ادمین ایمنی منبع را تأیید کند.",
    destination: REFUND_DESTINATION,
    automatic: false,
  },
  {
    id: "customer_cancel_after_provisioning",
    title: "درخواست لغو مشتری پس از راه‌اندازی",
    behavior:
      "فقط سفارش دوره‌ای پیش‌پرداخت پرداخت‌شده با اشتراک فعال. PAYG این مسیر را ندارد. پس از خاتمهٔ قطعی سرور، اعتبار استفاده‌نشده یک‌بار با کلید order_cancel_refund_{orderId} به کیف پول برمی‌گردد. بازگشت بانکی ندارد.",
    destination: REFUND_DESTINATION,
    automatic: false,
  },
  {
    id: "chargeback_or_topup_dispute",
    title: "برگشت بانکی درگاه و اختلاف شارژ",
    behavior:
      "مسیر chargeback خودکار وجود ندارد. عدم تطابق مبلغ یا ارز شارژ وارد بررسی می‌شود. بازپرداخت شارژ فقط اقدام کنترل‌شده ادمین است؛ اگر مبلغ مصرف شده باشد بازپرداخت خودکار ممنوع است. اجرای refund بانکی درگاه در قرارداد v1 پیاده نشده و جدا از اعتبار کیف پول است.",
    destination: "admin_review",
    automatic: false,
  },
  {
    id: "refund_destination",
    title: "مقصد بازگشت",
    behavior:
      "بازگشت سفارش و لغو دوره‌ای فقط به کیف پول داخلی ابرچین است. بازپرداخت نقدی/شبا/کارت خودکار وعده داده نمی‌شود.",
    destination: REFUND_DESTINATION,
    automatic: false,
  },
  {
    id: "review_process",
    title: "فرایند بررسی",
    behavior:
      "درخواست از پشتیبانی حساب یا ایمیل تماس عمومی ثبت می‌شود. اجرای مالی فقط با دستور ادمین دارای idempotency است و در audit ثبت می‌شود.",
    destination: "admin_review",
    automatic: false,
  },
] as const;
