# V2-WP07 — AbrChin wallet authority evidence

Package ID: `V2-WP07`
Scope: `MESSAGEGO-V2-CONTROL-PLANE@2.0.0`
Contract: `MESSAGEGO-V2-ABRCHIN-SETTLEMENT@2.0.0`
Pinned digest: `b943e627a5486fd4ae6ae5e062cc7b220ccb945808cebb4757ef42262f882f33`
Mode: RUNTIME (local/offline/test only)
Status: `COMPLETE`

## Starting heads

- AbrChin origin/main: `0dc90854b5d18ae4b9f0493e0a50a0da6ac3a41a`
- MessageGo origin/main at handoff: `f024bdadf4ad9d67e07b6731cf2b3ba0feb56e3f`

## Implementation

AbrChin remains the only wallet authority. Existing `Wallet` + append-only
`WalletLedgerEntry` are reused. No parallel AI wallet was created.

Operations against the pinned settlement contract:

- `reserve` — holds integer IRR rials from `Wallet.availableBalance`
- `settle` — applies `customer_billable_amount` against the hold; leftover returns
- `release` — eligible reserved holds only
- `reconcile` — late/exact truth after `UNCERTAIN` or reserved state

Invariants covered by tests:

- lossless integer rial strings; JSON number money rejected
- identical `operation_id` + body replays the same outcome
- identical `operation_id` + conflicting body is deterministic conflict
- insufficient funds, unknown reservation, account/scope mismatch fail closed
- released then settle / settled then release conflict without extra mutation
- uncertain settle then reconcile appends history and does not overwrite it
- concurrent identical reserve mutates the wallet once
- provider usage/cost are not applied as wallet amounts
- settlement HTTP is private, fail-closed in production, and rejects browsers
- payment callbacks are not connected to AI settlement
- AbrChin is not an inference proxy (`inference_proxy: false`)

`docs/phase-1-product-contract.md` was not modified
(`git hash-object` `9bb2311d7dc7a01d87b31c664ec65c1cb346efaa`).

Production activation: denied. Provider traffic: none.

## Validations

```bash
npm run test:messagego-v2-settlement
npm run test:messagego-v2-settlement-postgres
```

Results at implementation time: unit tests pass; isolated PostgreSQL
settlement tests pass. Exact-head re-run is recorded after this commit.

## Production impact

NONE. No deploy. No real wallet debit against customer production data.
No real MessageGo call. No real provider credentials.
