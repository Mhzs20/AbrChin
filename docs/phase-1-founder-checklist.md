# Checklist Founder برای Launch V2 PREPAID

> این سند مجوز Deploy، پرداخت واقعی یا Provider mutation نیست. Public Sale
> مطابق تصمیم Founder در ۲۰۲۶-۰۸-۱۰ باز و پیش‌فرض دائمی Launch است.
> اجرای هر بخش Staging/Production نیازمند تأیید صریح و جداگانه Founder است.

## قرارداد ثابت

- [ ] Golden Path عمومی فقط `PREPAID_TERM` با دوره‌های ۱، ۳، ۶ و ۱۲ ماه است.
- [ ] PAYG در Backend حفظ شده اما در UI عمومی، Quote و Checkout Launch دیده نمی‌شود.
- [ ] مسیر Canonical خرید `/cloud-servers` است؛ `/ready-servers` ورودی اصلی نیست.
- [ ] Gateway فقط Wallet Top-up را Credit و خرید فقط Wallet Ledger را Debit می‌کند.
- [ ] Fulfillment دستی و دارای دو Approval مستقل Admin است.
- [ ] `PUBLIC_SALE_ENABLED=true` و Gateهای فروش Source بازند؛ Mutationهای
  Provider برای Fulfillment دستی `false` هستند.

## پیش‌نیاز Release candidate

- [ ] SHA تأییدشده دقیقاً با Image مورد آزمون برابر و Worktree قابل ردیابی است.
- [ ] Draft PR به `main` ساخته و review شده است؛ Merge هنوز انجام نشده.
- [ ] Fresh migration و Upgrade migration روی PostgreSQL Staging/backup fixture پاس شده‌اند.
- [ ] Environment Staging برای Database، Session، Credential encryption، OTP، SMTP و Gateway کامل است.
- [ ] هیچ Mock Provider/Gateway در Staging purchase فعال نیست.
- [ ] Connection checkهای read-only Provider و Gateway با داده واقعی پاس شده‌اند.
- [ ] Catalog/price currency/amount unit واقعی، freshness و Region allowlist تأیید شده‌اند.
- [ ] هیچ موجودی یا پلن ساختگی Publish نشده است.
- [ ] داده حقوقی و هویتی شرکت برای صفحات عمومی تأیید Founder را دارد.
- [ ] Backup و rollback drill ثبت شده است.

## عملیات پرچین

- [ ] هر سه سطح پرچین قرارداد نسخه ۳ و قیمت فعال دارند.
- [ ] تأیید دوم تحویل، `ParchinEnrollment` و صف کار متناسب با سطح را می‌سازد.
- [ ] ادمین Owner، Due، Status و Evidence هر کار را در `/admin/parchin` ثبت می‌کند.
- [ ] سهمیه روتین و SLA پاسخ در درخواست پشتیبانی همان قرارداد enforce می‌شود.
- [ ] گزارش‌های دوره‌ای دارای بازه، شاخص و اقدام پیشنهادی در پنل مشتری منتشر می‌شوند.
- [ ] برنامه On-call انسانی برای رخداد P1 کهکشان پیش از Deploy مشخص است.

## سناریوی کنترل‌شده PREPAID در Staging

1. Customer از Home/Catalog وارد Config عمومی می‌شود و OS، نام سرور، دوره و سطح پرچین را انتخاب می‌کند.
2. Quote پیش از Login ساخته می‌شود؛ مدت اعتبار دقیقاً ۶۰ دقیقه و Snapshotها immutable هستند.
3. Customer وارد می‌شود؛ Guest Session به همان User claim و Selection بدون تغییر بازیابی می‌شود.
4. اگر Wallet کسری دارد، Top-up واقعی فقط یک Credit Ledger می‌سازد؛ callback تکراری Credit دوم نمی‌سازد.
5. خرید از Wallet دقیقاً یک Debit و یک ServiceOrder می‌سازد؛ submit همزمان Order/Debit دوم نمی‌سازد.
6. پس از پرداخت، وضعیت `WAITING_ADMIN_FUNDING` است و هنوز Resource/Credential وجود ندارد.
7. Approval اول Admin فقط اجازه Fulfillment می‌دهد؛ خودش Resource یا Delivery ایجاد نمی‌کند.
8. Admin مشخصات واقعی Resource را با Fulfillment دستی ثبت می‌کند؛ credential رمزنگاری و delivery pending است.
9. Approval دوم پس از تطبیق Snapshot/Health/Credential، سرویس را Active و قابل مشاهده می‌کند.
10. Customer credential را فقط یک‌بار Reveal می‌کند؛ مقدار Secret وارد Log/Screenshot/Audit metadata نمی‌شود.
11. Renewal دستی است؛ Upgrade فقط delta قفل‌شده را Debit می‌کند؛ Cancel/Refund فقط Ledger idempotent دارد.

## Failure و Recovery اجباری

- [ ] Callback دیررس/تکراری یک Wallet Credit دارد؛ amount/currency mismatch وارد Review می‌شود.
- [ ] timeout درگاه قابل reverify است و Success هرگز downgrade نمی‌شود.
- [ ] failure پس از Wallet debit کل transaction را rollback می‌کند.
- [ ] Approval/Fulfillment/Delivery همزمان Resource، Credential یا Audit تکراری نمی‌سازد.
- [ ] Customer پیش از Approval دوم IP/Secret نمی‌بیند.
- [ ] Reject/Cancel replay، Refund Ledger دوم نمی‌سازد.
- [ ] Refreshهای GET هیچ Business mutation ندارند.

## Production smoke و فعال‌سازی

- [ ] Deploy کنترل‌شده با Sale باز و Mutation خاموش انجام و `/api/health` و `/api/readiness` پاس شده است.
- [ ] Login/OTP، SMTP، Gateway read-only/verify، Catalog sync و Worker health بررسی شده‌اند.
- [ ] یک Staging purchase واقعی کامل و Evidence آن ثبت شده است.
- [ ] Founder جداگانه Deploy Production را تأیید کرده است.
- [x] Founder در ۲۰۲۶-۰۸-۱۰ Public Sale دائماً باز را تأیید کرده است.
- [ ] Master و Provider/source sale gateها در تمام سرویس‌ها `true` باقی مانده‌اند.
- [ ] Provider mutation برای Launch دستی همچنان `false` است.
- [ ] Production smoke پس از فعال‌سازی، بدون Secret و داده حساس ثبت شده است.

## نتیجه

- [ ] تمام Actionها Actor/Reason/Idempotency/Audit دارند.
- [ ] High/Critical production dependency برابر صفر است.
- [ ] هیچ تست الزامی Fail یا Skip نشده است.
- [ ] Rollback target و مسئول on-call مشخص‌اند.
- [ ] Founder حکم نهایی `GO` را با SHA و timestamp ثبت کرده است.

تا زمانی که همه موارد بالا تکمیل نشده‌اند، Verdict کلی `NO-GO` است.
