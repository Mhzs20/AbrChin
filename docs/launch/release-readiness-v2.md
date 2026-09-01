# Release Readiness — ابرچین + MessageGo 1.0.0

**Verdict: `NO-GO` برای Deploy Production تا Owner acceptance، داده حقوقی، Staging/Production evidence و مجوز صریح Founder**
Publication branch: `origin/main`
Public Sale: **تأیید Founder و پیش‌فرض باز** — Provider mutation: **خاموش**
Owner acceptance: `owner_accepted = false`
`PRODUCTION NOT AUTHORIZED`
`LIVE PROVIDER TRAFFIC NOT AUTHORIZED`

Canonical current evidence: `docs/launch/wp6-release-truth.md` and
`docs/launch/evidence/wp6/receipt.json`. Historical Launch V2 worktree
receipts remain below as dated artifacts; they are not current SHA, migration
count, or deploy authorization.

## Current publication truth

- Product customer language = MessageGo / MessageGo AI. Public API = `/v1`.
- AbrChin Wallet remains the only wallet authority.
- Work is published on `origin/main`. Draft PR is not the current process.
- Prisma migration count in tree: **59** forward-only directories.
- WP5 local production-candidate Golden Path: recorded separately; it is not
  production authorization.
- Legal identity fields in `docs/launch/legal-entity-blocker.md` remain empty.

## حکم داخلی (مهندسی محلی)

Golden Path عمومی Launch، `PREPAID_TERM` با دوره‌های ۱، ۳، ۶ و ۱۲ ماه است.
PAYG در Backend برای مسیرهای legacy/internal حفظ می‌شود و مسیر فروش عمومی نیست.
این نتیجه جای Staging/Production evidence، Owner acceptance و مجوز Deploy را
نمی‌گیرد.

| Gate داخلی | وضعیت | Evidence |
| --- | --- | --- |
| Launch V2 Phases 0–9 (historical 2026-08-10) | `HISTORICAL` | Worktree log; see `docs/launch/abrchin-automation-status.md` |
| WP5 production-candidate | `RECORDED` | `docs/launch/evidence/wp5/receipt.json` |
| WP6 release-truth gates | `READY_FOR_OWNER_TEST` | `docs/launch/evidence/wp6/receipt.json` — re-run `2026-09-01T23:09:12.231Z` on AbrChin `991f625` / MessageGo `c822352`; fail=0 skip=0; not owner acceptance |
| Production dependency audit | see WP6 receipt | `npm audit --omit=dev --audit-level=low` |
| Secret scan | see WP6 receipt | `npm run test:secret-scan` |
| Production compose validation | see WP6 receipt | `docker compose … config` (file validation; daemon may be down) |

## Blockerهای خارجی و فرایندی

| Blocker | Owner | Due | Evidence لازم | وضعیت |
| --- | --- | --- | --- | --- |
| Owner acceptance | Founder | پیش از Deploy | checklist امضاشده؛ هیچ Agentی `owner_accepted` را ثبت نمی‌کند | `BLOCKED` — checklist آماده و unsigned است |
| ظرفیت انسانی عملیات و On-call پرچین | Ops/SRE/Support/Security | پیش از Deploy | Owner صف روزانه، برنامه P1 و Staging drill | `BLOCKED` |
| PostgreSQL واقعی Staging | Engineering/Ops | پیش از Staging purchase | migrate log روی Staging؛ این محیط محلی جایگزین Staging نیست | `BLOCKED` |
| Staging purchase واقعی PREPAID | Founder/Ops/Finance | پیش از Deploy Production | sanitized Golden Path receipt روی Staging | `BLOCKED` |
| داده حقوقی و هویتی شرکت | Founder/Legal | پیش از انتشار صفحات حقوقی | `docs/launch/legal-entity-blocker.md`؛ فیلدهای رسمی هنوز خالی‌اند | `BLOCKED` |
| Production env/OTP/SMTP/Gateway/Provider read-only checks | Ops | پیش از Deploy | readiness و connection-check artifact روی Production | `BLOCKED` |
| Backup/rollback drill روی Production | Ops | پیش از Deploy | backup ID تولیدی و restore drill غیر از isolated local | `BLOCKED` |
| Production smoke | Founder/Ops | پس از Deploy مجاز | health/readiness و route smoke روی Production | `BLOCKED` |
| مجوز Deploy | Founder | پیش از Deploy | تأیید صریح دارای SHA/timestamp | `BLOCKED` |

## Gateهای فعال‌سازی (قرارداد Launch، نه مجوز Deploy)

- `PUBLIC_SALE_ENABLED=true`
- تمام provider/source sale gateها `true`
- تمام provider mutation gateها `false`
- `MESSAGEGO_SETTLEMENT_ENABLED=false`
- `MESSAGEGO_CUSTOMER_AI_ENABLED=false`
- `MESSAGEGO_SECRET_HANDOFF_ENABLED=false`
- `CRX_PROVIDER_TRAFFIC_ENABLED=false`

فروش عمومی در Deploy و Rollback باز می‌ماند. Sellability هر Offer همچنان به
Publish ادمین، source/region/freshness و موجودی معتبر وابسته است. Provider
mutation برای Launch دستی باز نمی‌شود.

## تصمیم

تا زمان بسته‌شدن تمام blockerهای جدول و امضای Owner، حکم Deploy تغییر نمی‌کند:
**`NO-GO` برای Production**. انتشار روی `origin/main` مجوز Deploy، پرداخت واقعی
یا Provider traffic نیست.
