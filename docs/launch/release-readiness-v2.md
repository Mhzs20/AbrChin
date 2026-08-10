# Release Readiness — Launch V2 ابرچین

**Verdict: `NO-GO` برای Deploy Production تا تکمیل Evidence خارجی**
Candidate branch: `codex/abrchin-ux-flow-v2`
Starting SHA: `f95e775f9534b88a805e31a6e0ce8e052522f742`
Merge/Deploy: **انجام نشده** — Public Sale: **تأیید Founder و پیش‌فرض باز** — Provider mutation: **خاموش**

## حکم داخلی

Flow عمومی PREPAID، Wallet/Ledger، Fulfillment دستی دو مرحله‌ای، Credential، lifecycle و Browser UX در محیط محلی ایزوله قابل تکرارند. این نتیجه فقط آمادگی مهندسی محلی را نشان می‌دهد و جای Staging/Production evidence را نمی‌گیرد.

| Gate داخلی | وضعیت | Evidence |
| --- | --- | --- |
| Phase 0 — Contract/Sale gates | `PASS` | ۸ launch gate + ۲ preflight + ۶ browser |
| Phase 1 — Discovery/Ranking | `PASS` | ۳ discovery + ۵۴ recommendation + ۲ browser viewport |
| Phase 2 — Guest Quote/Auth claim | `PASS` | ۴ contract + ۲ browser viewport |
| Phase 3 — Wallet/Payment recovery | `PASS` | ۱۲ contract + ۱۳ DB؛ concurrent/rollback |
| Phase 4 — Order tracking | `PASS` | ۳ contract + ۲ browser viewport |
| Phase 5 — Manual fulfillment | `PASS` | ۷ contract + ۲ DB full-flow |
| Phase 6 — Credential/Lifecycle | `PASS` | ۱۵ contract + ۱ DB cancellation full-flow |
| Phase 7 — Parchin operations v3 | `PASS` | ۱۹ contract + ۲ DB؛ سه سطح، SLA، سهمیه، صف کار، گزارش و فعال‌سازی پس از تحویل |
| Phase 8 — UI/Mobile/A11y | `PASS` | ۱۴ contract + ۱۴ Chromium route/viewport |
| Build/Type/Lint | `PASS` | Production Build، TypeScript و ESLint؛ ۰ error |
| Production dependency audit | `PASS` | `npm audit --omit=dev --audit-level=low`؛ ۰ vulnerability |
| Secret scan | `PASS` | tracked + untracked candidate files؛ ۰ high-confidence finding |

همه تست‌های DB ثبت‌شده روی PGlite سازگار با PostgreSQL و هر ۵۴ migration اجرا شده‌اند. این مورد عمداً جای Fresh/Upgrade test روی PostgreSQL واقعی Staging محسوب نمی‌شود.

Final local matrix: ۱۴۳ تست قراردادی/واحد + ۱۶ تست DB، همگی Pass و بدون Skip. علاوه بر آن ۲۴ Route/Viewport مرورگر در فازهای ۰، ۱، ۲، ۴ و ۸ Pass شده‌اند؛ آخرین ممیزی Accessibility شامل ۱۲ Route/Viewport بود.

## Blockerهای خارجی و فرایندی

| Blocker | Owner | Due | Evidence لازم | وضعیت |
| --- | --- | --- | --- | --- |
| Commit/Push/Draft PR و review | Engineering / Founder | پیش از Release review | PR URL، SHA و review نتیجه‌دار | `IN_PROGRESS` — Commit محلی آماده است |
| ظرفیت انسانی عملیات و On-call پرچین | Ops/SRE/Support/Security | پیش از Deploy | Owner صف روزانه، برنامه P1 و Staging drill | `BLOCKED` |
| PostgreSQL واقعی Staging: fresh + upgrade | Engineering/Ops | پیش از Staging purchase | migration log بدون Skip و backup fixture ID | `BLOCKED` |
| Staging purchase واقعی PREPAID | Founder/Ops/Finance | پیش از Deploy Production | sanitized Golden Path receipt/audit | `BLOCKED` |
| داده حقوقی و هویتی شرکت | Founder/Legal | پیش از انتشار صفحات حقوقی | تأیید مکتوب و محتوای نهایی | `BLOCKED` |
| Production env/OTP/SMTP/Gateway/Provider read-only checks | Ops | پیش از Deploy | readiness و connection-check artifact | `BLOCKED` |
| Backup/rollback drill و on-call owner | Ops | پیش از Deploy | backup ID، rollback target و drill result | `BLOCKED` |
| Production smoke با Sale باز و Mutation خاموش | Founder/Ops | پس از Deploy مجاز | health/readiness و route smoke | `BLOCKED` |
| مجوز Deploy | Founder | پیش از Deploy | تأیید صریح دارای SHA/timestamp | `BLOCKED` |

## Gateهای فعال‌سازی

- `PUBLIC_SALE_ENABLED=true`
- تمام provider/source sale gateها `true`
- تمام provider mutation gateها `false`

فروش عمومی در Deploy و Rollback باز می‌ماند. Sellability هر Offer همچنان به Publish ادمین، source/region/freshness و موجودی معتبر وابسته است. Provider mutation برای Launch دستی باز نمی‌شود.

## تصمیم

تا زمان بسته‌شدن تمام blockerهای جدول، حکم Deploy تغییر نمی‌کند: **`NO-GO` برای Production**. این وضعیت مانع Commit، Push، PR و Merge کد آماده نیست و سیاست فروش عمومی نیز طبق دستور Founder باز می‌ماند؛ اما Deploy، پرداخت واقعی و Provider mutation هنوز Evidence و مجوزهای مستقل خود را می‌خواهند.
