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

## Security notes
- API key and full request URL are never logged.
- OTP is never logged in Production.
- Failed SMS delivery deletes the OTP challenge.
- `/api/auth/request-otp` responses are enumeration-safe.
