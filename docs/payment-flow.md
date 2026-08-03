# Payment flow — Wallet Top-up

## مرز Domain

درگاه بانکی برای `CLOUD_SERVER/PAYG_WALLET` فقط Wallet را شارژ می‌کند:

```text
WalletTopUp
→ immutable PaymentAttempt
→ Gateway Verify
→ transactional Wallet Credit
```

Payment موفق هیچ Order، Activation، Provision، Resize یا Delivery را خودکار
اجرا نمی‌کند. Quote expiry و Provider price به پذیرش Top-up موفق ارتباط ندارند.

`PREPAID_TERM` می‌تواند Checkout دوره‌ثابت مستقل داشته باشد؛ آن مسیر نباید
PaymentAttempt یا Usage Billing سرور ابری را تغییر دهد.

## Providerها

- `Zibal`: Gateway Production پیش‌فرض
- `ZarinPal`: Gateway Production جایگزین
- `Mock`: فقط Development/Test

Customer Gateway را انتخاب نمی‌کند. Config پیش‌فرض Admin فقط Attemptهای جدید
را تحت تأثیر قرار می‌دهد.

## داده و Secret

`PaymentGatewayConfig` و Snapshot Attempt فاقد Secret هستند. Credential فقط در
Environment سرور قرار می‌گیرد:

- `ZIBAL_MERCHANT`, `ZIBAL_TIMEOUT_MS`
- `ZARINPAL_MERCHANT_ID`, `ZARINPAL_SANDBOX`, `ZARINPAL_TIMEOUT_MS`
- `PAYMENT_CALLBACK_BASE_URL`, `PAYMENT_BOOTSTRAP_DEFAULT_PROVIDER`

## رفتار Attempt

1. Customer مبلغ تومان را به `/api/wallet/topups` می‌فرستد؛ Server آن را صریح
   به ریال `BigInt` تبدیل می‌کند.
2. Top-up و Attempt شماره‌دار با Gateway و Amount/Currency قفل‌شده ساخته
   می‌شوند.
3. Callback مخصوص Gateway، Attempt قفل‌شده را Verify می‌کند.
4. Callback دیررس حتی پس از TTL محلی Verify می‌شود.
5. موفقیت Verify و Credit در Transaction سریال‌پذیر و Idempotent ثبت می‌شوند.
6. Callback تکراری/هم‌زمان فقط یک Ledger `TOP_UP` می‌سازد.
7. `FAILED/CANCELED/EXPIRED` قطعی، Attempt تازه می‌سازد و تاریخچه را حفظ می‌کند.
8. Timeout موقت به `RECONCILING` و Amount/Currency mismatch به Review می‌رود.
9. وضعیت `SUCCEEDED` هرگز Downgrade نمی‌شود.

## Admin Recovery

صف `/admin/payment-recovery` این Actionها را دارد:

- Reverify Gateway
- Reconcile Wallet Credit
- Mark Definitively Failed
- Controlled Refund

هر Action Role=ADMIN، Origin check، دلیل، Audit و Idempotency دارد. Gateway
reference، Attempt history و Ledger result نمایش داده می‌شوند؛ Secret و Raw
response نمایش داده نمی‌شوند.

Refund بانکی خودکار وجود ندارد. Refund کنترل‌شده دو مرحله دارد و Retry آن
Ledger دوم نمی‌سازد. اگر مبلغ شارژ مصرف شده باشد، Amount از Wallet رزرو/کسر
نمی‌شود مگر Review و تصمیم صریح Admin کامل شود.
