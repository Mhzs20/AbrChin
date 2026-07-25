# Manual acceptance test

## Development
1. Start local Postgres and set `.env` from `.env.example`
2. `npx prisma migrate deploy && npm run dev`
3. Open `/login`
4. Request OTP (`SMS_PROVIDER=console` → read OTP from server log, or use Kavenegar)
5. Verify and land on `/account`
6. Open `/account/wallet/topup`, choose amount, confirm
7. On mock gateway choose successful payment
8. Confirm balance increased on `/account/wallet`
9. Open `/account/orders`, create STARTER, pay with wallet
10. Confirm ledger on `/account/transactions`
11. Logout

## Checks
- Guest `/account` redirects to `/login`
- `/api/wallet` without session returns 401
- Public homepage and Enamad shell unchanged
