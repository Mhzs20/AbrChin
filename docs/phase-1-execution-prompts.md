# پرامپت‌های اجرای فاز ۱ — Wallet-first PAYG

> این نسخه پس از فاز اصلاحی `1.R` نوشته شده است. Flow قدیمی پرداخت مستقیم
> Cloud Order، قیمت ماهانه Cloud و Provision بعد از Callback منسوخ است.
>
> ترتیب اجرا حفظ می‌شود: `1.1 → 1.2 → ... → 1.10`.

## قواعد مشترک

- فقط روی `main` کار کن؛ هر زیر‌فاز Commit و Push مستقل دارد.
- Secret، Payment/Refund واقعی، Provider Mutation واقعی و Deploy ممنوع است.
- آروان و پارس‌پک Providerهای اصلی‌اند؛ Inventory ابرچین اختیاری است.
- `CLOUD_SERVER` برابر `PAYG_WALLET` است.
- Gateway فقط `WalletTopUp/PaymentAttempt` را شارژ می‌کند.
- Callback/Wallet Credit هیچ Provision یا Resource Change اجرا نمی‌کند.
- Approval اول Admin پیش‌نیاز Provision و Approval دوم پیش‌نیاز Delivery است.
- Credential قبل از Approval دوم فقط برای Admin است.
- تمام Amountها ریال `BigInt` و تمام Billing timestampها UTC هستند.
- Retry/Concurrency مالی، Provision، Delivery و Reconcile باید Idempotent باشد.
- Plan دوره‌ثابت `PREPAID_TERM` مسیر جدا دارد و با Usage Billing Cloud مخلوط
  نمی‌شود.

## 1.1 — Baseline و قرارداد

Git/Remote، Schema، Migrationها، Env، Test harness و اسناد را بررسی کن.
Flow مرجع را ثبت کن:

```text
Wallet Top-up
→ Estimate
→ Activation Request
→ Admin Approval 1
→ Controlled Provision
→ Provider Confirmation / Billing Start
→ Admin Approval 2
→ Secure Delivery
→ Wallet Settlement
→ Reconciliation
```

معیار: هیچ Flow مستند یا Runtime نباید Cloud را خرید یک‌باره/ماهانه بداند.

## 1.2 — Provider Connection و Catalog

- Connection Check آروان GET احرازشده، Read-only و بدون هزینه است.
- Allowlist Region فقط Configuration است.
- Auth/403/429/Timeout/Payload/Network جدا و Sanitized هستند.
- Catalog/Rate/Availability نسخه‌دار Persist می‌شوند؛ هیچ Auto-publish.
- Currency و Amount Unit صریح Normalize می‌شوند.

معیار: Mock یا Allowlist، Production Healthy گزارش نشود.

## 1.3 — Plan، Rate و Billing Policy

- Policy hierarchy: Global → Plan → Service Snapshot.
- Availability: Hourly only / Daily only / Both.
- Calculation Unit، Settlement Cadence و Display Mode مستقل.
- Plan جدید Cloud پیش‌فرض Hourly.
- Service فعال موجود Non-retroactive.
- RateCardVersion و Markup percentage Snapshot شوند.

معیار: Rate/Markup جدید مصرف قبلی را تغییر ندهد.

## 1.4 — Storefront و Estimate

- Storefront → Configurator واقعی.
- Resource/Region/OS/Access انتخاب و سمت Server Validate شوند.
- Estimate ساعتی و ۲۴ساعته، حداقل اعتبار و One-time charge نمایش داده شوند.
- برچسب تخمینی و امکان Traffic/Add-on نهایی روشن باشد.
- Quote منقضی پیش از Activation دوباره محاسبه شود.

معیار: Backend بدون Estimate معتبر Activation نسازد.

## 1.5 — Wallet Top-up و Recovery

- Top-up چند Attempt immutable دارد.
- Callback دیررس Verify می‌شود.
- Credit Transactional و Idempotent است.
- Timeout → Reconcile؛ Amount/Currency mismatch → Review.
- Payment موفق Downgrade نمی‌شود.
- Refund کنترل‌شده، Audit‌شده و بدون Double Ledger است.

معیار: Callback تکراری/هم‌زمان فقط یک Credit بسازد.

## 1.6 — Activation و Approval اول

- Wallet حداقل Buffer قابل تنظیم را داشته باشد.
- Activation Request هیچ Debit خرید و هیچ Provider Job نسازد.
- Admin Queue فقط `WAITING_ADMIN_APPROVAL` را نشان دهد.
- Approval اول Auth/Audit/Idempotency دارد.
- Sale و Mutation مستقل باشند.

معیار: Mutation روشن بدون Approval و Payment موفق بدون Approval هیچ Dispatch
نسازند.

## 1.7 — Provision و Resource Timeline

- Dispatch فقط پس از Approval اول و Mutation Gate بررسی می‌شود.
- Mutation خاموش به Fulfillment دستی کنترل‌شده می‌رود.
- Confirmation Provider، Billing start و ResourceVersion می‌سازد.
- Resize/Stop/Resume/Terminate هر کدام Event و ResourceVersion/Interval قابل
  Audit دارند.
- Timeout ابتدا Reconcile می‌شود و Create تکرار نمی‌شود.

معیار: ResourceVersion فقط از Provider Confirmation مؤثر باشد.

## 1.8 — Billing Worker و Dunning

- Period بسته با Intervalهای Split شده محاسبه شود.
- Invoice و Ledger در Retry/Concurrency تکراری نشوند.
- Wallet ناکافی Invoice کامل، Partial/Unpaid و Outstanding بسازد.
- Usage ناقص Review بسازد، نه Amount جعلی.
- Low Balance/Runway/Grace تنظیم Admin باشند.
- Suspend فقط Action Admin؛ Auto-delete/terminate ممنوع.

معیار: Mid-period resource/rate change و Stop component policy روی PostgreSQL
واقعی تست شوند.

## 1.9 — Delivery، Credential و Operations Center

- Retryable Delivery receipt دائمی نسازد.
- Approval دوم هم‌زمان فقط یک Delivery/Notification بسازد.
- Reveal مالکیت‌دار، اتمیک و یک‌بارمصرف باشد.
- Queueهای Wallet review/reconcile، Activation، Provision recovery، Resource
  change، Delivery، Low Balance، Invoice، Suspension، Provider billing,
  Refund و Connection failure Action واقعی داشته باشند.

معیار: `FUNDING_CONFIRMED` در Approval اول و `DELIVERED/ACTIVE` در Approval
دوم نباشند.

## 1.10 — اسناد، Preflight و Founder handoff

- Prisma format/validate، Fresh migration و Upgrade fixture.
- Lint، Typecheck، Unit/Integration، Production Build.
- Payment recovery، Wallet/Billing idempotency/concurrency، Sale/Mutation،
  Delivery/Credential، Admin queues و Connection Check.
- Secret scan، نبود `.github/workflows` و نبود Route بن‌بست.
- اسناد و Customer/Support text با Wallet-first سازگار باشند.

حکم نهایی Local باید جدا از Founder Smoke، Provider Production، Deploy و Public
Sale گزارش شود.
