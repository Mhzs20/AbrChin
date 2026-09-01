# Owner acceptance checklist — AbrChin + MessageGo 1.0.0

Status: **UNSIGNED**. `owner_accepted = false`.
`PRODUCTION NOT AUTHORIZED`. `LIVE PROVIDER TRAFFIC NOT AUTHORIZED`.

Owner: Mohammad
Agent must not check any box. Filling a box requires an explicit Owner
signature and date on a later document. Local WP6 gates are not Owner
acceptance.

Public product = MessageGo. Public API = `/v1`. AbrChin Wallet is the only
wallet authority. Do not treat internal package names as public V2 branding.

Use a Founder-authorized staging host. Do not enable live Arvan mutations or
live provider traffic unless a later Owner document authorizes them.

## A. Surfaces

- [ ] Desktop UI (`1440×900` or equivalent)
      Open `/`, `/cloud-servers`, a published quote, wallet, and the customer
      order page at `1440×900`. Confirm Persian copy, no horizontal overflow,
      and that the next action is visible.
- [ ] Mobile UI (`390×844` or equivalent)
      Repeat the same routes at `390×844`. Confirm tap targets, no clipped
      CTA, and that money amounts remain readable.

## B. Catalog and purchase

- [ ] Admin publishes an explicitly selected, correctly priced Arvan plan
      Admin maps one Arvan SKU, sets markup, publishes it. Confirm the
      storefront shows only that published offer (catalog is not auto-published).
- [ ] PREPAID 1 month
      Guest quote `PREPAID_TERM` 1 month → login/claim → wallet debit → order
      created. Quote TTL is 60 minutes.
- [ ] PREPAID 3 months
      Repeat the Golden Path for 3 months. Price must match the published SKU.
- [ ] PREPAID 6 months
      Repeat the Golden Path for 6 months.
- [ ] PREPAID 12 months
      Repeat the Golden Path for 12 months.
- [ ] Wallet top-up through the configured gateway
      Gateway credits the AbrChin wallet only. Confirm ledger credit, no
      double credit on callback retry.
- [ ] Wallet debit of the order (atomic, no double debit)
      Purchase debits the wallet ledger once. Retry/refresh must not create a
      second debit.
- [ ] Admin approval 1 (provision / funding)
      Payment success must not provision. First Admin approval is required.
      Re-check price/provider state before approving.
- [ ] Manual fulfillment recorded
      Record the manual Arvan/READY_INSTANT_SERVER fulfillment against the
      same order. Retry must not create a second resource.
- [ ] Admin approval 2 (delivery)
      Second Admin approval is required before the customer can see credentials.
- [ ] Secure credential delivery (customer reveal only after approval 2)
      Confirm credentials are encrypted at rest, masked in admin, absent from
      logs, and hidden from the customer until approval 2.

## C. MessageGo

- [ ] MessageGo AI execution (`POST /v1/ai/execute`) on an authorized staging
      or Owner-approved environment
      Public API remains `/v1`. Do not call production providers. Confirm the
      product UI says MessageGo / MessageGo AI, never a public “V2” name.
- [ ] Usage and settlement match the wallet ledger (no parallel MessageGo wallet)
      Usage reservation, settlement, and release must hit the existing AbrChin
      wallet. Confirm no second financial subsystem.

## D. Operations and legal

- [ ] Refund / cancellation wording matches actual ledger behavior
      Cancel/refund before delivery must match the ledger and the public
      refund-policy page. Do not assume a bank refund happened unless the
      gateway evidence exists.
- [ ] Isolated backup restore verified; production restore still not authorized
      Review isolated restore receipts. Do not restore onto production.
- [ ] Monitoring / health / readiness understood for the intended hosts
      Confirm `/api/health`, `/api/readiness`, worker heartbeat, and MessageGo
      fail-closed flags for the intended staging/production hosts.
- [ ] Legal content: official identity fields supplied; pages no longer draft
      Fill `docs/launch/legal-entity-blocker.md` / `LEGAL_ENTITY`. Until then,
      legal pages remain draft/noindex.
- [ ] Parchin availability: only evidence-approved levels are sold
      Confirm unsupported Parchin claims stay fail-closed and are not sold.
- [ ] Rollback commands reviewed; no volume wipe / migrate reset
      Review AbrChin image rollback. Forbidden: `docker compose down -v` and
      `prisma migrate reset`.

## Signature (leave blank)

```text
Owner: Mohammad
Date:
Decision:
owner_accepted: false
PRODUCTION_AUTHORIZED: false
LIVE_PROVIDER_TRAFFIC_AUTHORIZED: false
```
