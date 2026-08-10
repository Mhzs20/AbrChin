# وضعیت اجرای Launch V2 ابرچین

> این فایل Scheduler یا Automation مستقل نیست؛ حافظه پایدار اجرای ۱۰ چرخه است.

| Phase | وضعیت | Starting SHA | Ending SHA | خلاصه |
| --- | --- | --- | --- | --- |
| 0 | `VERIFIED` | `f95e775f9534b88a805e31a6e0ce8e052522f742` | `PENDING_PHASE_COMMIT` | Contract، Sale gates و Browser baseline کامل و سبز |
| 1 | `VERIFIED` | `WORKTREE_AFTER_PHASE_0` | `PENDING_PHASE_COMMIT` | Project intent وارد Compass/Ranking و Session می‌شود |
| 2 | `VERIFIED` | `WORKTREE_AFTER_PHASE_1` | `PENDING_PHASE_COMMIT` | Quote نهایی پیش از Login و claim بدون تغییر Snapshot |
| 3 | `VERIFIED` | `WORKTREE_AFTER_PHASE_2` | `PENDING_PHASE_COMMIT` | Wallet-only checkout، recovery و idempotency دیتابیسی |
| 4 | `VERIFIED` | `WORKTREE_AFTER_PHASE_3` | `PENDING_PHASE_COMMIT` | اقدام بعدی، refresh واقعی و لغو پیش از تحویل |
| 5 | `VERIFIED` | `WORKTREE_AFTER_PHASE_4` | `PENDING_PHASE_COMMIT` | دو Approval، fulfillment دستی و credential atomic |
| 6 | `VERIFIED` | `WORKTREE_AFTER_PHASE_5` | `PENDING_PHASE_COMMIT` | Credential، Renewal/Upgrade و Cancel Ledger lifecycle |
| 7 | `VERIFIED` | `WORKTREE_AFTER_PHASE_6` | `PENDING_PHASE_COMMIT` | رجیستری Owner/Due/Evidence و fail-closed برای ادعاهای اثبات‌نشده |
| 8 | `VERIFIED` | `WORKTREE_AFTER_PHASE_7` | `PENDING_PHASE_COMMIT` | Desktop/Mobile visual QA و Accessibility runtime |
| 9 | `VERIFIED_INTERNAL_NO_GO` | `WORKTREE_AFTER_PHASE_8` | `PENDING_PHASE_COMMIT` | تمام Gateهای محلی سبز؛ blockerهای خارجی باز |

## Phase 0 — آخرین Checkpoint

- وضعیت: `VERIFIED`
- حوزه تغییر: Launch contract، master Sale gate، deployment defaults، route/service boundary tests، Browser harness.
- Database/Migration: بدون تغییر Schema یا داده.
- Validation قطعی:
  - `npm run test:launch-gates` — ۸ Pass، ۰ Fail، ۰ Skip.
  - `node --experimental-strip-types --test scripts/phase-1-launch-preflight-test.mts` — ۲ Pass، ۰ Fail، ۰ Skip.
  - `npm run test:phase0-browser` — ۶ Route/Viewport Pass؛ ۰ Console/Page/Request/5xx error؛ GET business counts برابر.
  - `npm run lint`، `npm run typecheck`، `npm run build` و `git diff --check` — Pass.
  - `npm run test:secret-scan` — Pass.
- Browser evidence: سه Route در `1440×900` و `390×844` با Chromium واقعی؛ تصاویر و JSON در `docs/launch/evidence/phase-0`.
- Security: `npm audit --omit=dev --audit-level=low` — صفر آسیب‌پذیری. `nodemailer` به ۹.۰.۵ ارتقا یافت، دسترسی File/URL غیرفعال شد و `postcss/nanoid` امن pin شدند.
- Risk: این Checkpoint با Sale خاموش ثبت شده بود؛ تصمیم Founder در ۲۰۲۶-۰۸-۱۰
  آن را جایگزین کرد و اکنون Sale باز و Provider mutation خاموش است.
- Blocker/Owner: مورد داخلی ندارد. اجرای Production/Staging واقعی و Provider
  mutation همچنان Gate خارجی Founder است.
- اقدام بعدی: Commit/Push فاز ۰ و آغاز فاز ۱ (Discovery/Catalog).
- Timestamp: `2026-08-10T17:42:53+01:00`

## Phase 1 — آخرین Checkpoint

- وضعیت: `VERIFIED`
- اصلاح اصلی: لینک‌های پروژه در Home/Solutions از query بی‌اثر Catalog به `/compass?project=...` منتقل شد؛ Session از ابتدا با Project/Management معتبر seed می‌شود.
- ایمنی lifecycle: ایجاد Session در React Strict Mode تک‌بار است؛ mutation فقط `POST /api/recommendations/sessions` و GETها read-only می‌مانند.
- Validation:
  - `npm run test:phase1-discovery` — ۳ Pass، ۰ Fail، ۰ Skip.
  - `npm run test:recommendation` — ۵۴ Pass، ۰ Fail، ۰ Skip.
  - `npm run typecheck` و `git diff --check` — Pass.
  - `npm run test:phase1-browser` — ۲ viewport Pass؛ هر viewport دقیقاً یک Session POST؛ Project/Source در DB تأیید شد؛ ۰ Console/Page/Request/5xx error و ۰ overflow.
- Browser evidence: `docs/launch/evidence/phase-1` شامل چهار Screenshot و JSON assertion.
- Publish status: اتصال GitHub محیط Work در دسترس است؛ Commit کاندید ساخته شده
  و Push/PR/Merge در چرخه انتشار جاری انجام می‌شود. Deploy انجام نشده.
- اقدام بعدی: فاز ۲ — Guest Quote و Auth continuity.
- Timestamp: `2026-08-10T17:55:11+01:00`

## Phase 2 — آخرین Checkpoint

- وضعیت: `VERIFIED`
- اصلاح اصلی: Configurator از مرز Login خارج و به مسیر عمومی Canonical منتقل شد؛ Guest ابتدا Quote نهایی ۶۰ دقیقه‌ای می‌گیرد و سپس برای پرداخت وارد می‌شود.
- تداوم Auth: Session مهمان پس از ورود به همان User claim می‌شود، Guest cookie حذف می‌شود و Quote، Snapshotها، مبلغ، دوره و زمان انقضا بدون تغییر می‌مانند.
- بازیابی: در صورت موفقیت OTP و شکست موقت claim، ورود معتبر حفظ می‌شود و CTA «اتصال دوباره و ادامه خرید» بدون OTP دوم وجود دارد.
- اصلاح runtime: Quoteهای عمومی در مرز `ToastProvider` قرار گرفتند و Countdown با SSR hydration قطعی رندر می‌شود.
- Validation:
  - `npm run test:phase2-guest-auth` — ۴ Pass، ۰ Fail، ۰ Skip.
  - `npm run test:phase2-browser` — ۲ viewport Pass؛ claim=200، مالکیت DB قطعی، Guest cookie حذف، Quote immutable، ۰ Page/Request/5xx و ۰ overflow.
  - `npm run typecheck` و `git diff --check` — Pass.
- Browser evidence: `docs/launch/evidence/phase-2` شامل Guest/Claimed screenshotهای desktop/mobile و JSON assertion است.
- عملیات خارجی: هیچ OTP/SMS واقعی، Payment، Provider call، mutation یا resource پولی اجرا نشد.
- اقدام بعدی: فاز ۳ — Checkout، Wallet و Payment recovery.
- Timestamp: `2026-08-10T18:12:25+01:00`

## Phase 3 — آخرین Checkpoint

- وضعیت: `VERIFIED`
- قرارداد UI: Checkout عمومی فقط Wallet debit دارد؛ درگاه مستقیم Order از UX حذف است و درگاه فقط Top-up را Credit می‌کند.
- Database verification: runner ایزوله هر ۵۳ migration را اعمال و تمام تست‌های مالی را بدون Skip اجرا می‌کند.
- Validation:
  - `npm run test:phase3-contract` — ۱۲ Pass، ۰ Fail، ۰ Skip.
  - `npm run test:phase3-postgres` — ۱۳ Pass، ۰ Fail، ۰ Skip.
  - submit همزمان — یک Debit Ledger، یک کاهش موجودی، یک InfrastructureOrder و صفر CloudInstance.
  - failure پس از debit — rollback کامل Wallet، Ledger، موجودی دستی و Order.
  - callback همزمان/replay، timeout→review→reconcile، amount mismatch، monotonic success و refund کنترل‌شده همگی Pass.
  - `npm run typecheck` و `git diff --check` — Pass.
- عملیات خارجی: Payment provider، Provider API و mutation واقعی اجرا نشد؛ fixtureها فقط mock/local بودند.
- اقدام بعدی: فاز ۴ — Order tracking و ارتباط تحویل.
- Timestamp: `2026-08-10T18:21:07+01:00`

## Phase 4 — آخرین Checkpoint

- وضعیت: `VERIFIED`
- Order detail برای Payment، Admin provision، Admin delivery، Active و Terminal state اقدام بعدی و Owner روشن دارد.
- refresh: دکمه صریح `router.refresh()` آخرین RSC/DB state را می‌گیرد و هیچ polling یا mutation پنهان ندارد.
- لغو پیش از تحویل: CTA مشخص، فرم Support مرتبط با همان Order و متن بدون وعدهٔ کاذب refund؛ مالکیت Order در service دوباره بررسی می‌شود.
- Validation:
  - `npm run test:phase4-tracking` — ۳ Pass، ۰ Fail، ۰ Skip.
  - `npm run test:phase4-browser` — ۲ viewport Pass؛ refresh response واقعی، next action و form prefill؛ ۰ Console/Page/Request/5xx و ۰ overflow.
  - تمام business countها پیش و پس از GET/refresh/form navigation برابر ماندند.
- Browser evidence: `docs/launch/evidence/phase-4` شامل چهار Screenshot و JSON assertion.
- اقدام بعدی: فاز ۵ — Manual Admin fulfillment.
- Timestamp: `2026-08-10T18:26:00+01:00`

## Phase 5 — آخرین Checkpoint

- وضعیت: `VERIFIED`
- تأیید اول فقط اجازه ساخت را ثبت می‌کند؛ خودش Job/Resource/Credential نمی‌سازد.
- Manual fulfillment ورودی و Snapshot را validate، credential را encrypted و delivery را pending نگه می‌دارد.
- تأیید دوم تنها مسیر فعال‌سازی است؛ approval همزمان و reveal یک‌بارمصرف idempotent/atomic هستند.
- اصلاح atomicity: lifecycle policy داخل همان transaction تحویل خوانده می‌شود و دیگر Prisma global snapshot جدا ندارد.
- Validation:
  - `npm run test:phase5-contract` — ۷ Pass، ۰ Fail، ۰ Skip.
  - `npm run test:phase5-postgres` — ۲ سناریوی کامل Pass، ۰ Fail، ۰ Skip با هر ۵۳ migration.
  - `npm run typecheck` و `git diff --check` — Pass.
- Providerها و درگاه‌ها در این اجرا fake/mock بودند؛ mutation واقعی و resource پولی انجام نشد.
- اقدام بعدی: فاز ۶ — Credential، Renewal، Upgrade و Cancel.
- Timestamp: `2026-08-10T18:33:01+01:00`

## Phase 6 — آخرین Checkpoint

- وضعیت: `VERIFIED`
- Credential: encryption، fingerprint، مسیر Admin-only و reveal یک‌بارمصرف تأیید شد.
- Renewal: snapshot تازه، بدون auto-charge و با ماه تقویمی/Grace روشن.
- Upgrade: فقط ارتقای واقعی، مبلغ قفل‌شده، shortfall و Ledger key پایدار؛ context/returnTo حفظ می‌شود.
- Cancel: PREPAID termination برای ResourceVersion به snapshot مصرف PAYG وابسته نیست؛ refund دقیقاً یک Credit Ledger است.
- Validation:
  - `npm run test:phase6-contract` — ۱۵ Pass، ۰ Fail، ۰ Skip.
  - `npm run test:phase6-postgres` — ۱ سناریوی کامل Pass، ۰ Fail، ۰ Skip.
  - replay لغو Credit دوم نساخت؛ Subscription/Instance/ResourceVersion خاتمه یافت و UsageInterval ساختگی ساخته نشد.
- عملیات Provider واقعی اجرا نشد؛ mutation gate در تست لغو خاموش بود.
- اقدام بعدی: فاز ۷ — شواهد عملیاتی Parchin.
- Timestamp: `2026-08-10T18:37:51+01:00`

## Phase 7 — آخرین Checkpoint

- وضعیت: `VERIFIED` برای Gate صداقت محصول؛ عرضه عملیاتی Parchin همچنان `BLOCKED` است.
- رجیستری: هر ۳۲ عبارت قابل‌اندازه‌گیری Contract دارای Owner، Due، Evidence target و Status یکتا است؛ ۴ مورد شاهد داخلی دارند و ۲۸ مورد تا ایجاد Artifact عملیاتی مسدودند.
- Public copy: صفحه Support و جزئیات Catalog ادعاهای مسدود را نمایش/فروش نمی‌دهند؛ تنظیمات Admin به‌تنهایی تضمین ایجاد نمی‌کند.
- Production: قرارداد پرچین پس از تحویل به Enrollment، صف کار، SLA و گزارش قابل ممیزی تبدیل می‌شود؛ کنترل فروش با master/provider/source gate انجام می‌شود.
- Snapshotهای Quote/Order قبلی immutable ماندند و هیچ migration یا rewrite روی قراردادهای موجود انجام نشد.
- Validation:
  - `npm run test:phase7-parchin` — ۱۸ Pass، ۰ Fail، ۰ Skip.
  - `npm run test:launch-gates` — ۸ Pass، ۰ Fail، ۰ Skip.
  - `npm run typecheck`، `npm run lint` و `git diff --check` — Pass.
- Artifact: `docs/launch/parchin-operational-evidence.md`.
- اقدام بعدی: فاز ۸ — UI، Mobile و Accessibility.
- Timestamp: `2026-08-10T18:46:54+01:00`

## Phase 8 — آخرین Checkpoint

- وضعیت: `VERIFIED`.
- اصلاح Accessibility: پنل Customer/Admin به Skip Link قابل‌مشاهده با Focus مجهز شد؛ خطای فرم Support با `role="alert"` اعلام می‌شود.
- Browser runtime: شش Route کلیدی روی `1440×900` و `390×844` بررسی شد: Home، Catalog، Parchin status، Quote، Order tracking و Cancel/Support form.
- Assertions هر ۱۲ سناریو: یک `h1` و یک `main#main-content`، زبان `fa` و جهت `rtl`، نام دسترس‌پذیر کنترل‌ها، label فیلدها، alt تصویر، ID یکتا، نبود positive tabindex/hidden focusable، حداقل اندازه کنترل، Skip Link کیبوردی، نبود overflow و خطای runtime.
- Visual QA: هر ۱۲ screenshot به‌صورت contact sheet بازبینی شد؛ desktop/mobile hierarchy و stateهای fail-closed خوانا هستند.
- Mutation safety: شمارنده‌های Session/Quote/Order/Payment/Top-up/Ledger/Infrastructure/Instance قبل و بعد عیناً برابر ماندند.
- Validation:
  - `npm run test:phase8-contract` — ۱۴ Pass، ۰ Fail، ۰ Skip.
  - `npm run test:phase8-browser` — ۱۲ Route/Viewport Pass، ۰ runtime/a11y error.
  - `npm run typecheck` و `git diff --check` — Pass.
- Artifact: `docs/launch/evidence/phase-8/browser-results.json` و ۱۲ screenshot.
- اقدام بعدی: فاز ۹ — Release readiness و حکم GO/NO-GO.
- Timestamp: `2026-08-10T18:56:43+01:00`

## Phase 9 — آخرین Checkpoint

- وضعیت مهندسی محلی: `VERIFIED`؛ Verdict انتشار: `NO-GO`.
- Final unit/contract matrix: ۱۴۳ Pass، ۰ Fail، ۰ Skip.
- Final DB matrix: ۱۶ Pass، ۰ Fail، ۰ Skip؛ هر بسته هر ۵۳ migration را روی DB ایزوله اعمال کرد.
- Browser evidence کل برنامه: ۲۴ Route/Viewport Pass؛ آخرین Accessibility run برابر ۱۲/۱۲ و بدون mutation بود.
- Quality/Security:
  - `npm run lint`، `npm run typecheck` و `npm run build` — Pass.
  - `npm audit --omit=dev --audit-level=low` — صفر vulnerability.
  - `npm run test:secret-scan` — tracked و untracked candidate files، صفر finding.
  - `git diff --check` — Pass.
- Runbook/Founder checklist از PAYG عمومی و `/ready-servers` به PREPAID V2 و `/cloud-servers` همگام شد.
- External/process blockers: Draft PR (`gh` موجود نیست)، ۲۸ شاهد Parchin، PostgreSQL واقعی Staging، purchase واقعی، داده حقوقی، Production connections/smoke، backup/rollback و دو مجوز جداگانه Founder.
- هیچ Commit/Push/Merge/Deploy، پرداخت/OTP/SMTP واقعی، Provider call/mutation یا Public Sale انجام نشد.
- Artifact نهایی: `docs/launch/release-readiness-v2.md`.
- Timestamp: `2026-08-10T19:07:34+01:00`
