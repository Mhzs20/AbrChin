# Manual acceptance test

Launch public Golden Path is `PREPAID_TERM` (1 / 3 / 6 / 12 months) with
wallet top-up, wallet debit, two Admin approvals, and manual fulfillment.
PAYG remains backend/legacy and is **not** the public Launch path. Owner
acceptance lives in `docs/launch/wp6-owner-acceptance-checklist.md` and is
unsigned.

## Local controlled PREPAID Golden Path

Follow `docs/launch/launch-contract-v2.md` and the WP6 owner checklist.
Do not treat this file as Owner acceptance.

## Legacy / internal PAYG notes

The steps below remain for Wallet-first PAYG internals. They are not the
Launch storefront path.

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


## Storefront commercial rework v3 (Task 2)

1. `/cloud-servers` را باز کنید؛ همه پلن‌های Non-dominated هر چینش دیده شوند
   (نه فقط سه پلن منتخب).
2. کارت فقط CPU / RAM / Disk فنی، نام پرچین، یک‌خط توضیح، «جزئیات خدمات»،
   قیمت ماهانه و «معادل روزانه/ساعتی» (اگر روشن باشد) را نشان دهد.
3. CTA همیشه «ثبت سفارش» باشد؛ زمان تحویل «فوری».
4. سرور ۱۶ vCPU / ۳۲GB / ۷۵GB Disk در کهکشان باشد؛ ۶/۱۲/۵۰ در استوار.
5. Dialog پرچین با Escape و Focus قابل دسترس باز/بسته شود؛ شامل و غیرشامل
   را نشان دهد.
6. بعد از Login با `?plan=` به همان کارت برگردید و فرم سفارش باز شود.
7. در فرم سفارش: منابع، Location، OS، دسترسی، نام سرور، پرچین، دوره، و
   یادآوری تحویل فوری دیده شود؛ Provider دیده نشود.
8. Quote قفل‌شده نسخه پرچین را Snapshot کند؛ تغییر Admin بعد از Quote مبلغ
   تعهد قبلی را عوض نکند.
9. Admin Storefront Diagnostics: تعداد خام / Duplicate / Dominated / نهایی
   و دلیل حذف را نشان دهد.

## Profit curve + operational accounting (Task 3)

1. در مرکز مالی تب «منحنی سود سرورها» را باز کنید؛ پنج بازهٔ ۷۰/۶۰/۵۰/۴۰/۳۰
   و کف ۲۰٪ پس از تخفیف را ببینید.
2. Preview را با هزینه نزدیک مرز ۵ میلیون تومان اجرا کنید؛ حاشیهٔ مؤثر بین
   ۷۰ و ۶۰ باشد و قیمت فروش نسبت به هزینهٔ کمی پایین‌تر کاهش نیابد.
3. Publish با عبارت تأیید حاشیه بالا وقتی بازهٔ ۷۰٪ در payload است.
4. Rollback یک Revision؛ منحنی همراه قیمت‌ها برگردد.
5. `/admin/accounting` را باز کنید؛ KPIها، toggle فروش ثبت‌شده /
   درآمد شناسایی‌شده، و Disclaimer عملیاتی را ببینید.
6. یک هزینه Draft بسازید (روی P&L نیاید)، Post کنید (بیاید)، Reverse کنید.
7. CSV را با BOM فارسی دانلود کنید.
8. سفارش تاریخی بدون Snapshot هزینه باید Needs Reconciliation باشد، نه سود
   قطعی جعلی.
