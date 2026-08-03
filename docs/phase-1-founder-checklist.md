# Checklist Founder برای پذیرش Wallet-first فاز ۱

> این سند مجوز Deploy، پرداخت یا Provider Mutation نیست. Secret، شماره مشتری،
> Gateway response و Credential را در Log/Screenshot ثبت نکنید.

## پیش‌نیاز

- [ ] SHA تأییدشده `origin/main` دقیقاً با Image مورد تست برابر است.
- [ ] Migration تازه و Upgrade روی PostgreSQL Backup/Fixture پاس شده‌اند.
- [ ] Environment Production برای Database، Session، Credential encryption،
  OTP، Gateway و Provider کامل است.
- [ ] `BILLING_WORKER_INTERVAL_MS` و Billing Policy global/plan بررسی شده‌اند.
- [ ] Planهای جدید Cloud پیش‌فرض Hourly هستند و Serviceهای موجود Cadence قبلی
  خود را حفظ کرده‌اند.
- [ ] Connection Check آروان GET احرازشده واقعی دارد؛ Allowlist به‌تنهایی
  Healthy نیست.
- [ ] Sale Gate و Mutation Gate ابتدا `false` هستند.
- [ ] هیچ Mock Provider/Gateway در Production فعال نیست.

## سناریوی کنترل‌شده Cloud PAYG

1. Customer منابع را در `/cloud-servers` انتخاب و Estimate ساعتی/۲۴ساعته،
   Markup و حداقل اعتبار را می‌بیند.
2. Customer Wallet را با یک Top-up واقعی شارژ می‌کند. Callback فقط Top-up را
   Verify و Wallet را یک بار Credit می‌کند.
3. بازگشت به Quote نباید Payment دوم بسازد. اگر Wallet کافی است Gateway
   دوباره باز نمی‌شود.
4. Customer Activation Request را ثبت می‌کند. Wallet Debit خرید و Provider
   Job/Resource نباید وجود داشته باشد.
5. Admin در صف Approval اول، اعتبار، Quote/Rate freshness و Availability را
   بررسی می‌کند.
6. Approval اول فقط اجازه Provision می‌دهد. Dispatch/Fulfillment دقیقاً یک
   Resource می‌سازد.
7. Provider Confirmation، `ResourceVersion.effectiveFrom` و Billing start را
   با UTC ثبت می‌کند.
8. Admin Resource و Credential را بررسی می‌کند؛ Customer هنوز Secret ندارد.
9. Approval دوم دقیقاً یک Delivery می‌سازد. مالک Credential را فقط یک بار
   Reveal می‌کند.
10. یک Period بسته توسط Billing Worker Settlement می‌شود و Invoice، Lines،
    Wallet Ledger و Runway بررسی می‌شوند.
11. Worker دوباره و هم‌زمان اجرا می‌شود؛ Invoice یا Debit دوم نباید ساخته شود.
12. Provider Reconciliation بدون تغییر بی‌صدای Wallet بررسی می‌شود.

## Failure/Recovery

- [ ] Callback دیررس و تکراری فقط یک Wallet Credit ساخته است.
- [ ] Timeout Verify در Recovery Queue و Reverify بعدی موفق است.
- [ ] Amount/Currency mismatch در Admin Review است و Secret نمایش داده نمی‌شود.
- [ ] Refund تکراری Ledger دوم نمی‌سازد؛ شارژ مصرف‌شده Review می‌خواهد.
- [ ] Resize میان Period دو ResourceVersion/Interval دقیق دارد.
- [ ] Upgrade با اعتبار ناکافی Block و Downgrade امن مجاز است.
- [ ] Wallet ناکافی `PARTIALLY_PAID/UNPAID` و Outstanding ثبت می‌کند.
- [ ] Low Balance Notification و سپس Suspension Review ایجاد می‌شود.
- [ ] Suspend بدون Admin action و Terminate/Delete خودکار اجرا نمی‌شود.
- [ ] Retry Delivery و Provision Resource/Notification تکراری نمی‌سازد.

## PREPAID_TERM

- [ ] Plan دوره‌ثابت UI و Checkout مستقل دارد.
- [ ] Renewal دستی است؛ Auto-renew و Auto-charge وجود ندارد.
- [ ] رکورد PREPAID با Usage Billing Cloud مخلوط نشده است.

## نتیجه

- [ ] همه Actionها در Audit با Actor/Reason/Idempotency دیده می‌شوند.
- [ ] هیچ Secret یا Raw Provider response در UI/Log/Audit نیست.
- [ ] Gateهای بازشده دوباره بسته یا وضعیت نهایی آن‌ها ثبت شده است.
- [ ] Founder به‌صورت جداگانه درباره Controlled Deploy و سپس Public Sale
  تصمیم گرفته است.
