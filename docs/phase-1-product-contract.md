# قرارداد محصول فاز ۱ ابرچین

> وضعیت: **LOCKED — Wallet-first PAYG**
>
> این نسخه با فاز اصلاحی `1.R` به‌روزرسانی شده است. در تعارض با اسناد قدیمی،
> این سند و قرارداد صریح Founder درباره Wallet Billing مرجع محصول هستند.

## ۱. دامنه محصول

ابرچین لایه فروش، Billing و عملیات کنترل‌شده سرور است:

- آروان و پارس‌پک Providerهای اصلی فاز ۱ هستند.
- موجودی خود ابرچین Source مستقل و اختیاری است؛ Launch به آن وابسته نیست.
- Offer خام Provider خودکار منتشر نمی‌شود؛ Admin از Catalog، Plan قابل‌فروش
  می‌سازد.
- سرور ابری `CLOUD_SERVER` محصول `PAYG_WALLET` است.
- VPS یا Plan با دوره ثابت می‌تواند `PREPAID_TERM` باشد؛ Checkout، Invoice و
  Renewal آن از PAYG جدا است.
- هیچ Payment، Callback یا Wallet Credit مستقیماً Provider Mutation اجرا
  نمی‌کند.
- Provision اولیه و تغییر حساس Resource فقط پس از Admin Approval انجام
  می‌شود.
- Credential تا تأیید دوم Admin فقط در اختیار Admin است.

## ۲. چهار Domain مستقل

### ۲.۱ Wallet Top-up

```text
WalletTopUp
→ PaymentAttempt
→ Gateway Verify
→ Transactional Wallet Credit
```

- درگاه بانکی در جریان PAYG فقط Wallet را شارژ می‌کند.
- هر Top-up چند Attempt تاریخی دارد؛ Attempt ناموفق Overwrite نمی‌شود.
- Callback موفق پس از TTL محلی نیز Verify و پذیرفته می‌شود.
- Quote expiry یا تغییر قیمت Provider اثری بر پذیرش شارژ موفق ندارد.
- Verify و Credit Transactional، Concurrency-safe و Idempotent هستند.
- Callback تکراری فقط یک Ledger Credit می‌سازد.
- Timeout موقت وارد Reconcile می‌شود؛ Amount/Currency mismatch وارد Review.
- Payment موفق Downgrade نمی‌شود.
- Refund فقط Action کنترل‌شده Admin است. اگر مبلغ شارژ مصرف شده باشد، Refund
  خودکار ممنوع و Review الزامی است.

### ۲.۲ Customer Usage Billing

```text
Provider-confirmed Resource State
→ ResourceVersion
→ UsageInterval
→ BillingInvoice
→ Wallet Debit
```

- تمام مبلغ‌ها `BigInt` و بر مبنای ریال هستند؛ Float ممنوع است.
- زمان‌ها و مرز Settlement بر مبنای UTC هستند.
- ResourceVersion فقط از زمان تأیید موفق Provider مؤثر می‌شود.
- هر Billing Line به ResourceVersion و RateCardVersion معین متصل است.
- نرخ Provider و Markup درصدی Admin Snapshot می‌شوند؛ تغییر آینده Retroactive
  نیست.
- صورتحساب کامل مصرف ثبت می‌شود، حتی اگر Wallet کافی نباشد.
- Wallet منفی نمی‌شود؛ `paidAmount` و `OutstandingBalance` صریح ثبت می‌شوند.
- وضعیت Invoice شامل `PAID`، `PARTIALLY_PAID`، `UNPAID` و `UNDER_REVIEW` است.
- داده ناقص مبلغ جعلی تولید نمی‌کند و وارد Reconciliation/Review می‌شود.
- Adjustment رکورد و Ledger مستقل، دلیل، Audit و Idempotency دارد؛ Invoice
  قبلی Overwrite نمی‌شود.

### ۲.۳ Provider Billing Reconciliation

سه Source با هم مخلوط نمی‌شوند:

1. `RateCardVersion`: Estimate و Billing داخلی.
2. Resource State/Event: Timeline واقعی منابع.
3. Usage/Invoice: تطبیق هزینه Provider، فقط اگر API آن را پشتیبانی کند.

نبود Usage/Invoice API با `UNSUPPORTED` ثبت می‌شود و داده ساختگی تولید
نمی‌شود. اختلاف Provider، Wallet Customer را بی‌صدا تغییر نمی‌دهد. موجودی
حساب ابرچین نزد Provider نیز Wallet Customer نیست.

### ۲.۴ Provider Mutation

Create، Resize، Stop، Resume، Suspend و Terminate عملیات Provider هستند.
Mutation Gate فقط هنگام Dispatch واقعی بررسی می‌شود. Sale Gate، Wallet Top-up،
Estimate و Activation Request به بازبودن Mutation Gate وابسته نیستند.
Mutation خاموش می‌تواند به Fulfillment دستی و کنترل‌شده منجر شود؛ هیچ مسیر
خودکاری مجاز نیست.

## ۳. Billing Policy

سه بعد مستقل هستند:

- Availability: `HOURLY_ONLY`، `DAILY_ONLY`، `HOURLY_AND_DAILY`
- Calculation granularity: واحد محاسبه Provider مانند Second/Minute/Hour/Day
- Settlement cadence: `HOURLY` یا `DAILY`
- Display: `HOURLY`، `DAILY` یا `BOTH`

Policy با ترتیب زیر Resolve و Snapshot می‌شود:

```text
Global policy → Plan override → Service snapshot
```

- Planهای جدید Cloud به‌صورت پیش‌فرض Hourly هستند.
- Cadence سرویس فعال موجود بدون تصمیم صریح تغییر نمی‌کند.
- Buffer فعال‌سازی، Threshold کمبود موجودی و Grace Period تنظیم Admin هستند.
- حداقل اعتبار پیش‌فرض برابر Estimate بیست‌وچهار ساعت به‌علاوه One-time
  charges است.
- واحد و Currency Provider باید صریح Normalize شود؛ تومان/ریال حدس زده
  نمی‌شود.
- Rounding و Minimum Billing Unit در Adapter یا Policy همان Provider است.
- Markup فقط درصد Admin است. مالیات یا هزینه پنهان بدون تنظیم و قرارداد صریح
  اضافه نمی‌شود.
- Stop به‌صورت پیش‌فرض هزینه را صفر نمی‌کند؛ Disk، IP، Snapshot یا منابع
  رزروشده ممکن است Billable بمانند.
- پایان Billing هر جزء فقط پس از تأیید State مربوط از Provider ثبت می‌شود.

هزینه هر Period مجموع Intervalهای واقعی و Line Itemهای قابل‌اندازه‌گیری است:

```text
Compute intervals
+ Disk + IP + Backup + Traffic + Snapshot/Add-on
+ One-time charge
+ Admin markup
```

تغییر منابع یا Rate در میانه Period، Interval را Split می‌کند. هر بخش با
ResourceVersion و RateCardVersion مؤثر همان زمان محاسبه می‌شود.

## ۴. جریان Canonical سرور ابری

```text
Wallet Top-up
→ Resource Estimate
→ Activation Request
→ Admin Approval 1
→ Controlled Provision
→ Provider Confirmation
→ Billing Start
→ Admin Verification
→ Admin Approval 2
→ Secure Delivery
→ Hourly/Daily Wallet Settlement
→ Provider Reconciliation
```

جزئیات Customer:

1. Customer در Configurator منابع، Region و OS را انتخاب می‌کند.
2. Estimate نسخه‌دار ساعتی/روزانه و حداقل اعتبار نمایش داده می‌شود.
3. Customer در صورت کسری Wallet را شارژ می‌کند؛ موجودی کافی دوباره به Gateway
   هدایت نمی‌شود.
4. Activation Request ثبت می‌شود. هیچ مبلغ خرید یک‌باره از Wallet کسر و هیچ
   Provision اجرا نمی‌شود.
5. Admin اعتبار، Rate freshness، Availability و Snapshot را بررسی و Approval
   اول را ثبت می‌کند.
6. Dispatch خودکارِ Gateدار یا Fulfillment دستی دقیقاً یک Resource می‌سازد.
7. Billing فقط از `providerConfirmedAt/effectiveFrom` شروع می‌شود.
8. Resource و Credential ابتدا فقط برای Admin است.
9. Approval دوم، Delivery را فعال می‌کند؛ Secret فقط یک بار توسط مالک Reveal
   می‌شود.
10. Worker Period بسته را Idempotent Settlement می‌کند.

Quote فقط Estimate نسخه‌دار است. Quote منقضی پیش از Activation دوباره محاسبه
می‌شود، اما Callback موفق Wallet Top-up را رد نمی‌کند.

## ۵. تغییر منابع

```text
Change Request
→ New Estimate
→ Credit Buffer Check
→ Admin Approval
→ Provider Mutation
→ Provider Confirmation
→ Close previous ResourceVersion
→ Create new ResourceVersion
→ Future Billing with new Rate
```

- Upgrade با اعتبار ناکافی Block می‌شود.
- Downgrade امن به‌دلیل کمبود موجودی Block نمی‌شود.
- زمان درخواست Customer زمان اثر Billing نیست.
- Retry یا Worker هم‌زمان نباید Mutation یا ResourceVersion تکراری بسازد.

## ۶. Dunning و Lifecycle

- Low Balance و Runway پیش از صفرشدن محاسبه و Notification ثبت می‌شود.
- مصرف کامل در Invoice باقی می‌ماند؛ Wallet بی‌صدا منفی نمی‌شود.
- پس از Grace، پرونده `SUSPENSION_REVIEW` برای Admin ساخته می‌شود.
- Suspend نیازمند Confirmation، Authorization، Audit و Idempotency است.
- Suspend یا Stop فقط پس از Confirmation Provider روی Timeline و Billing اثر
  می‌گذارد.
- Delete/Terminate خودکار به علت کمبود موجودی در فاز ۱ ممنوع است.
- Terminate دستی نیز Billing اجزای باقی‌مانده مانند Disk/IP/Snapshot را بدون
  تأیید Provider متوقف نمی‌کند.

## ۷. State Machineهای مالی و عملیاتی

### Wallet Top-up

```text
CREATED → PENDING → SUCCEEDED
                  ↘ REVIEW / RECONCILING
CREATED/PENDING → FAILED | CANCELED | EXPIRED → new immutable Attempt
```

### Activation

```text
CREDIT_REQUIRED
→ WAITING_ADMIN_APPROVAL
→ APPROVED
→ PROVISIONING
→ PROVIDER_CONFIRMED
→ WAITING_DELIVERY_APPROVAL
→ ACTIVE
```

### Resource Change

```text
REQUESTED / CREDIT_REQUIRED
→ WAITING_ADMIN_APPROVAL
→ APPROVED
→ PROVIDER_MUTATION_PENDING
→ PROVIDER_CONFIRMED
→ APPLIED
```

### Billing

```text
UsageInterval
→ CALCULATING
→ PAID | PARTIALLY_PAID | UNPAID | UNDER_REVIEW
→ Reconciliation / Adjustment
```

## ۸. Admin Operations Center

صف‌های الزامی:

- Wallet Top-up Payment Review
- Wallet Credit Reconciliation
- Activation Request منتظر Approval اول
- Provision Retry/Reconcile
- Resource Change منتظر Approval
- Delivery منتظر Approval دوم
- Low Balance
- Unpaid/Partially Paid Invoice
- Suspension Review
- Provider Billing Reconciliation
- Controlled Refund
- Connection Check Failure

`FUNDING_CONFIRMED` در صف Approval اول نیست. `DELIVERED` و `ACTIVE` در صف
Delivery نیستند. هر Action دارای Authorization، دلیل، Audit و Idempotency است.

Connection Health آروان فقط از آخرین GET شبکه‌ای Read-only و Authenticated
معتبر خوانده می‌شود. Allowlist Region Configuration است، نه اثبات سلامت.

## ۹. Sale Gate و Mutation Gate

- Sale Gate فقط Public sale، Product availability، Rate freshness، Provider
  availability و Estimate را کنترل می‌کند.
- Sale روشن و Mutation خاموش اجازه Estimate، Wallet Top-up و Activation
  Request می‌دهد.
- Mutation روشن بدون Admin Approval اجازه Dispatch نمی‌دهد.
- Mock Provider یا Gateway در Production Healthy یا Sellable نیست.
- موجودی ابرچین Provider/Source مستقل است و شرط Launch نیست.

## ۱۰. Credential و Delivery

- Credential با AES-256-GCM و Secret بیرون Repository نگهداری می‌شود.
- قبل از Approval دوم، Customer هیچ Secret یا IP حساس دریافت نمی‌کند.
- Reveal مالکیت سخت‌گیرانه و Transaction اتمیک Consume+Audit دارد.
- شکست Audit مصرف Secret را Rollback می‌کند.
- نتیجه Retryable با Receipt دائمی Replay نمی‌شود.
- دو Approval هم‌زمان فقط یک Delivery و Notification می‌سازند.
- Secret در Log، Error، Audit Metadata، Snapshot یا تست قرار نمی‌گیرد.

## ۱۱. PREPAID_TERM

VPS یا Plan دوره‌ثابت می‌تواند Checkout و Renewal دستی مستقل داشته باشد.
این مسیر:

- از Wallet Top-up و PAYG Usage Invoice جدا است؛
- Auto-renew یا Auto-charge ندارد؛
- همان دو Admin Gate، Idempotency و Credential policy را رعایت می‌کند؛
- نباید UI ماهانه یا Renewal را برای `CLOUD_SERVER/PAYG_WALLET` نمایش دهد.

## ۱۲. Definition of Done

فاز ۱ از نظر Local Engineering وقتی آماده تست کنترل‌شده است که:

- Migration تازه و Upgrade روی PostgreSQL واقعی پاس شوند.
- Wallet Credit، Refund، Billing Settlement، Adjustment و Admin commandها
  در Retry/Concurrency تکراری نشوند.
- Mid-period Resource/Rate change فقط آینده را تغییر دهد.
- کمبود موجودی Invoice و Outstanding را حفظ و Delete خودکار اجرا نکند.
- Sale و Mutation مستقل باشند.
- آروان و پارس‌پک بدون Credential واقعی Fail-closed بمانند.
- دو Approval و Reveal یک‌بارمصرف با تست PostgreSQL پاس شوند.
- اسناد و UI، Cloud Server را Wallet-first PAYG نشان دهند.

Deploy، Payment واقعی، Provider Mutation واقعی، Refund بانکی و Founder Smoke
مجوز جداگانه می‌خواهند و با سبزبودن Local Gateها مجاز نمی‌شوند.
