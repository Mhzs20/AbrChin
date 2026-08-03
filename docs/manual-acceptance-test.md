# Manual acceptance test — Wallet-first PAYG

## Local controlled flow

1. PostgreSQL ایزوله را بالا بیاورید و `prisma migrate deploy` را از صفر اجرا
   کنید.
2. با Gateway/Provider کنترل‌شده وارد `/login` شوید.
3. `/cloud-servers` را باز و Config معتبر انتخاب کنید.
4. Estimate ساعتی و ۲۴ساعته، Cadence، حداقل اعتبار و برچسب تخمینی را بررسی
   کنید.
5. Wallet را از `/account/wallet/topup` شارژ کنید.
6. Callback تکراری بفرستید و فقط یک Credit/Ledger را تأیید کنید.
7. به Quote برگردید؛ با Wallet کافی نباید Gateway دوباره باز شود.
8. Activation Request را ثبت کنید. Wallet Debit خرید، Provider Job و Resource
   نباید ساخته شده باشند.
9. Admin صف Approval اول را باز و Request را تأیید کند؛ هنوز Mutation مستقیم
   این Action اجرا نمی‌کند.
10. Provider کنترل‌شده Confirmation بسازد؛ Billing از Timestamp آن شروع شود.
11. Admin Resource/Credential را بررسی کند. Customer قبل از Approval دوم
    Reveal ندارد.
12. Approval دوم را ثبت کنید؛ Credential فقط یک بار توسط مالک Reveal شود.
13. Billing Worker یک Period بسته را Settlement کند؛ Retry و اجرای هم‌زمان
    Invoice/Debit دوم نسازد.
14. Wallet ناکافی را آزمایش کنید؛ Invoice کامل و Outstanding باقی بماند.
15. Low Balance/Grace را جلو ببرید؛ فقط Suspension Review ساخته شود و هیچ
    Delete/Terminate خودکار رخ ندهد.

## Mid-period behavior

- Resize تأییدشده در میانه Period باید ResourceVersion قبلی را در زمان
  Confirmation ببندد و Version جدید بسازد.
- Rate یا Markup جدید فقط Interval آینده را تغییر دهد.
- Stop باید طبق Provider Policy Compute/Disk/IP را جدا محاسبه کند.
- Termination فقط از Confirmation Provider مؤثر باشد.
- Usage ناقص `UNDER_REVIEW` بسازد و مبلغ جعلی تولید نکند.

## Payment recovery

- Callback بعد TTL پذیرفته شود.
- دو Callback هم‌زمان Double Credit نسازند.
- Failed/Canceled Attempt تازه بسازد.
- Timeout Verify در Reconcile بعدی بازیابی شود.
- Amount/Currency mismatch وارد Review شود.
- Refund تکراری Ledger دوم نسازد.
- Refund شارژ مصرف‌شده بدون Review انجام نشود.

## Gate و Admin

- Sale روشن/Mutation خاموش: Estimate، Top-up و Activation مجاز؛ Dispatch
  Provider غیرمجاز.
- Sale خاموش: فروش Fail-closed.
- Mutation روشن بدون Admin Approval: هیچ Mutation.
- صف Approval اول `FUNDING_CONFIRMED` را نشان ندهد.
- صف Delivery `DELIVERED/ACTIVE` را نشان ندهد.
- Connection Check آروان با Fetch کنترل‌شده تست شود؛ Preflight به Provider
  Production وصل نشود.

## PREPAID_TERM

یک VPS دوره‌ثابت را جدا آزمایش کنید: Checkout/renewal دستی مجاز است، اما
Auto-renew، Usage Invoice Cloud و UI PAYG نباید با آن مخلوط شوند.
