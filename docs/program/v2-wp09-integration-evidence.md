# V2-WP09 — AbrChin integration evidence pointer

Package ID: `V2-WP09`
Scope: `MESSAGEGO-V2-CONTROL-PLANE@2.0.0`
Canonical evidence: MessageGo `docs/program/v2-wp09-integration-security-reliability-evidence.md`

Starting AbrChin origin/main: `1724bd1d79b64606bec631000a8a842e4e49cb9e`

AbrChin remains wallet authority. AbrChin is not an inference proxy.
No raw provider secret is retained in ordinary customer APIs.
Customer APIs do not expose `secretRef`.
`docs/phase-1-product-contract.md` is unchanged
(`git hash-object` `9bb2311d7dc7a01d87b31c664ec65c1cb346efaa`).

Local/offline WP09 seams:

- private settlement HTTP remains `/api/internal/messagego/v2/settlement`
- fail-closed server-to-server auth
- replaceable control-plane probe (`MESSAGEGO_CONTROL_PLANE_PROBE`)
- test-only isolated sidecar `scripts/messagego-v2-wp09-settlement-sidecar.mts`

Local/offline WP09 commands:

```bash
npm run test:messagego-v2-integration
npm run test:messagego-v2-integration-postgres
npm run test:messagego-v2-settlement
npm run test:messagego-v2-settlement-postgres
npm run test:messagego-v2-customer-ux
npm run test:messagego-v2-customer-ux-postgres
```

Production impact: NONE. Provider traffic: NONE. Migrations authored: NONE.
Existing WP07 migration `20260826100000_messagego_v2_wallet_authority` is reused
in isolated PostgreSQL tests only.
