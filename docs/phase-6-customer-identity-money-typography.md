# Phase 6 — Customer Identity / Email Verification / Money Typography

## Root cause (money font)

Customer wallet amounts used `.product-tech` (ui-monospace / Menlo). `formatTomanFa()` was already correct (`fa-IR`).

**Fix:** `.product-money` (Mikhak) + `MoneyDisplay` / header wallet audit. Technical IDs stay on `.product-tech`.

## Identity

New User fields: `firstName`, `lastName`, `email` (unique, normalized), `emailVerifiedAt`, `registrationCompletedAt`.

Migration: `20260807150000_customer_identity_email_verification`  
Existing users backfilled `registrationCompletedAt = createdAt`. New customers must complete registration before `/account/*`.

## Registration flow

mobile OTP → if new CUSTOMER → `/register/complete` (نام، نام خانوادگی، ایمیل) → `POST /api/auth/complete-registration` → destination.

## Email verification

From Profile only. `EMAIL_PROVIDER=console|smtp`. Production requires SMTP. Env: `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_TIMEOUT_MS`, `EMAIL_VERIFICATION_TTL_SECONDS`.

APIs: `POST /api/account/email-verification/request|verify`, extended `PATCH /api/account/profile`.

## Deploy

Not performed. No auto-merge.
