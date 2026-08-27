# V2-PREPROD-01 — AbrChin pointer

Not production authorization. Not V2-WP11.

Canonical package lives in MessageGo:

- `docs/program/v2-preprod-01-state.json`
- `docs/program/v2-preprod-01-evidence.md`
- `docs/program/v2-preprod-01-production-wiring.md`
- `docs/program/v2-preprod-01-owner-next-decision.md`

PREPROD_01 is independent of WP01–WP10. Canonical program remains
`V2-WP01..V2-WP10 = COMPLETE` and `release_handoff = COMPLETE`.

This repository adds:

- Default-OFF gates: `MESSAGEGO_V2_SETTLEMENT_ENABLED`,
  `MESSAGEGO_V2_CUSTOMER_UX_ENABLED`, `MESSAGEGO_V2_SECRET_HANDOFF_ENABLED`
- Directional HMAC-SHA256 verify/sign (`lib/messagego/s2s/hmac.ts`)
- PostgreSQL replay table `MessageGoS2SReplayNonce`
  (`prisma/migrations/20260827120000_messagego_v2_s2s_replay`)
- HMAC provider-secret handoff port (default OFF)
- Compose declarations with gates false and no bearer settlement secret

Phase 1 locked contract must remain
`git hash-object docs/phase-1-product-contract.md` =
`9bb2311d7dc7a01d87b31c664ec65c1cb346efaa`.

Settlement pin remains `MESSAGEGO-V2-ABRCHIN-SETTLEMENT@2.0.0` /
`b943e627a5486fd4ae6ae5e062cc7b220ccb945808cebb4757ef42262f882f33`.

```bash
npm run test:messagego-v2-preprod
npm run test:messagego-v2-preprod-postgres
```

PRODUCTION = DENIED
PROVIDER_TRAFFIC = DENIED
