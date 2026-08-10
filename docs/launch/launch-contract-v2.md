# قرارداد Canonical Launch V2 ابرچین

وضعیت: `LOCKED — Founder decision 2026-08-10`
دامنه: فروش عمومی `PREPAID_TERM` و Fulfillment دستی؛ PAYG فقط Legacy/Internal
پیش‌فرض اجباری: `PUBLIC_SALE_ENABLED=true` و Gateهای فروش منبع/Provider باز؛ Provider mutation خاموش

## تقدم قرارداد

این سند Amendment لانچ برای `docs/phase-1-product-contract.md` است. هرجا متن قدیمی Cloud را Wallet-first PAYG عمومی معرفی می‌کند، برای Launch V2 این سند مقدم است. Domainهای PAYG، Billing و Reconciliation حذف یا Rewrite نمی‌شوند؛ فقط از Golden Path عمومی خارج‌اند.

## مسیرهای رسمی

| مسئولیت | مسیر Canonical | وضعیت مسیر موازی |
| --- | --- | --- |
| Discovery/Catalog | `/` و `/cloud-servers` | `/ready-servers` تا پایان Deprecation فقط Compatibility |
| Guest Quote | `/cloud-servers/quote/:id` | Recommendation/Ready quoteها برای History/Claim حفظ می‌شوند |
| Quote mutation | `POST /api/cloud-servers/quotes` و `POST .../:id/refresh` | GET اجازه Refresh یا ساخت Quote ندارد |
| Claim/Auth | Recommendation session claim + Login/Register | Password-based purchase حفظ می‌شود |
| Order | `POST /api/orders` با `quoteId` | ساخت مستقیم با plan عملاً با delivery configuration بسته است |
| Wallet checkout | `POST /api/orders/:id/pay-with-wallet` | Gateway order-payment فقط recovery/legacy؛ Top-up مسیر Wallet است |
| Admin fulfillment | `/admin/infrastructure/orders/:id` + `fulfill-manually` | `manual-delivery` بازنشسته و نباید shortcut Delivery باشد |
| Delivery | `approve-delivery` پس از Credential review | هیچ Credential پیش از Approval دوم به Customer نمی‌رسد |

## State machines و CTA

### Quote و Claim

| State | Owner/Page | CTA مجاز | خطا / Next |
| --- | --- | --- | --- |
| `ACTIVE` | Guest، Quote | انتخاب OS/Period/Parchin، Login/Claim | Expiry/stock/price → Refresh صریح یا Catalog |
| `SELECTED` | Guest/User، Quote | Claim یا Create Order | Ownership mismatch → Login صحیح |
| `CONVERTED` | User، Order | مشاهده Order | ساخت Order دوم ممنوع |
| `EXPIRED` | Guest/User | دریافت Quote تازه | مبلغ قبلی Rewrite نمی‌شود |
| `INVALIDATED` | System/Admin | بازگشت به Catalog | علت unavailable/price/stock نمایش داده می‌شود |

### Order، Wallet و Payment

| State | Owner/Page | CTA مجاز | خطا / Next |
| --- | --- | --- | --- |
| `DRAFT` | User، Checkout | بررسی Snapshot | Quote نامعتبر → recovery |
| `PENDING_PAYMENT` | User، Checkout | Top-up کسری، ادامه پرداخت، Retry، Cancel | Retry با idempotency؛ Order/Debit تکراری ممنوع |
| `PAID` | Admin/User، Order | Admin Review؛ Customer Track/Cancel request | هیچ Provider dispatch مستقیم |
| `CANCELED` | User/Admin | مشاهده Ledger/علت | Refund در صورت Debit فقط با Ledger |
| `REFUNDED` | User/Admin | مشاهده Receipt/Timeline | Terminal؛ Snapshot محفوظ |

Top-up و Order Payment وضعیت‌های `CREATED → PENDING → SUCCEEDED` و شاخه‌های `REVIEW/FAILED/CANCELED/EXPIRED` دارند. Callback موفق Idempotent است؛ `SUCCEEDED` Downgrade نمی‌شود و پرداخت مبهم وارد Review می‌شود.

### Manual Fulfillment و Instance

| حالت ترکیبی | Owner/Page | CTA مجاز | Next |
| --- | --- | --- | --- |
| `WAITING_ADMIN_FUNDING` | Admin Ops | Approval اول / Hold / Reject+Refund | `FUNDING_CONFIRMED` |
| `FUNDING_CONFIRMED` | Admin fulfillment | ثبت دستی مشخصات منطبق با Snapshot | `QUEUED/PROVISIONING` |
| `QUEUED/PROVISIONING` | Admin/Worker | Retry/Reconcile یا Fulfill manually | `ACTIVE` یا `NEEDS_RECONCILIATION/FAILED` |
| `WAITING_DELIVERY_APPROVAL` ترکیبی | `InfrastructureOrder.ACTIVE` + `Credential.READY` + `SecureDelivery.PENDING` | Review Credential، Approval دوم / Hold | Delivery `DELIVERED` و Instance قابل مشاهده |
| `ACTIVE` | Customer panel | Reveal یک‌بار، Renewal/Upgrade/Cancel request | lifecycle کنترل‌شده |
| `FAILED/NEEDS_RECONCILIATION` | Admin Ops | Evidence، Retry/Reconcile/Refund | هر اقدام Idempotent و Audited |

برای `WAITING_DELIVERY_APPROVAL` Migration جدید لازم نیست؛ mapping ترکیبی بالا رفتار موجود را بدون بازنویسی تاریخچه قطعی می‌کند.

### Credential

`READY → REVEALED → EXPIRED/REVOKED`؛ Secure Delivery مستقل `PENDING → DELIVERED/FAILED` است. Customer فقط پس از Approval دوم و کنترل Ownership می‌تواند Reveal اتمیک Consume+Audit انجام دهد. Secret در Log، Error، Notification، Audit metadata یا Screenshot ممنوع است.

### Cancel و Refund

`REQUESTED → REVIEW_REQUIRED → APPROVED → COMPLETED` یا `REJECTED`. قبل از Delivery، Customer CTA لغو دارد. پس از Delivery، Preview باید اثر دوره و مصرف را نشان دهد. برگشت پول فقط با Ledger `REFUND`/`TOP_UP_REFUND` و idempotency key انجام می‌شود؛ Order/Quote تاریخی Rewrite نمی‌شوند.

## سیاست Gate

تصمیم Sale در Production به ترتیب `PUBLIC_SALE_ENABLED → Provider/source sale gate → Product/region/catalog freshness` است. طبق تصمیم Founder در ۲۰۲۶-۰۸-۱۰، Master Sale و Gateهای فروش Source در Deploy و Rollback باز می‌مانند؛ حفاظت از فروش نامعتبر با Publish کنترل‌شده Admin، موجودی، Region و تازگی قیمت انجام می‌شود. هر Quote و Order باید Snapshot نسخه‌دار پرچین داشته باشد و تأیید نهایی تحویل، قرارداد و صف عملیات همان سرور را فعال کند. Provider Mutation مستقل است و پیش از اولین درخواست شبکه‌ای non-GET Fail-closed می‌شود. Read-only Discovery/Catalog/GET هیچ Business mutation ندارد و پرداخت نیز مستقیماً Provider write اجرا نمی‌کند.

## Deprecation بدون حذف تاریخچه

1. مسیرهای Canonical در UI و اسناد تنها CTA اصلی می‌شوند.
2. مسیرهای Legacy برای Claim، Ownership و تاریخچه فعال اما بدون لینک ورودی جدید می‌مانند.
3. Telemetry داخلی تعداد استفاده Legacy را می‌سنجد، بدون ذخیره Secret.
4. حذف Route فقط پس از صفرشدن استفاده، Migration/redirect plan و تأیید Founder انجام می‌شود.
