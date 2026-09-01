# برنامه اجرایی Launch V2 ابرچین

وضعیت سند: `ACTIVE` برای قرارداد فازها؛ انتشار جاری روی `origin/main`
مالک تصمیم محصول: Founder
Branch اجرا (تاریخی، بازنشسته): worktree Launch V2
قاعده انتشار جاری: Publish روی `origin/main` بدون Draft PR؛ Deploy فقط با تأیید صریح Founder

## قواعد ثابت

- فروش عمومی Launch فقط `PREPAID_TERM` با دوره‌های ۱، ۳، ۶ و ۱۲ ماه است.
- PAYG ساعتی/روزانه در Backend حفظ می‌شود، اما در UX عمومی Launch نمایش یا فروخته نمی‌شود.
- Quote دقیقاً ۶۰ دقیقه معتبر است؛ مبلغ و Snapshot تاریخی آن تغییر نمی‌کند.
- Gateway فقط Wallet را Credit می‌کند؛ خرید فقط از Ledger، Wallet را Debit می‌کند.
- Cancel/Reject/Refund فقط با Ledger و Audit انجام می‌شود.
- تمام مبلغ‌ها Integer/BigInt ریالی‌اند؛ Float ممنوع است.
- Fulfillment در Launch دستی است و دو Approval مستقل Admin دارد.
- `PUBLIC_SALE_ENABLED=true` و Gateهای فروش Source باز می‌مانند؛ تمام Provider
  mutation gateها برای Fulfillment دستی خاموش‌اند.
- GET و Render صفحه Business resource نمی‌سازند؛ Refresh Quote فقط Mutation صریح است.
- تنها داده واقعی و قابل ردیابی Provider می‌تواند توسط Admin Publish شود؛ Auto-publish و Oversell ممنوع است.

## Golden Path

`Discovery → Guest Quote → Login/Claim → Wallet/Payment → Admin Review → Manual Fulfillment → Delivery → Renewal/Upgrade/Cancel/Refund`

## فازها و Gateها

| فاز | خروجی اصلی | Gate پایان فاز |
| --- | --- | --- |
| 0 | قرارداد Flow، State/CTA matrix، مسیر Canonical، Deprecation و Sale gates | همه مسیرها قطعی، Sale باز، Mutation خاموش، baseline مرورگر desktop/mobile |
| 1 | Hero، Compass، Discovery و Catalog | انتخاب پروژه Ranking را تغییر دهد؛ اطلاعات ضروری و دلیل پیشنهاد کامل باشد |
| 2 | Guest Quote و تداوم Auth | Quote نهایی پیش از Login؛ بازیابی دقیق Selection؛ recovery شفاف |
| 3 | Checkout، Wallet و Payment recovery | عدم Debit/Order تکراری؛ PENDING_PAYMENT بدون بن‌بست؛ Amount parity |
| 4 | Order tracking و ارتباط تحویل | وضعیت و اقدام بعدی همواره روشن؛ Cancel پیش از Delivery؛ refresh واقعی |
| 5 | Manual Admin Fulfillment | فرم یکپارچه، validation/mismatch، عدم Resource تکراری، دو Approval |
| 6 | Credential، Renewal، Upgrade و Cancel | Ledger consistency، context preservation و Credential lifecycle صحیح |
| 7 | شواهد عملیاتی پرچین | هر تعهد Owner/Due/Evidence دارد و ادعای اثبات‌نشده حذف است |
| 8 | UI consistency، Error، Mobile و Accessibility | CTA صادقانه؛ خطا و اقدام بعدی دقیق؛ desktop/mobile و keyboard پاس |
| 9 | Golden Path کامل و Release readiness | صفر Skip الزامی، صفر High/Critical production، همه Runbookها همگام |

## Stop conditions

اجرای فاز بعدی با P0/P1 باز، تست الزامی Fail/Skip، High/Critical حل‌نشده، تناقض قراردادی، تصمیم مالی/حقوقی نامشخص یا نیاز به Production/Provider واقعی ممنوع است. Gate خارجی Staging purchase، داده حقوقی، Production smoke و Provider Mutation واقعی فقط با تأیید Founder انجام می‌شود. سیاست Public Sale از ۲۰۲۶-۰۸-۱۰ باز و قفل‌شده است.
