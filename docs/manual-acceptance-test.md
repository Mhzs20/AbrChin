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
9. Open `/compass`, complete a short and a migration-shaped conversation
10. Confirm the question path adapts and real quotes show a 10-minute countdown
11. Select a quote, pay with wallet, and confirm the locked amount is charged
12. Confirm provisioning status on the order detail
13. As admin, register a temporary instance credential
14. As customer, reveal it once and confirm the second reveal is rejected
15. In Admin, Sync Catalog and confirm item/priced/unavailable counts, resources,
    base price, final price and sanitized errors
16. Set global Markup and confirm Quick Buy/Compass prices change without editing a Plan price
17. Open an active instance, request a 10-minute renewal quote, confirm the current
    price, then pay it manually
18. Confirm there is no auto-renew switch or automatic wallet charge
19. Confirm the independent renewal snapshot and ledger on `/account/transactions`
20. Open `/status` and verify web, database, and worker state
21. Logout

## Checks
- Guest `/account` redirects to `/login`
- `/api/wallet` without session returns 401
- `/api/readiness` returns 200 only when database and worker are healthy
- A high-criticality request gets no purchasable quote unless a real backup-capable
  offer exists
- Public homepage and Enamad shell unchanged
- Customer JSON/UI never contains Provider name or Provider Base Price
- A missing/unavailable Size cannot create a Quote or reach wallet debit
- A price/Markup change before payment returns a fresh quote instead of charging
