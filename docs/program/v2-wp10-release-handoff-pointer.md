# MessageGo V2-WP10 — AbrChin release/handoff pointer

This file is **not** production authorization.

V2-WP10 on MessageGo records release/handoff preparation for
`MESSAGEGO-V2-CONTROL-PLANE@2.0.0`. AbrChin remains the wallet authority for
canonical V2 settlement. Production remains denied.

Canonical package: MessageGo
`docs/program/v2-wp10-release-handoff.md`

Local production-denied proofs:

- `lib/messagego/settlement/service-auth.ts` throws `production_denied` when
  `NODE_ENV=production`.
- `compose.production.yaml` does **not** pass
  `MESSAGEGO_SETTLEMENT_SERVICE_CREDENTIAL`.
- No AbrChin inference routes exist.
- WP10 must not apply
  `prisma/migrations/20260826100000_messagego_v2_wallet_authority` to
  production.

Single AbrChin release-readiness command:

```bash
npm run test:messagego-v2-release-readiness
```

That umbrella re-runs the WP07–WP09 MessageGo package tests plus wallet
regressions. Component commands underneath:

```bash
npm run test:messagego-v2-release-readiness-guards
npm run test:messagego-v2-settlement
npm run test:messagego-v2-settlement-postgres
npm run test:messagego-v2-customer-ux
npm run test:messagego-v2-customer-ux-postgres
npm run test:messagego-v2-integration
npm run test:messagego-v2-integration-postgres
npm run test:wallet
```

WP10 status: COMPLETE for package execution.
PRODUCTION = DENIED
PROVIDER_TRAFFIC = DENIED
wp10_production_authorization = false
