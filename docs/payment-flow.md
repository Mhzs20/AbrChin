# Payment flow

## Providers
- `Zibal` — Production default (official REST: `https://gateway.zibal.ir/v1/request|verify`, start `/start/{trackId}`)
- `ZarinPal` — alternate Production gateway (official REST v4)
- `Mock` — Development/Test only

User does **not** pick a gateway in v1. The server uses the admin-configured default.

## Gateway config (DB, no secrets)
`PaymentGatewayConfig` stores enabled/default/priority/environment.
Credentials live only in env:
- `ZIBAL_MERCHANT`, `ZIBAL_TIMEOUT_MS`
- `ZARINPAL_MERCHANT_ID`, `ZARINPAL_SANDBOX`, `ZARINPAL_TIMEOUT_MS`
- `PAYMENT_CALLBACK_BASE_URL`, `PAYMENT_BOOTSTRAP_DEFAULT_PROVIDER`

## Top-up flow
1. Authenticated user posts toman amount to `/api/wallet/topups`
2. `PaymentGatewayResolver` loads enabled+default config and validates env credentials
3. `WalletTopUp` is created with locked `gateway` + `gatewayConfigSnapshot` (no secrets)
4. Provider `createPayment` returns redirect URL (no automatic failover to second provider)
5. Provider-specific callback:
   - `/api/payments/zibal/callback`
   - `/api/payments/zarinpal/callback`
   - `/api/payments/mock/callback`
6. Server verifies with the **locked** TopUp provider using DB amount
7. Success: one transaction marks TopUp SUCCEEDED, CREDIT ledger, balance increment

## Admin
- UI: `/admin/payment-gateways`
- APIs: `GET /api/admin/payment-gateways`, `PATCH /api/admin/payment-gateways/:provider`, `POST .../make-default`
- Changing default affects **new** top-ups only

## Refund
v1 refunds remain internal wallet credits (`LedgerType.REFUND`). No bank refund API calls.
