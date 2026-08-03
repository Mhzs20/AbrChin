# Wallet و Usage Billing

## پول

- Currency مالی Canonical برابر `IRR` است.
- تمام مبلغ‌ها `BigInt` هستند؛ Float ممنوع است.
- UI برای نمایش `IRR / 10` را تومان نشان می‌دهد.
- Adapter باید Currency و Amount Unit Provider را صریح Normalize کند؛ حدس
  تومان/ریال ممنوع است.

## Domainها

```text
Wallet Top-up       = دریافت پول بانکی و Credit
Customer Billing    = Invoice مصرف و Debit Wallet
Provider Billing    = Rate/Usage/Invoice reconciliation
Provider Mutation   = Create/Resize/Stop/Terminate
```

این چهار Domain Trigger و State مشترک ندارند.

## مدل‌ها

- `Wallet`: یک Wallet فعال/مسدود برای هر Customer
- `WalletTopUp` و `PaymentAttempt`: دریافت بانکی و Attempt history
- `WalletLedgerEntry`: Ledger append-only Credit/Debit/Adjustment
- `ResourceVersion`: Snapshot منابع از Confirmation Provider
- `RateCardVersion`: نرخ Provider و Markup snapshotشده
- `UsageInterval`: بازه UTC مصرف و وضعیت کامل/ناقص
- `BillingRun` و `BillingInvoice`: Period و مبلغ کامل مصرف
- `BillingLine`: جزء محاسبه با Resource/Rate Version
- `OutstandingBalance`: مانده‌ای که Wallet پوشش نداده است
- `BillingReconciliation` و `BillingAdjustment`: اختلاف و اصلاح مستقل
- `DunningCase`: Low Balance، Outstanding و Suspension Review

## Invariantها

- تغییر Balance فقط در Transaction همراه Ledger انجام می‌شود.
- Credit/Settlement/Adjustment دارای Idempotency Key یکتا هستند.
- Worker تکراری یا هم‌زمان Double Debit نمی‌سازد.
- Wallet منفی نمی‌شود.
- Invoice مبلغ کامل مصرف را نگه می‌دارد؛ کمبود Wallet آن را حذف نمی‌کند.
- Adjustment Invoice قبلی را Overwrite نمی‌کند.
- Rate/Markup جدید مصرف قبلی را Reprice نمی‌کند.
- Server Stop به معنی صفرشدن همه Componentها نیست.
- Bank auto-charge بدون اجازه Customer ممنوع است.
- Suspend فقط Action کنترل‌شده Admin است؛ Auto-delete/terminate ممنوع است.

## Policy

Availability (`HOURLY_ONLY/DAILY_ONLY/HOURLY_AND_DAILY`)، Calculation Unit،
Settlement Cadence و Display Mode مستقل هستند. Resolution:

```text
Global → Plan override → immutable Service snapshot
```

Plan جدید Cloud پیش‌فرض Hourly است. Service فعال موجود بدون Migration/تصمیم
صریح Cadence قبلی را حفظ می‌کند.
