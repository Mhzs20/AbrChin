# Owner acceptance checklist — AbrChin + MessageGo 1.0.0

Status: **UNSIGNED**. `owner_accepted = false`.
`PRODUCTION NOT AUTHORIZED`. `LIVE PROVIDER TRAFFIC NOT AUTHORIZED`.

Owner: Mohammad
Agent must not check any box. Filling a box requires an explicit Owner
signature and date on a later document.

Public product = MessageGo. Public API = `/v1`. AbrChin Wallet is the only
wallet authority.

## A. Surfaces

- [ ] Desktop UI (`1440×900` or equivalent)
- [ ] Mobile UI (`390×844` or equivalent)

## B. Catalog and purchase

- [ ] Admin publishes an explicitly selected, correctly priced Arvan plan
- [ ] PREPAID 1 month
- [ ] PREPAID 3 months
- [ ] PREPAID 6 months
- [ ] PREPAID 12 months
- [ ] Wallet top-up through the configured gateway
- [ ] Wallet debit of the order (atomic, no double debit)
- [ ] Admin approval 1 (provision / funding)
- [ ] Manual fulfillment recorded
- [ ] Admin approval 2 (delivery)
- [ ] Secure credential delivery (customer reveal only after approval 2)

## C. MessageGo

- [ ] MessageGo AI execution (`POST /v1/ai/execute`) on an authorized staging
      or Owner-approved environment
- [ ] Usage and settlement match the wallet ledger (no parallel MessageGo wallet)

## D. Operations and legal

- [ ] Refund / cancellation wording matches actual ledger behavior
- [ ] Isolated backup restore verified; production restore still not authorized
- [ ] Monitoring / health / readiness understood for the intended hosts
- [ ] Legal content: official identity fields supplied; pages no longer draft
- [ ] Parchin availability: only evidence-approved levels are sold
- [ ] Rollback commands reviewed; no volume wipe / migrate reset

## Signature (leave blank)

```text
Owner: Mohammad
Date:
Decision:
owner_accepted: false
PRODUCTION_AUTHORIZED: false
LIVE_PROVIDER_TRAFFIC_AUTHORIZED: false
```
