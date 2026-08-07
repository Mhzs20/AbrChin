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
`NEEDS_RECONCILIATION`. Dashboard درصد کامل بودن، تعداد/مبلغ نیازمند تطبیق و
سفارش‌های بدون هزینه Snapshot را نشان می‌دهد و برای آن سفارش‌ها سود ناخالص
دقیق نمایش داده نمی‌شود.

## KPIها

- Gross billed = Infra + Parchin + Addon revenue (قبل از تخفیف؛ بدون مالیات)
- Tax collected = جمع خطوط TAX_PAYABLE
- Net sales excl tax = Gross billed − Term/Coupon/Sales refund
- Provider COGS = Infra cost + Addon cost (Snapshot)
- Gross profit = Net sales − COGS (فقط روی کیفیت FINAL/ESTIMATED پیش‌فرض)
- Operating profit = Gross − Posted opex
- Effective margin = Gross / Net sales

اگر هزینه‌های عملیاتی ناقص باشند هرگز برچسب «سود خالص قطعی» نزنید؛ از
«سود عملیاتی بر اساس هزینه‌های ثبت‌شده» استفاده کنید.

## Booked در برابر Recognized

- **فروش ثبت‌شده (Booked)**: کل فروش در زمان خرید موفق در Journal ثبت می‌شود
  (مدل Deferred-Revenue واقعی برای کل مبلغ استفاده نمی‌شود؛ `DEFERRED_REVENUE`
  فقط برای Snapshot نامتوازن / نیاز به تطبیق است).
- **درآمد شناسایی‌شده (Recognized)**: یک **نمای مدیریتی / Projection** است؛
  مستقیم خطی روی مدت ۱/۳/۶/۱۲ ماه روی همان Journal محاسبه می‌شود و سند جداگانه
  شناسایی درآمد نمی‌سازد. مالیات خارج از شناسایی درآمد است؛ COGS همگام وقتی
  Snapshot اجازه دهد. این نما نباید دوباره به‌عنوان درآمد حسابداری اضافه شود.

اگر Snapshot هزینه Provider نباشد: سود دقیق ساخته نمی‌شود؛
`NEEDS_RECONCILIATION`. Dashboard درصد کامل بودن و مبلغ نیازمند تطبیق را
نشان می‌دهد و سود ناخالص دقیق برای آن سفارش نشان داده نمی‌شود.

## هزینه‌های دستی

Draft روی P&L اثر ندارد. Posted اثر دارد و مستقیم Edit/Delete نمی‌شود.
اصلاح = Reverse + Expense جدید. AuditLog کامل. دستهٔ COGS خودکار Provider
مجاز نیست. ایجاد Draft با `Idempotency-Key` از double-submit محافظت می‌شود.

## UI و گزارش

`/admin/accounting` — Overview / Sales / Expenses / Refunds / Wallet / Tax /
Reconciliation / Journal.

CSV: UTF-8 BOM، ستون ریال خام + تومان خوانا، ISO timestamp، فیلترهای فعال UI،
بدون Secret/API خام Provider.

## Backfill

Never runs from app startup or DB migration. Production uses the compiled
runtime artifact `dist/accounting/accounting-backfill.js` (built with the
worker/catalog-sync esbuild pipeline). After production health is green:

```bash
docker compose --env-file .env -f compose.production.yaml \
  exec -T web npm run accounting:backfill -- --dry-run
# review: recordsScanned, entriesToCreate, alreadyPosted, needsReconciliation, errors
docker compose --env-file .env -f compose.production.yaml \
  exec -T web npm run accounting:backfill
```

Local/source variant (dev only): `npm run accounting:backfill:source -- --dry-run`.

Idempotent؛ از Snapshot تاریخی استفاده می‌کند؛ قیمت جاری Provider را برای
ساخت COGS تاریخی query نمی‌کند. Missing historical provider cost →
`NEEDS_RECONCILIATION`, not invented profit.

## اتصال به منحنی سود

هر سفارش جدید `commercialEconomicsSnapshot` را نگه می‌دارد تا گزارش‌های بعدی
با منحنی امروز فروش‌های قدیم را دوباره حساب نکنند.
