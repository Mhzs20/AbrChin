# وضعیت اجرای Launch V2 ابرچین

> این فایل Scheduler یا Automation مستقل نیست؛ حافظه پایدار اجرای ۱۰ چرخه
> Launch V2 در ۲۰۲۶-۰۸-۱۰ است.
>
> `PENDING_PHASE_COMMIT` بازنشسته است. سیاست انتشار جاری `origin/main` است.
> وضعیت فعلی، SHA و گیت‌های WP6 در `docs/launch/wp6-release-truth.md` است.

| Phase | وضعیت تاریخی | Starting SHA (worktree 2026-08-10) | Ending SHA | خلاصه |
| --- | --- | --- | --- | --- |
| 0 | `HISTORICAL_VERIFIED` | `f95e775f9534b88a805e31a6e0ce8e052522f742` | `PUBLISHED_ON_MAIN` | Contract، Sale gates و Browser baseline |
| 1 | `HISTORICAL_VERIFIED` | worktree after phase 0 | `PUBLISHED_ON_MAIN` | Project intent وارد Compass/Ranking و Session می‌شود |
| 2 | `HISTORICAL_VERIFIED` | worktree after phase 1 | `PUBLISHED_ON_MAIN` | Quote نهایی پیش از Login و claim بدون تغییر Snapshot |
| 3 | `HISTORICAL_VERIFIED` | worktree after phase 2 | `PUBLISHED_ON_MAIN` | Wallet-only checkout، recovery و idempotency دیتابیسی |
| 4 | `HISTORICAL_VERIFIED` | worktree after phase 3 | `PUBLISHED_ON_MAIN` | اقدام بعدی، refresh واقعی و لغو پیش از تحویل |
| 5 | `HISTORICAL_VERIFIED` | worktree after phase 4 | `PUBLISHED_ON_MAIN` | دو Approval، fulfillment دستی و credential atomic |
| 6 | `HISTORICAL_VERIFIED` | worktree after phase 5 | `PUBLISHED_ON_MAIN` | Credential، Renewal/Upgrade و Cancel Ledger lifecycle |
| 7 | `HISTORICAL_VERIFIED` | worktree after phase 6 | `PUBLISHED_ON_MAIN` | رجیستری Owner/Due/Evidence و fail-closed برای ادعاهای اثبات‌نشده |
| 8 | `HISTORICAL_VERIFIED` | worktree after phase 7 | `PUBLISHED_ON_MAIN` | Desktop/Mobile visual QA و Accessibility runtime |
| 9 | `HISTORICAL_INTERNAL_NO_GO` | worktree after phase 8 | `PUBLISHED_ON_MAIN` | Gateهای محلی آن روز؛ blockerهای خارجی همچنان باز |

شمارش migration و تست داخل checkpointهای زیر مربوط به همان تاریخ است و جایگزین
شمارش جاری (۵۹ migration در درخت Prisma؛ WP6 receipt) نمی‌شود.

## Phase 0 — Checkpoint تاریخی

- وضعیت: `HISTORICAL_VERIFIED` (2026-08-10T17:42:53+01:00)
- Validation آن روز: `test:launch-gates`، preflight، browser، lint/typecheck/build، secret-scan، `npm audit`.
- Sale در checkpoint اولیه خاموش ثبت شده بود؛ تصمیم Founder در ۲۰۲۶-۰۸-۱۰ Sale باز و Provider mutation خاموش را جایگزین کرد.

## Phase 1 — Checkpoint تاریخی

- وضعیت: `HISTORICAL_VERIFIED` (2026-08-10T17:55:11+01:00)
- Validation آن روز: `test:phase1-discovery`، `test:recommendation`، typecheck، phase1-browser.

## Phase 2 — Checkpoint تاریخی

- وضعیت: `HISTORICAL_VERIFIED` (2026-08-10T18:12:25+01:00)
- Validation آن روز: `test:phase2-guest-auth`، phase2-browser، typecheck.

## Phase 3 — Checkpoint تاریخی

- وضعیت: `HISTORICAL_VERIFIED` (2026-08-10T18:21:07+01:00)
- Database runner آن روز PGlite/isolated با شمارش migration همان روز بود؛ جایگزین PostgreSQL Staging نیست.

## Phase 4 — Checkpoint تاریخی

- وضعیت: `HISTORICAL_VERIFIED` (2026-08-10T18:26:00+01:00)

## Phase 5 — Checkpoint تاریخی

- وضعیت: `HISTORICAL_VERIFIED` (2026-08-10T18:33:01+01:00)

## Phase 6 — Checkpoint تاریخی

- وضعیت: `HISTORICAL_VERIFIED` (2026-08-10T18:37:51+01:00)

## Phase 7 — Checkpoint تاریخی

- وضعیت: `HISTORICAL_VERIFIED` برای Gate صداقت محصول؛ عرضه عملیاتی Parchin همچنان `BLOCKED` است تا Owner شواهد را مهر کند.
- Artifact: `docs/launch/parchin-operational-evidence.md`.

## Phase 8 — Checkpoint تاریخی

- وضعیت: `HISTORICAL_VERIFIED` (2026-08-10T18:56:43+01:00)
- Browser evidence: `docs/launch/evidence/phase-8`.

## Phase 9 — Checkpoint تاریخی

- وضعیت مهندسی آن روز: `VERIFIED` محلی؛ Verdict انتشار: `NO-GO`.
- Draft PR دیگر فرایند جاری نیست. انتشار روی `origin/main` است و همچنان مجوز Deploy نیست.
- Artifact آن روز: همین فایل به‌علاوه `docs/launch/release-readiness-v2.md` که در WP6 به حقیقت جاری به‌روز شد.

## WP6

Owner acceptance تنظیم نشده است. Production و live provider traffic مجاز نیستند.
Receipt: `docs/launch/evidence/wp6/receipt.json`.
