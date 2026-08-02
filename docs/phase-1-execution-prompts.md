# فازبندی اجرایی فاز ۱ ابرچین و پرامپت‌های Codex

نسخه: ۱.۰  
تاریخ: ۲۰۲۶-۰۸-۰۲  
Repository: `Mhzs20/AbrChin`  
مبنای Repository: `main@8cf72459c5340c4358d75d2de883bec2d74327b1`

## مرجع و قواعد استفاده

این سند فاز محصول جدیدی تعریف نمی‌کند. همه مراحل زیر، زیر‌فازهای اجرایی همان **فاز ۱ قفل‌شده ابرچین** هستند.

ترتیب مرجع تصمیم‌ها:

1. `docs/phase-1-product-contract.md` — Source of Truth قفل‌شده محصول
2. `AGENTS.md` — قواعد دائمی اجرای Repository
3. مستندات پشتیبان فعلی، از جمله معماری چند Provider، اتصال پارس‌پک، پرداخت، OTP، کیف پول و Launch Runbook
4. کد فعلی Repository

اگر سند قدیمی یا کد فعلی با قرارداد قفل‌شده فاز ۱ تعارض داشت، قرارداد فاز ۱ مقدم است. به‌ویژه پرداخت موفق نباید مستقیم Provision را اجرا کند و تحویل به Customer بدون تأیید دوم Admin ممنوع است.

هر زیر‌فاز بعد از Commit زیر‌فاز قبلی اجرا می‌شود. موازی‌سازی این مراحل مجاز نیست، چون همه آن‌ها روی یک مسیر مالی و Order State Machine مشترک کار می‌کنند.

## خلاصه فازبندی

| شماره | عنوان | پوشش قرارداد | خروجی نهایی |
|---|---|---|---|
| 1.1 | مرکز عملیات Admin | P1-01 | Admin قابل‌فهم با آمادگی فروش و Action Queue واقعی |
| 1.2 | اتصال سرویس‌ها | P1-02 | Connection Check واقعی آروان، پارس‌پک، کاوه‌نگار و درگاه |
| 1.3 | Catalog و SKU | P1-03 + P1-04 | Sync واقعی، Mapping، Markup و انتشار کنترل‌شده SKU |
| 1.4 | فروشگاه و Quote | P1-05 | SKU واقعی قابل خرید و Quote ده‌دقیقه‌ای امن |
| 1.5 | OTP و پرداخت یک‌مرحله‌ای | P1-06 | پرداخت واقعی تا `Waiting Admin Provision Approval` بدون کلیک دوم |
| 1.6 | گیت اول Admin | P1-07 | بررسی هزینه/موجودی/Balance و تأیید کنترل‌شده Provision |
| 1.7 | Provision و Fulfillment | P1-08 | ساخت/تخصیص دقیقاً یک Resource و ثبت امن Credential |
| 1.8 | گیت دوم و پنل Customer | P1-09 + P1-10 | تأیید تحویل، سرویس فعال و Credential امن برای Customer |
| 1.9 | بازیابی خطا و Audit | P1-11 | Needs Attention، Retry/Reconcile، Refund و Audit قابل اتکا |
| 1.10 | خرید Founder و Launch | Definition of Done | یک فروش واقعی کامل، رفع ایراد و فعال‌سازی کنترل‌شده فروش |

---

## فاز 1.1 — مرکز عملیات Admin

### هدف

تبدیل Admin از مجموعه‌ای از صفحات و داده‌های فنی پراکنده به ابزار عملیات فروش که در اولین نگاه وضعیت آمادگی فروش و اقدام بعدی را نشان دهد.

### پرامپت آماده Codex

```text
پروژه: AbrChin
Repository: Mhzs20/AbrChin
تسک: ABR-P1.1 — Admin Operations Center

این تسک را مستقیم روی main انجام بده. Branch، Worktree و PR نساز. GitHub Actions یا CI/CD ایجاد یا اجرا نکن. ابتدا آخرین main را بگیر و فایل‌های AGENTS.md و docs/phase-1-product-contract.md را کامل بخوان. اگر کد یا مستند قدیمی تعارض داشت، قرارداد فاز ۱ مقدم است. تغییرات نامرتبط کاربر را حفظ کن و Reset نکن.

هدف این تسک فقط بازطراحی معماری اطلاعات و Dashboard پنل Admin به یک مرکز عملیات فروش قابل‌فهم است. از اجزای فعلی Reuse کن و Backend یا Feature موازی نساز.

پیاده‌سازی لازم:
1. Navigation اصلی Admin را روی این هفت بخش منظم کن: مرکز عملیات، اتصال سرویس‌ها، Catalog Providerها، SKUهای ابرچین، سفارش‌ها و تحویل، پرداخت‌ها و مشتریان، تنظیمات پیشرفته.
2. Dashboard اصلی را به وضعیت‌های واقعی متصل کن و فقط این موارد را در اولویت نشان بده: اتصال Arvan، اتصال ParsPack، OTP، Payment Gateway، تعداد SKU منتشرشده با قیمت معتبر، تعداد Order منتظر تأیید Provision، تعداد Order منتظر تأیید Delivery و Needs Attention.
3. برای هر وضعیت یک اقدام بعدی واضح و لینک مستقیم به صفحه مربوط نشان بده؛ کارت تزئینی یا آمار بدون اقدام نساز.
4. Action Queue واقعی برای سفارش‌های منتظر Provision Approval، Delivery Approval و Needs Attention بساز یا داده فعلی را در همین ساختار نمایش بده.
5. Raw Payload، Request ID، Sync Lease، Region Error و جزئیات تشخیصی را از Dashboard اصلی بردار و زیر Advanced نگه دار؛ داده را حذف نکن.
6. اصطلاحات UI را برای Founder قابل‌فهم کن، اما نام وضعیت‌های فنی و داده‌های Audit را در Backend بی‌دلیل تغییر نده.
7. Responsive و RTL فعلی را حفظ کن و مسیر Customer و Admin را دوباره با هم مخلوط نکن.

مرز تسک:
- در این مرحله اتصال جدید Provider، Sync جدید، Payment flow یا Provisioning پیاده‌سازی نکن.
- داده نمایشی یا Fake status اضافه نکن؛ اگر داده‌ای موجود نیست، وضعیت واقعی «تنظیم نشده» یا «نیازمند اقدام» نشان بده.
- Refactor سراسری و تغییر Design System خارج از نیاز این صفحه ممنوع است.

معیار پذیرش:
- Founder از صفحه اول Admin بفهمد فروش چرا آماده نیست و دقیقاً کجا باید برود.
- Queueهای سه‌گانه از داده واقعی ساخته شوند.
- جزئیات فنی مزاحم از سطح اول حذف ولی در Advanced قابل دسترس باشند.
- Admin authorization فعلی تضعیف نشود.

فقط تست حیاتی مرتبط با Admin authorization و صحت Queryهای Action Queue را اجرا یا اضافه کن. Full suite، Snapshot و Visual test اجرا نکن. سپس تغییرات را روی main Commit و Push کن و فقط گزارش بده: چه چیزی ساخته شد، Commit SHA، تست حیاتی، Risk واقعی باقی‌مانده، روش تست Founder و اینکه Deploy انجام نشده است.
```

---

## فاز 1.2 — اتصال سرویس‌ها و Capabilityها

### هدف

وصل‌کردن واقعی آروان، پارس‌پک، کاوه‌نگار و Payment Gateway با Secretهای Environment و نمایش Masked status و Connection Check واقعی در Admin.

### پرامپت آماده Codex

```text
پروژه: AbrChin
Repository: Mhzs20/AbrChin
تسک: ABR-P1.2 — Provider and Service Connections

مستقیم روی main کار کن؛ Branch، Worktree، PR و GitHub Actions ممنوع است. ابتدا main را به‌روز کن و AGENTS.md، docs/phase-1-product-contract.md، docs/parspack-cloud-server-integration.md، docs/auth-and-sms.md و docs/payment-flow.md را کامل بخوان. این تسک پس از ABR-P1.1 اجرا می‌شود و باید UI مرکز عملیات موجود را تکمیل کند.

هدف: صفحه «اتصال سرویس‌ها» باید وضعیت واقعی چهار اتصال Arvan، ParsPack، Kavenegar و Payment Gateway را نشان دهد و برای هرکدام Connection Check امن و واقعی داشته باشد.

پیاده‌سازی لازم:
1. Secretها فقط از Environment خوانده شوند؛ هیچ Secret در Database، Git، Client response، Log یا Admin UI ذخیره/نمایش داده نشود.
2. Admin برای هر اتصال فقط وضعیت تنظیم‌شدن Masked، آخرین زمان Check، نتیجه موفق/ناموفق و Error قابل‌فهم و Sanitized ببیند.
3. Connection Check واقعی و فقط Admin بساز: ParsPack و Arvan با endpoint خواندنی و بدون Mutation؛ Kavenegar بدون افشای API key و بدون ارسال OTP ساختگی در Production؛ Payment Gateway با اعتبارسنجی Configuration و در صورت وجود روش رسمی امن، Probe غیرمالی.
4. Capabilityهای هر Provider را به‌صورت واقعی ثبت/نمایش بده: Catalog، Price، Balance و Provision. Unsupported یا Unverified را صریح نشان بده و حدس نزن.
5. برای Arvan و ParsPack خطای Auth، Timeout، Contract mismatch و unavailable را جدا و Sanitized نگه دار.
6. Readiness checklist مرکز عملیات را به نتیجه واقعی این اتصال‌ها وصل کن.
7. .env.example و .env.production.example را فقط با نام متغیرهای لازم و توضیح امن همگام کن؛ مقدار Secret وارد نکن.

قواعد حیاتی:
- هیچ Connection Check نباید VM بسازد، حذف کند، کیف پول Provider را شارژ کند یا Sale/Mutation gate را فعال کند.
- ParsPack و Arvan منابع اصلی‌اند و هیچ‌کدام حذف یا به منبع فرعی تقلیل داده نشوند.
- Secret Manager قابل ویرایش داخل Admin نساز.
- اگر endpoint رسمی یا قرارداد یک Capability موجود نیست، آن Capability را Unverified/Manual اعلام کن؛ endpoint حدسی نساز.

معیار پذیرش:
- Founder در یک صفحه بفهمد کدام کلید تنظیم است، اتصال واقعاً کار می‌کند یا نه و Provider چه قابلیت تأییدشده‌ای دارد.
- هیچ Secret یا Header حساس در Response، UI، Log، Audit یا Error وجود نداشته باشد.
- Connection Checkها فقط برای ADMIN قابل اجرا باشند.

فقط تست‌های حیاتی Admin authorization و عدم افشای Secret را اجرا کن؛ برای Providerها Probe خواندنی موجود را اجرا کن فقط اگر Credential محیط حاضر است، و نبود Credential را Failure پیاده‌سازی تلقی نکن. Commit و Push مستقیم روی main و گزارش نهایی مطابق AGENTS.md؛ Deploy نکن.
```

---

## فاز 1.3 — Catalog واقعی و مدیریت SKU

### هدف

دریافت و نرمال‌سازی Catalog و Price آروان و پارس‌پک، سپس ساخت SKUهای ابرچین با Mapping، Markup و انتشار دستی Admin؛ بدون Auto-publish.

### پرامپت آماده Codex

```text
پروژه: AbrChin
Repository: Mhzs20/AbrChin
تسک: ABR-P1.3 — Provider Catalog and AbrChin SKU Management

این تسک را مستقیم و فقط روی main انجام بده. ابتدا AGENTS.md، قرارداد قفل‌شده فاز ۱، معماری چند Provider، اتصال پارس‌پک و مدل‌های Prisma/سرویس‌های Catalog و Pricing موجود را کامل بخوان. کد موجود را Reuse کن؛ Branch، Worktree، PR، GitHub Actions و بازنویسی نامرتبط ممنوع است.

هدف خروجی: Admin بتواند Catalog و قیمت واقعی Arvan و ParsPack را Sync کند، Offer خام را ببیند، یک Offer منتخب را به SKU ابرچین Map کند، Markup بگذارد و فقط با اقدام دستی Publish کند.

پیاده‌سازی لازم:
1. Sync خواندنی و Idempotent هر Provider را کامل و پایدار کن؛ Plan/Region/Resources/Image/Price/Availability/Freshness و Error state را Normalize و Persist کن.
2. خطای یک Provider یا Region نباید Last-known-good سالم Provider/Region دیگر را خراب یا رکورد تاریخی را Hard Delete کند.
3. واحد پول و Amount Unit را حدس نزن. ParsPack یا Arvan بدون قرارداد معتبر قیمت، Catalog قابل مشاهده ولی غیرقابل فروش باشد.
4. Catalog خام هیچ SKU یا Plan فروشگاهی را Auto-publish نکند.
5. مدیریت SKU را حول این مدل بساز: Source، Provider Item ID، عنوان مشتری، vCPU/RAM/Disk/Region/OS، Provider cost، Provider default markup، SKU override، Sale/Renewal price، delivery estimate، status و last verification.
6. محاسبات پول فقط Integer/BigInt و بدون Float باشد؛ Preview قیمت و Margin برای Admin نمایش داده شود.
7. وضعیت‌های Draft، Published، Paused و Archived و اقدامات صریح Publish/Pause/Archive را پیاده کن.
8. AbrChin Inventory را به‌عنوان Source قابل پشتیبانی با Inventory count نگه دار، اما برای Launch داده یا موجودی جعلی نساز و آن را پیش‌فرض نکن.
9. Source واقعی در Admin و Snapshot داخلی قابل ردیابی باشد؛ نام Provider در Customer UI لازم نیست نمایش داده شود.

معیار پذیرش:
- Sync تکراری Duplicate ایجاد نکند.
- یک Offer واقعی هر Provider قابل تبدیل به SKU Draft باشد.
- فقط Admin بتواند Markup و Publication state را تغییر دهد.
- SKU بدون قیمت معتبر، Availability معتبر یا Mapping کامل Published/sellable نشود.
- تغییر Catalog، Quote/Order تاریخی را بازنویسی نکند.

فقط تست حیاتی مرتبط با Integer pricing، Sync idempotency و جلوگیری از Auto-publish/Oversell را اجرا یا اضافه کن. تست گسترده و نمایشی ممنوع. Commit و Push مستقیم main؛ گزارش کوتاه شامل SHA، تست، Risk، روش تست Founder و عدم Deploy.
```

---

## فاز 1.4 — فروشگاه و Quote

### هدف

نمایش فقط SKUهای واقعی و قابل‌فروش، ساخت Quote ده‌دقیقه‌ای با Snapshot کامل و رساندن Customer به یک CTA روشن برای خرید.

### پرامپت آماده Codex

```text
پروژه: AbrChin
Repository: Mhzs20/AbrChin
تسک: ABR-P1.4 — Storefront and Quote

مستقیم روی main کار کن. AGENTS.md، قرارداد فاز ۱، کد فعلی ready-servers/cloud-servers/recommendation/quote و خروجی ABR-P1.3 را ابتدا بخوان. Branch، Worktree، PR، GitHub Actions، Refactor نامرتبط و توسعه AI/Compass جدید ممنوع است.

هدف: Customer فقط SKUهای Published، Available و دارای قیمت تازه و معتبر را ببیند و با یک CTA به Quote نهایی ده‌دقیقه‌ای برسد.

پیاده‌سازی لازم:
1. مسیر عمومی فروش را بر SKUهای واقعی ABR-P1.3 متصل کن و داده Mock، Plan آزمایشی و مسیر ناقص را از دسترس فروش Production حذف یا مخفی کن.
2. صفحه مشخصات هر SKU منابع، Region، OSهای مجاز، قیمت فروش، قیمت تمدید و زمان تقریبی تحویل را واضح نشان دهد؛ Provider cost، Markup و نام Provider را به Customer افشا نکند.
3. Quote با اعتبار پیش‌فرض ۱۰ دقیقه بساز و Snapshot کامل SKU، Source داخلی، Configuration، Provider cost، Markup، sale price، availability/freshness و expiresAt را Persist کن.
4. قبل از صدور Quote، Published status، Price contract و Availability همان Selection را هدفمند Revalidate کن؛ Full Catalog Sync را از Request مشتری اجرا نکن.
5. Quote منقضی یا دارای Price/Availability تغییرکرده را Fail-closed کن و Quote تازه Customer-safe پیشنهاد بده؛ Quote قبلی و تاریخچه را بازنویسی نکن.
6. مهمان بتواند Quote بسازد و بعد از OTP همان Quote/Session به Account متصل شود.
7. اگر پیشنهادگر موجود استفاده می‌شود، فقط از SKU واقعی قابل‌فروش پیشنهاد بده و توسعه جدید Compass/AI انجام نده. یک پیشنهاد اصلی و مقایسه اختیاری اقتصادی‌تر/قوی‌تر می‌تواند باقی بماند.
8. CTA واحد «خرید و ثبت سفارش» باشد و Customer به مسیر کیف پول/خرید دوم یا صفحات موازی سردرگم‌کننده هدایت نشود.

معیار پذیرش:
- SKU Draft/Paused/Archived/Stale/Invalid price در فروش نمایش یا Quote نمی‌شود.
- Quote Snapshot پس از تغییر Catalog یا Markup ثابت می‌ماند.
- پاسخ Customer اطلاعات Provider cost/Markup/Raw source را افشا نمی‌کند.
- مسیر از مشاهده SKU تا Login/Checkout یک مسیر واضح دارد.

فقط تست حیاتی Quote expiry، Snapshot immutability و Revalidation را اجرا یا اضافه کن. Commit و Push مستقیم main؛ Deploy نکن و روش تست Founder را دقیق گزارش کن.
```

---

## فاز 1.5 — OTP و پرداخت یک‌مرحله‌ای

### هدف

تبدیل جریان فعلی پرداخت به یک تجربه واقعی: Customer یک بار پرداخت می‌کند، Callback موفق Order را دقیقاً یک بار ثبت می‌کند و Order در انتظار تأیید ساخت Admin می‌ایستد.

### پرامپت آماده Codex

```text
پروژه: AbrChin
Repository: Mhzs20/AbrChin
تسک: ABR-P1.5 — OTP and One-step Payment to Paid Order

این یک تسک مالی حیاتی است. مستقیم روی main کار کن؛ Branch، Worktree، PR، GitHub Actions و Deploy ممنوع است. ابتدا AGENTS.md، قرارداد فاز ۱، docs/payment-flow.md، docs/wallet-architecture.md، docs/auth-and-sms.md و تمام سرویس‌های Payment/Wallet/Order/Callback موجود را کامل بررسی کن.

رفتار قطعی موردنیاز:
Quote معتبر → OTP در صورت نیاز → یک Payment Gateway redirect → Callback verified → ثبت Payment و Ledger → ثبت/تکمیل Order دقیقاً یک بار → وضعیت Paid — Waiting Admin Provision Approval.

پیاده‌سازی لازم:
1. OTP Production با Kavenegar و Session موجود را حفظ/تکمیل کن؛ Guest Quote بعد از Login به همان Customer متصل شود.
2. Customer فقط یک اقدام «پرداخت و ثبت سفارش» داشته باشد. بعد از Callback موفق نباید دوباره روی «پرداخت با کیف پول» یا «ادامه سفارش» کلیک کند.
3. Wallet/Ledger داخلی می‌تواند برای Accounting باقی بماند، اما orchestration باید در Callback موفق، Credit/Debit و Order payment را اتمیک یا با الگوی بازیابی‌پذیر کامل کند.
4. مبلغ Verify فقط از Snapshot سمت سرور خوانده شود، نه Query یا Client.
5. Callback تکراری، Refresh صفحه، Retry Gateway یا Race condition نباید Payment، Ledger یا Order تکراری بسازد.
6. پس از پرداخت موفق، هیچ ProvisioningJob یا Provider Mutation ساخته/اجرا نشود. Order فقط وارد Waiting Admin Provision Approval شود.
7. Callback ناموفق/مبهم به Payment Review یا مسیر بازیابی‌پذیر برود و Quote/Order/Payment حذف نشود.
8. Mock Gateway در Production Fail-closed باشد و Customer Gateway انتخاب نکند؛ Default Admin-configured استفاده شود.
9. صفحه نتیجه پرداخت و Order tracking وضعیت قابل‌فهم «پرداخت موفق؛ منتظر تأیید ساخت» را نشان دهد.

معیار پذیرش حیاتی:
- یک Callback موفق دقیقاً یک ثبت مالی و یک Paid Order ایجاد می‌کند.
- Callback تکراری اثر مالی دوم ندارد.
- Customer هیچ پرداخت یا کلیک دوم ندارد.
- Payment موفق هیچ Provision مستقیم یا غیرمستقیم اجرا نمی‌کند.
- مبلغ، Quote و Order Snapshot قابل Audit باقی می‌مانند.

فقط تست‌های حیاتی Money/Callback idempotency، atomic ledger/order و ممنوعیت Provision پس از Payment را اجرا یا اضافه کن. Full suite و تست نمایشی ممنوع. مستقیم Commit و Push روی main؛ گزارش نهایی باید Commit SHA، تست‌های حیاتی، Risk مالی واقعی، روش تست Founder و «Deploy نشده» را بدهد.
```

---

## فاز 1.6 — گیت اول Admin برای Provision

### هدف

ساخت Queue و صفحه تصمیم Admin برای بررسی Provider، قیمت، موجودی و Balance و صدور دقیقاً یک فرمان Provision/Assign؛ بدون اینکه خود این فاز Resource را بسازد.

### پرامپت آماده Codex

```text
پروژه: AbrChin
Repository: Mhzs20/AbrChin
تسک: ABR-P1.6 — First Admin Gate / Provision Approval

مستقیم روی main کار کن و ابتدا AGENTS.md، قرارداد فاز ۱، Order state machine، سرویس‌های funding/provider review/admin command و خروجی ABR-P1.5 را کامل بخوان. Branch، Worktree، PR، GitHub Actions و Deploy نساز.

هدف: هر Paid Order در Queue «منتظر تأیید ساخت» بماند تا Founder موجودی یا کیف پول Provider را بررسی/شارژ کند و سپس آگاهانه Provision را تأیید کند.

پیاده‌سازی لازم:
1. Queue واقعی Paid — Waiting Admin Provision Approval در Admin بساز/تکمیل کن.
2. صفحه Order قبل از تصمیم این داده‌ها را نشان دهد: Customer، مبلغ و Reference پرداخت، SKU و Configuration، Source، Provider cost snapshot، Provider cost فعلی، Markup/Margin، Availability/Freshness، Balance Provider در صورت Capability معتبر و اختلاف‌های زمان Quote تا اکنون.
3. اگر Balance API وجود ندارد، «نیازمند بررسی دستی» و راهنمای واضح بررسی/شارژ Provider نمایش بده؛ هیچ شارژ خودکار انجام نشود.
4. اقدامات Hold، Cancel/Refund path و «تأیید و ساخت/تخصیص سرور» را فقط برای ADMIN ایجاد کن.
5. هنگام Approve، قیمت/Availability/Configuration را دوباره Revalidate کن. اختلاف را به Admin نشان بده و Order را خودکار تغییر Source یا Configuration نده.
6. فرمان Admin با Idempotency key قطعی Order ثبت و Audit شود؛ دوبار کلیک فقط همان نتیجه قبلی را برگرداند.
7. Approve فقط وضعیت/Command لازم برای مرحله Provisioning را ایجاد کند. خود Order پرداخت‌شده، Payment و Snapshot بازنویسی نشوند.
8. برای API-backed، Manual fulfillment و AbrChin Inventory مسیر تصمیم درست تعیین شود، ولی پیاده‌سازی ساخت Resource متعلق به ABR-P1.7 است.

Transitionهای ممنوع:
- Paid → Provisioning بدون Actor و Audit تأیید Admin
- Approve تکراری → Command/Job دوم
- اختلاف قیمت/موجودی → Provider fallback یا Source swap خودکار

معیار پذیرش:
- هیچ Paid Order بدون Approve Admin وارد Provisioning نمی‌شود.
- Founder پیش از Approve هزینه و وضعیت واقعی Source را می‌بیند.
- Approve تکراری یک نتیجه دارد و یک Command بیشتر نمی‌سازد.
- Hold و Needs Attention پول یا Order را حذف نمی‌کنند.

فقط تست حیاتی Admin authorization، transition guard و command idempotency را اجرا یا اضافه کن. Commit و Push مستقیم main؛ Deploy نکن و روش تست Founder را گزارش کن.
```

---

## فاز 1.7 — Provision، Fulfillment و ثبت امن Resource

### هدف

اجرای فرمان تأییدشده Admin برای ساخت خودکار Provider، Fulfillment دستی یا Assign موجودی ابرچین و رسیدن به Waiting Admin Delivery Approval با دقیقاً یک Resource.

### پرامپت آماده Codex

```text
پروژه: AbrChin
Repository: Mhzs20/AbrChin
تسک: ABR-P1.7 — Controlled Provisioning and Fulfillment

مستقیم روی main کار کن. قبل از تغییر، AGENTS.md، قرارداد فاز ۱، معماری چند Provider، مستند ParsPack، Adapterهای Arvan/ParsPack، provisioning orchestrator/worker، credential vault و خروجی ABR-P1.6 را کامل بررسی کن. Branch، Worktree، PR، GitHub Actions و Deploy ممنوع است.

هدف: فقط Command تأییدشده Admin اجرا شود و برای هر Order حداکثر یک Resource ساخته یا تخصیص داده شود.

پیاده‌سازی لازم:
1. Worker فقط Provision command دارای Admin approval معتبر را بپذیرد؛ Payment event به‌تنهایی هرگز ورودی ساخت نباشد.
2. برای Provider دارای Write API تأییدشده، payload را فقط از Paid Order Snapshot بساز؛ Region/Plan/Image/Source را از Catalog جدید جایگزین نکن.
3. Idempotency key پایدار Provider/Order و Reconciliation قبل و بعد Timeout پیاده کن. پیش از Retry create بررسی کن Resource قبلاً ساخته شده یا نه.
4. endpoint یا payload حدسی نساز. Capability فاقد قرارداد معتبر به Fulfillment دستی کنترل‌شده برود.
5. در Fulfillment دستی، Admin بتواند Provider Resource ID، IP، Region/Plan/Image، Username و Credential لازم را ثبت کند و تطبیق با Order انجام شود.
6. برای AbrChin Inventory فقط یک Item واجد شرایط را اتمیک Reserve/Assign کن؛ موجودی جعلی نساز و Oversell مجاز نیست.
7. Resource ID و metadata لازم Persist شوند؛ Credential با AES-256-GCM و CREDENTIAL_ENCRYPTION_KEY رمز شود و Secret خام در Log، Error، Audit، Analytics یا Notification نیاید.
8. نتیجه موفق به Waiting Admin Delivery Approval برود، نه Delivered. Customer تا این مرحله فقط «در حال آماده‌سازی» ببیند.
9. خطاهای Auth، Balance، Timeout، Contract mismatch، Persistence و Reconciliation به Needs Attention قابل اقدام بروند و Payment/Order حذف نشوند.

معیار پذیرش حیاتی:
- یک Order با Retry، Worker restart یا کلیک تکراری Resource دوم نمی‌سازد.
- Provision بدون Admin approval غیرممکن است.
- Configuration ساخته‌شده با Paid Snapshot تطبیق دارد.
- Credential فقط رمز‌شده Persist و فقط در محدوده Admin قابل بازیابی است.
- موفقیت Provision هنوز Customer delivery ایجاد نمی‌کند.

فقط تست حیاتی Provision idempotency، reconciliation، inventory assignment و credential encryption/no-leak را اجرا یا اضافه کن. Provider mutation واقعی را بدون Credential محیط و دستور صریح Founder اجرا نکن؛ نبود آن مانع تکمیل کد و مسیر امن نیست. Commit و Push مستقیم main، بدون Deploy.
```

---

## فاز 1.8 — گیت دوم Admin، تحویل و پنل Customer

### هدف

نمایش Resource ساخته‌شده ابتدا فقط به Admin، تأیید نهایی تحویل و سپس فعال‌سازی سرویس و دسترسی امن Customer.

### پرامپت آماده Codex

```text
پروژه: AbrChin
Repository: Mhzs20/AbrChin
تسک: ABR-P1.8 — Delivery Approval and Customer Service Panel

مستقیم روی main کار کن. ابتدا AGENTS.md، قرارداد فاز ۱، credential reveal policy، account services/orders و Admin order pages را همراه خروجی ABR-P1.7 کامل بخوان. Branch، Worktree، PR، GitHub Actions و Deploy ممنوع است.

هدف: Resource آماده تا قبل از تأیید دوم فقط در Admin باقی بماند؛ پس از بررسی Founder، Order/Service به Delivered/Active برود و Customer دسترسی امن دریافت کند.

پیاده‌سازی لازم:
1. Queue واقعی Waiting Admin Delivery Approval را در مرکز عملیات و سفارش‌ها نمایش بده.
2. صفحه Admin باید Provider/Source، Resource ID، IP، Region، Plan/Flavor، Image/OS، Power/Health state، تطبیق با Paid Snapshot و هشدارها را نشان دهد.
3. Credential فقط با authorization صریح Admin و به‌صورت محافظت‌شده قابل مشاهده باشد؛ در HTML اولیه، Client state، Log یا Notification نشت نکند.
4. اقدامات «نگه‌داشتن برای بررسی» و «تأیید و ارسال به مشتری» را فقط برای ADMIN بساز.
5. Delivery approval باید Idempotent و Audit شود؛ Transition Order و Service اتمیک/بازیابی‌پذیر باشد.
6. قبل از تأیید دوم، Customer فقط وضعیت «در حال آماده‌سازی» ببیند و هیچ IP/Username/Password دریافت نکند.
7. پس از تأیید دوم، Customer در پنل Order و Services وضعیت فعال، مشخصات غیرحساس و سازوکار امن Credential reveal را ببیند.
8. سیاست Reveal موجود را درست اعمال کن: مالک سرویس، Session معتبر، rate limit و ثبت Audit؛ Secret در Notification/SMS ممنوع است.
9. Notification تحویل فقط اعلام آماده‌شدن سرویس و لینک پنل را بفرستد، نه Password.
10. Support path و تاریخچه ضروری Order/Payment در پنل Customer واضح باشد.

معیار پذیرش:
- قبل از Delivery approval هیچ endpoint یا UI Customer Credential را برنمی‌گرداند.
- Approve تکراری Delivery یا Notification تکراری خطرناک ایجاد نمی‌کند.
- فقط مالک سرویس به Credential policy مجاز دسترسی دارد.
- Admin می‌تواند Resource ناسازگار را Hold کند و Customer همچنان «در حال آماده‌سازی» ببیند.

فقط تست حیاتی authorization/ownership، credential no-leak و delivery idempotency را اجرا یا اضافه کن. مستقیم Commit و Push main؛ Deploy نکن و روش تست Founder را دقیق بده.
```

---

## فاز 1.9 — بازیابی خطا، Refund و Audit

### هدف

بستن مسیرهای شکست واقعی بدون گم‌شدن پول یا Order، جلوگیری از Resource تکراری و فراهم‌کردن Action روشن برای Founder.

### پرامپت آماده Codex

```text
پروژه: AbrChin
Repository: Mhzs20/AbrChin
تسک: ABR-P1.9 — Failure Recovery, Refund and Audit

مستقیم روی main کار کن. AGENTS.md، قرارداد فاز ۱، state machine، idempotency، incident/audit، payment/wallet و provisioning recovery موجود را کامل بخوان. این تسک پس از تکمیل جریان اصلی 1.1 تا 1.8 اجرا می‌شود. Branch، Worktree، PR، GitHub Actions، Monitoring platform جدید و تست‌زیرساخت گسترده نساز.

هدف: هر خطای جریان مالی/Provision/Delivery به یک وضعیت قابل اقدام برود و هیچ خطا Payment، Order یا Resource identity را گم نکند.

پیاده‌سازی لازم:
1. Needs Attention را برای اختلاف قیمت/موجودی، Provider auth، Balance ناکافی، Timeout، نتیجه مبهم create، Resource mismatch، Health failure، Credential failure و Delivery failure استاندارد کن.
2. هر Error state حداقل یک اقدام معتبر داشته باشد: Retry امن، Reconcile، Manual Review، Hold یا Cancel/Refund.
3. Retry فقط عملیات تکرارپذیر را اجرا کند؛ پیش از هر create مجدد Reconciliation اجباری باشد.
4. Audit کامل برای Payment result، Admin provision approval، Provision attempts، Resource match، Delivery approval، Hold/Cancel و Refund ثبت شود؛ Secret و Raw auth data ممنوع.
5. Refund path فاز ۱ را مطابق معماری موجود و قرارداد واضح کن. اگر Refund بانکی API وجود ندارد، Ledger refund داخلی را صریح و قابل Audit نگه دار و در UI ادعای بازگشت بانکی خودکار نکن.
6. Customer status پیام قابل‌فهم بدهد ولی Error خام Provider، Source داخلی، cost یا Secret را افشا نکند.
7. Admin Action Queue علت، زمان، آخرین تلاش، اقدام بعدی و نتیجه عملیات را واضح نشان دهد.
8. State transitionهای غیرمجاز را در service layer مسدود کن، نه فقط UI.

سناریوهای حیاتی که باید پوشش داده شوند:
- Callback تکراری
- Approve Provision تکراری
- Timeout بعد از احتمال ساخت Resource
- Worker restart در میانه Provision
- Delivery approval تکراری
- Refund تکراری

معیار پذیرش:
- هیچ‌یک از سناریوهای بالا پول، Order یا Resource تکراری ایجاد نکند.
- Founder برای هر Needs Attention اقدام واقعی داشته باشد.
- Audit دو تأیید Admin و تمام نقاط مالی قابل پیگیری باشد.

فقط تست‌های حیاتی همین سناریوها را اجرا یا اضافه کن؛ Full suite و تست نمایشی ممنوع. Commit و Push مستقیم main؛ Deploy نکن و Risk واقعی باقیمانده را مشخص کن.
```

---

## فاز 1.10 — خرید واقعی Founder و فعال‌سازی فروش

### هدف

Deploy نسخه نهایی فقط با دستور Founder، انجام یک خرید واقعی از ابتدا تا تحویل، رفع مستقیم ایرادهای همان خرید و بازکردن کنترل‌شده Sale Gateها.

### پرامپت آماده Codex

```text
پروژه: AbrChin
Repository: Mhzs20/AbrChin
تسک: ABR-P1.10 — Founder E2E Purchase and Controlled Launch

این فاز نهایی فاز ۱ است. مستقیم روی main کار کن و Branch، Worktree، PR، GitHub Actions و Deploy خودکار نساز. ابتدا AGENTS.md، قرارداد فاز ۱، launch-runbook، production-deployment و تمام Commitهای 1.1 تا 1.9 را بخوان.

اصل اجرا:
- تست واقعی محصول را Founder انجام می‌دهد.
- تو باید Readiness فنی را آماده کنی، مسیر تست دقیق بدهی، ایرادهای گزارش‌شده همان مسیر را سریع روی main اصلاح کنی و فقط تست‌های حیاتی مرتبط را اجرا کنی.
- تا وقتی Founder صریحاً Deploy یا فعال‌سازی فروش را نگفته، Production deploy و Sale/Mutation gate را تغییر نده.

بخش A — Preflight و آمادگی:
1. بررسی کن اتصال‌های Arvan، ParsPack، Kavenegar و Gateway در Admin قابل Check هستند.
2. حداقل یک SKU واقعی Published از Source تأییدشده با قیمت معتبر و Quote ده‌دقیقه‌ای آماده باشد.
3. همه Sale/Mutation gateها پیش‌فرض خاموش بمانند و Mockها در Production Fail-closed باشند.
4. مسیر State Machine از Quote تا Delivered و Queueهای دو گیت Admin قابل مشاهده باشد.
5. Env checklist لازم را بدون چاپ Secret آماده کن.

بخش B — در صورت دستور صریح Deploy:
1. فقط SHA دقیق main تأییدشده را با Runbook فعلی Deploy کن؛ migration فقط deploy و بدون Reset/Volume deletion.
2. Health و Readiness حیاتی را بررسی کن.
3. ابتدا اتصال و Catalog را Read-only بررسی کن؛ Provider mutation را فقط پس از تأیید جداگانه Founder فعال کن.

بخش C — مسیر تست Founder:
1. ورود Customer با OTP واقعی.
2. مشاهده SKU واقعی و Quote معتبر.
3. پرداخت واقعی یک‌مرحله‌ای.
4. مشاهده Order در Waiting Admin Provision Approval و اطمینان از نساخته‌شدن Server.
5. بررسی/شارژ دستی کیف پول Provider توسط Founder و Approve Provision.
6. ساخت یا Fulfillment یک Resource و مشاهده اطلاعات فقط در Admin.
7. Hold/Review و سپس Approve Delivery.
8. مشاهده سرویس و Credential امن در پنل Customer.
9. بررسی Payment، Order و Audit نهایی.

بخش D — رفع ایراد و Launch:
- فقط ایرادهای واقعی همین خرید را روی main اصلاح و Commit/Push کن.
- بعد از تأیید Founder، Sale gate فقط Source/Product تست‌شده را باز کن؛ همه Provider/Productهای تأییدنشده خاموش بمانند.
- Mutation gate هر Provider جدا از Public sale و فقط پس از تست همان Provider فعال شود.
- هیچ Auto-routing، Auto-renew، Auto-charge Provider wallet یا Delivery خودکار اضافه نکن.

Definition of Done:
- یک فروش واقعی و یک تحویل کنترل‌شده کامل شده باشد.
- Payment هیچ Provision مستقیم ایجاد نکرده باشد.
- هر Admin approval فقط یک بار اثر کرده باشد.
- Customer فقط بعد از تأیید دوم Credential گرفته باشد.
- Retry/Failure پول یا Resource تکراری ایجاد نکرده باشد.

گزارش نهایی فقط شامل Commit SHA نهایی main، نسخه Deploy‌شده، نتیجه Health/Readiness، نتیجه مراحل خرید Founder، Gateهای باز/بسته، Risk واقعی باقی‌مانده و وضعیت «فاز ۱ آماده/ناآماده فروش عمومی» باشد.
```

## نقطه پایان فاز ۱

فاز ۱ با «کدنویسی همه کارت‌ها» تمام نمی‌شود. فقط وقتی تمام است که یک SKU واقعی آروان یا پارس‌پک فروخته شود، Customer یک بار پرداخت کند، Founder ساخت را تأیید کند، دقیقاً یک Resource ساخته یا تخصیص داده شود، Founder تحویل را تأیید کند و Customer Credential امن را دریافت کند.
