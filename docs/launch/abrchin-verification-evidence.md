# شواهد Verification برنامه Launch V2

## قواعد ثبت

- نتیجه فقط با Command و Artifact واقعی ثبت می‌شود.
- `BLOCKED` یا `SKIPPED` هرگز Pass محسوب نمی‌شود.
- Screenshot به‌تنهایی اثبات Business behavior نیست؛ DOM/runtime/database assertion لازم است.
- Secret، Credential و Production data وارد Artifact نمی‌شود.

## Phase 0

### Gate و Contract

| Command | نتیجه |
| --- | --- |
| `npm run test:launch-gates` | PASS — ۸ تست؛ Sale باز پیش‌فرض، closure صریح، boundary، GET safety و Provider mutation خاموش |
| `npm run test:phase9-readiness` | PASS — ۵ تست؛ Production Sale باز، Mutation خاموش و دو Admin approval |

### Browser baseline

| Route | `1440×900` | `390×844` | Artifact |
| --- | --- | --- | --- |
| `/` | `PASS` | `PASS` | `home-desktop-1440x900.png`، `home-mobile-390x844.png` |
| `/cloud-servers` | `PASS` | `PASS` | `catalog-desktop-1440x900.png`، `catalog-mobile-390x844.png` |
| `/cloud-servers/quote/:fixture-id` | `PASS` | `PASS` | `quote-desktop-1440x900.png`، `quote-mobile-390x844.png` |

Artifact ماشینی: `docs/launch/evidence/phase-0/browser-results.json`.

Assertions Browser ثبت‌شده پیش از Amendment فروش: HTTP 200 و مسیر Canonical، heading/title، page/console error، critical request، 5xx، horizontal overflow، CTA/content visibility و حالت Sale بسته. این Evidence تاریخی فقط Read-only بودن GET را اثبات می‌کند؛ قرارداد جاری Sale باز با تست Gate جدید پوشش داده شده است. شمارنده‌های Recommendation Session/Quote، Service Order، Payment، Wallet Top-up، Ledger، Infrastructure Order و Cloud Instance پیش و پس از GETها عیناً برابر ماندند.

Database این harness، PGlite سازگار با PostgreSQL و هر ۵۳ migration واقعی پروژه است؛ جایگزین Gate «PostgreSQL واقعی» فاز ۹ محسوب نمی‌شود.

### Security

- `npm audit --omit=dev --audit-level=low`: `PASS` — صفر آسیب‌پذیری.
- `npm run test:secret-scan`: `PASS` — هیچ Secret با اطمینان بالا یافت نشد.
- `nodemailer@9.0.5` با `disableFileAccess` و `disableUrlAccess`؛ overrides امن `postcss@8.5.26` و `nanoid@3.3.17`.

### Quality gates

| Command | نتیجه |
| --- | --- |
| `npm run lint` | `PASS` |
| `npm run typecheck` | `PASS` |
| `npm run build` | `PASS` — build تولیدی Next و Workerها |
| `git diff --check` | `PASS` |

### عملیات خارجی

Production DB، Payment، Wallet top-up، SMS/Email، Provider call/mutation، paid resource، Merge و Deploy اجرا نشده‌اند.

## Phase 1

### Discovery و Ranking

| Command | نتیجه |
| --- | --- |
| `npm run test:phase1-discovery` | `PASS` — ۳ تست، ۰ Skip؛ تفاوت واقعی Profile بر اساس Project، intent continuity و محتوای ضروری |
| `npm run test:recommendation` | `PASS` — ۵۴ تست، ۰ Skip؛ ranking/filtering، Compass، Catalog، Parchin و Quote contracts |
| `npm run typecheck` | `PASS` |

### Browser intent continuity

| Flow | `1440×900` | `390×844` | DB assertion |
| --- | --- | --- | --- |
| Home `commerce` → `/compass?project=commerce` | `PASS` | `PASS` | در هر viewport دقیقاً یک Session POST؛ `answers.project=commerce` و `answerSources.project=user` |

Artifact ماشینی: `docs/launch/evidence/phase-1/browser-results.json`. Screenshotها انتخاب فعال Home و تأیید برداشت Compass را در هر دو viewport ثبت کرده‌اند. Quote/Order/Payment/Top-up/Ledger/Infrastructure/Instance در این Flow تغییر نکردند؛ تنها mutation مجاز، POST صریح Session بود.

## Phase 2

### Guest Quote و Auth continuity

| Command | نتیجه |
| --- | --- |
| `npm run test:phase2-guest-auth` | `PASS` — ۴ تست، ۰ Skip؛ Config عمومی، Quote پیش از Login، claim immutable، safe return/retry و redirect مسیر قدیمی |
| `npm run test:phase2-browser` | `PASS` — desktop/mobile با Chromium واقعی و هر ۵۳ migration |
| `npm run typecheck` | `PASS` |

| Flow | `1440×900` | `390×844` | DB/runtime assertion |
| --- | --- | --- | --- |
| Guest Quote → Login boundary → authenticated claim → checkout | `PASS` | `PASS` | claim=200؛ Session متعلق به همان User؛ Guest token حذف؛ تمام Quote snapshotها، مبلغ، دوره، انقضا و status عیناً برابر |

Artifact ماشینی: `docs/launch/evidence/phase-2/browser-results.json`. چهار screenshot وضعیت Guest و checkout پس از claim را ثبت کرده‌اند. درخواست ۴۰۱ `GET /api/auth/me` پیش از ورود، probe موردانتظار navigation است و جداگانه در evidence شمارش شده؛ هیچ ۵xx، page error، hydration error، request failure یا horizontal overflow وجود نداشت. شمارنده‌های Order/Payment/Top-up/Ledger/Infrastructure/Instance پیش و پس از Flow برابر ماندند.

## Phase 3

### Checkout، Wallet و Payment recovery

| Command | نتیجه |
| --- | --- |
| `npm run test:phase3-contract` | `PASS` — ۱۲ تست، ۰ Skip؛ wallet-only UI، shortfall دقیق، safe return، recovery action و عدم provision از payment |
| `npm run test:phase3-postgres` | `PASS` — ۱۳ تست، ۰ Skip؛ هر ۵۳ migration روی DB ایزوله |
| `npm run typecheck` | `PASS` |

Assertions دیتابیسی پاس‌شده: دو submit همزمان به یک Order فقط یک `SERVICE_PURCHASE` Ledger با مبلغ برابر Quote/Order ساخت؛ موجودی دقیقاً یک‌بار کم شد؛ یک `WAITING_ADMIN_FUNDING` ساخته شد و `CloudInstance=0` ماند. failure تزریق‌شده پس از debit تمام Wallet/Ledger/Inventory/Order writes را rollback کرد. Top-up callback تکراری و همزمان یک Credit ساخت؛ mismatch وارد Review شد؛ timeout قابل reconcile بود؛ نتیجه موفق monotonic ماند و refund کنترل‌شده idempotent بود.

## Phase 4

### Order tracking و ارتباط تحویل

| Command | نتیجه |
| --- | --- |
| `npm run test:phase4-tracking` | `PASS` — ۳ تست، ۰ Skip؛ next action matrix، refresh read-only و cancel workflow owned |
| `npm run test:phase4-browser` | `PASS` — desktop/mobile؛ refresh واقعی و فرم لغو ازپیش‌پرشده |

در هر viewport صفحه Order وضعیت «پرداخت‌شده / منتظر تأیید ساخت»، اقدام بعدی و مسئول آن را نمایش داد. کلیک refresh یک پاسخ جدید Server Component با HTTP 200 گرفت. CTA لغو به فرم `CHANGE` با Order ID، موضوع و توضیح مشخص رفت. هیچ Submit لغو، Provider mutation یا Refund اجرا نشد؛ تمام شمارنده‌های Business پیش و پس از navigation برابر ماندند. Artifact ماشینی: `docs/launch/evidence/phase-4/browser-results.json`.

## Phase 5

### Manual Admin fulfillment

| Command | نتیجه |
| --- | --- |
| `npm run test:phase5-contract` | `PASS` — ۷ تست، ۰ Skip؛ approval boundaries، manual credential و reconciliation |
| `npm run test:phase5-postgres` | `PASS` — ۲ سناریوی کامل، ۰ Skip؛ هر ۵۳ migration |
| `npm run typecheck` | `PASS` |

سناریوی کامل پرداخت تا delivery با Provider fake تأیید کرد: payment فقط `WAITING_ADMIN_FUNDING` می‌سازد؛ Approval اول audit/receipt یکتا دارد؛ fulfillment دستی secret را encrypted ذخیره می‌کند و تحویل نمی‌دهد؛ health/delivery Approval دوم Active را می‌سازد؛ دو Approval همزمان duplicate ایجاد نمی‌کنند؛ reveal یک‌بارمصرف atomic است. همچنین lifecycle policy اکنون با همان Transaction Client خوانده می‌شود تا delivery/subscription یک snapshot اتمیک داشته باشند.

## Phase 6

### Credential و lifecycle پس از تحویل

| Command | نتیجه |
| --- | --- |
| `npm run test:phase6-contract` | `PASS` — ۱۵ تست، ۰ Skip؛ credential، renewal، upgrade و Ledger contracts |
| `npm run test:phase6-postgres` | `PASS` — cancellation کامل PREPAID، ۰ Skip |

سناریوی لغو محلی با mutation خاموش، درخواست مشتری را ثبت و سپس خاتمهٔ کنترل‌شده Admin را شبیه‌سازی کرد. مبلغ قفل‌شدهٔ استفاده‌نشده یک‌بار به Wallet Credit شد؛ replay همان Ledger را برگرداند؛ Subscription و Instance به `TERMINATED` و Change به `APPLIED` رسیدند؛ یک ResourceVersion خاتمه ثبت شد. برای PREPAID هیچ `UsageInterval` جعلی ساخته نشد و نبودن PAYG billing snapshot مانع termination نبود.

## Phase 7

### شواهد عملیاتی Parchin

| Command | نتیجه |
| --- | --- |
| `npm run test:phase7-parchin` | `PASS` — ۱۸ تست، ۰ Skip؛ پوشش یک‌به‌یک Claim registry، redaction عمومی، immutable snapshots و production gate |
| `npm run test:launch-gates` | `PASS` — ۸ تست، ۰ Skip؛ deployment defaults و business boundaries |
| `npm run typecheck` / `npm run lint` / `git diff --check` | `PASS` |

پرچین ۳ تعهدهای عمومی را به Artifactهای قراردادمحور تبدیل می‌کند: Enrollment پس از تحویل، Task دارای Owner/Due/Evidence، SLA و سهمیه روی Support Request، و Report قابل مشاهده مشتری. کنترل فروش با master/provider/source gate انجام می‌شود و Fulfillment تعهدها می‌تواند انسانی باشد. جزئیات در `docs/launch/parchin-operational-evidence.md` ثبت شده است.

## Phase 8

### UI، Mobile و Accessibility

| Command | نتیجه |
| --- | --- |
| `npm run test:phase8-contract` | `PASS` — ۱۴ تست، ۰ Skip؛ Shell/Skip link، Form labels/errors، money typography و purchase UX |
| `npm run test:phase8-browser` | `PASS` — ۱۲ Route/Viewport، ۰ Skip؛ Chromium واقعی و هر ۵۳ migration |
| `npm run typecheck` / `git diff --check` | `PASS` |

شش Route در desktop/mobile از نظر landmark، یک H1، زبان/جهت، accessible name، label، alt، duplicate ID، tabindex، hidden focusable، اندازه کنترل، focus-visible Skip Link، horizontal overflow و runtime/network/5xx error ممیزی شدند. هر ۱۲ نتیجه Pass است و business counts قبل/بعد برابر است. Screenshotها و JSON assertion در `docs/launch/evidence/phase-8` قرار دارند و contact sheet هر دو viewport به‌صورت بصری بازبینی شد.

## Phase 9

### Release readiness

| دسته | نتیجه نهایی |
| --- | --- |
| Unit/Contract Phase 0–9 | `PASS` — ۱۴۳ تست، ۰ Fail، ۰ Skip |
| DB Phase 3/5/6 | `PASS` — ۱۶ تست، ۰ Fail، ۰ Skip؛ ۵۳ migration در هر بسته |
| Browser Phase 0/1/2/4/8 | `PASS` — ۲۴ Route/Viewport؛ آخرین run برابر ۱۲/۱۲ |
| `npm run lint` / `npm run typecheck` / `npm run build` | `PASS` |
| `npm audit --omit=dev --audit-level=low` | `PASS` — صفر vulnerability |
| `npm run test:secret-scan` | `PASS` — tracked + untracked candidate files |
| `git diff --check` | `PASS` |

هیچ نتیجه `BLOCKED` یا `SKIPPED` به‌عنوان Pass شمارش نشده است. حکم نهایی با وجود Gateهای خارجی در `docs/launch/release-readiness-v2.md` برابر `NO-GO` است. هیچ عملیات خارجی یا برگشت‌ناپذیر اجرا نشد.
