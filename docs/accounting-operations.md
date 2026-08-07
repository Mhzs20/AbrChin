# Operational Accounting — حسابداری عملیاتی ابرچین

> این سامانه یک **P&L مدیریتی / حسابداری عملیاتی** برای Founder است.
> جایگزین دفاتر قانونی حسابداری ایران، نرم‌افزار مالیاتی، یا اظهارنامه رسمی نیست.

## منبع حقیقت

- `WalletLedgerEntry` همچنان منبع حرکت موجودی کیف پول است و بازنویسی نمی‌شود.
- زیرledger حسابداری (`AccountingJournalEntry` + `AccountingJournalLine`)
  رویدادهای کسب‌وکار را به صورت Double-entry ثبت می‌کند و به Ledger کیف پول
  ارجاع می‌دهد، جایگزین آن نیست.

## مدل‌ها

- `AccountingJournalEntry` — append-only پس از POSTED؛ حذف سخت ممنوع؛ اصلاح با
  Reverse Entry.
- `AccountingJournalLine` — برای هر Entry: جمع بدهکار = جمع بستانکار.
- `OperatingExpense` — DRAFT / POSTED / REVERSED.
- Idempotency پایدار مثل `wallet-topup:{id}:succeeded:v1`.

## حساب‌ها

Assets / clearing: `CASH_GATEWAY`, `PROVIDER_FUNDING_CLEARING`  
Liabilities: `CUSTOMER_WALLET_LIABILITY`, `TAX_PAYABLE`, `DEFERRED_REVENUE`  
Revenue: `INFRASTRUCTURE_REVENUE`, `PARCHIN_REVENUE`, `ADDON_REVENUE`  
Contra: `TERM_DISCOUNT`, `COUPON_DISCOUNT`, `SALES_REFUND`  
COGS: `PROVIDER_INFRASTRUCTURE_COGS`, `PROVIDER_ADDON_COGS`  
Opex: `GATEWAY_FEES`, `SMS_EXPENSE`, `SUPPORT_OPERATIONS`,
`HOSTING_OPERATIONS`, `MARKETING_EXPENSE`, `PAYROLL_CONTRACTOR`,
`OTHER_OPERATING_EXPENSE`

## قواعد رویداد

| رویداد | اثر |
|---|---|
| Wallet top-up موفق | Dr Cash / Cr Wallet Liability — **درآمد نیست** |
| خرید از Wallet | آزادسازی Liability + ثبت فروش از Snapshot سفارش |
| مالیات | `TAX_PAYABLE` — درآمد AbrChin نیست |
| تخفیف دوره/کد | Contra revenue |
| هزینه Provider | فقط از Snapshot غیرقابل‌تغییر سفارش — نه قیمت جاری Catalog |
| Refund | Reverse/Contra؛ حذف تاریخچه فروش ممنوع |
| Provider funding | اگر COGS سفارش قبلاً ثبت شده، دوباره COGS نشود |
| Retry/Webhook | با Idempotency تکراری Journal نمی‌سازد |

## کیفیت داده

`FINAL` | `ESTIMATED` | `NEEDS_RECONCILIATION` | `REVERSED`

اگر Snapshot هزینه Provider نباشد: سود دقیق ساخته نمی‌شود؛
`NEEDS_RECONCILIATION`. Dashboard درصد کامل بودن و مبلغ نیازمند تطبیق را
نشان می‌دهد.

## KPIها

- Gross billed = مبلغ نهایی مشتری با مالیات
- Tax collected = جمع خطوط TAX
- Net sales excl tax = Infra + Parchin + Addon − Term − Coupon − Refund adj
- Provider COGS = Infra cost + Addon cost (Snapshot)
- Gross profit = Net sales − COGS
- Operating profit = Gross − Posted opex
- Effective margin = Gross / Net sales

اگر هزینه‌های عملیاتی ناقص باشند هرگز برچسب «سود خالص قطعی» نزنید؛ از
«سود عملیاتی بر اساس هزینه‌های ثبت‌شده» استفاده کنید.

## Booked در برابر Recognized

- **فروش ثبت‌شده**: کل فروش در زمان خرید موفق.
- **درآمد شناسایی‌شده**: مستقیم خطی روی مدت ۳/۶/۱۲ ماه؛ مالیات خارج از
  شناسایی درآمد؛ COGS همگام وقتی Snapshot اجازه دهد. سفارش بدون دادهٔ دوره
  Estimated / Needs Reconciliation است؛ تاریخ جعلی ساخته نمی‌شود.

## هزینه‌های دستی

Draft روی P&L اثر ندارد. Posted اثر دارد و مستقیم Edit/Delete نمی‌شود.
اصلاح = Reverse + Expense جدید. AuditLog کامل. دستهٔ COGS خودکار Provider
مجاز نیست.

## UI و گزارش

`/admin/accounting` — Overview / Sales / Expenses / Refunds / Wallet / Tax /
Reconciliation / Journal.

CSV: UTF-8 BOM، ستون ریال خام + تومان خوانا، ISO timestamp، فیلترهای فعال UI،
بدون Secret/API خام Provider.

## Backfill

```bash
npm run accounting:backfill
# یا dry-run:
node --import ./scripts/test-resolve-hook.mjs --experimental-strip-types scripts/accounting-backfill.mts --dry-run
```

Idempotent؛ از Snapshot تاریخی استفاده می‌کند؛ قیمت جاری Provider را برای
ساخت COGS تاریخی query نمی‌کند؛ در Startup اپ به‌صورت خودکار اجرا نمی‌شود.

## اتصال به منحنی سود

هر سفارش جدید `commercialEconomicsSnapshot` را نگه می‌دارد تا گزارش‌های بعدی
با منحنی امروز فروش‌های قدیم را دوباره حساب نکنند.
