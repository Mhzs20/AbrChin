# Auth and SMS

## Overview
AbrChin uses a first-party OTP login. Sessions are server-side and stored as hashed tokens in PostgreSQL.

## Providers
- `console`: Development only. Logs OTP to server console.
- `kavenegar`: Production-ready VerifyLookup REST adapter.

In Production, `console` and unknown providers fail closed.

## Kavenegar
`POST https://api.kavenegar.com/v1/{API_KEY}/verify/lookup.json`

Fields: `receptor`, `token`, `template`, `type=sms`

## Admin access policy (source of truth)

`ADMIN_MOBILES` is the **explicit bootstrap / allowlist** for production admin access.

- On successful OTP login, a mobile in `ADMIN_MOBILES` is promoted to `ADMIN`.
- A mobile **not** in the allowlist is demoted to `CUSTOMER` on login (stale DB role is repaired).
- Authorization (`requireAdmin`, admin command actors, `toPublicUser`) re-checks the allowlist on every request.
- Removing a mobile from `ADMIN_MOBILES` therefore blocks admin UI/API even if `User.role` is still `ADMIN` and an old session cookie remains.
- Persisted `ADMIN` role alone is never sufficient.
- No full RBAC in phase 1.

## OTP abuse controls

OTP request/verify rate limits are PostgreSQL-backed (`RateLimitBucket`):

- request by normalized mobile
- request by client IP
- verify by mobile
- verify by IP

Limits are atomic, restart-safe, and shared across web replicas. Non-critical in-memory limiters may remain for quote IP / credential reveal probing (credential reveal still has one-time domain protections).

## Security notes
- API key and full request URL are never logged.
- OTP is never logged in Production.
- Failed SMS delivery deletes the OTP challenge.
- `/api/auth/request-otp` responses are enumeration-safe.
- Forwarded Host/Proto/IP headers are trusted only when `TRUSTED_PROXY_HOPS > 0`.
