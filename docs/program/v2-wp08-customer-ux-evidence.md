# V2-WP08 — AbrChin customer UX evidence

Package ID: `V2-WP08`
Scope: `MESSAGEGO-V2-CONTROL-PLANE@2.0.0`
Depends on: `V2-WP07` at `f4aff370ac015a76905924e3e04196861cead7bd`
Mode: RUNTIME (local/offline/test only)
Status: `COMPLETE`

## Starting heads

- AbrChin origin/main after WP07: `f4aff370ac015a76905924e3e04196861cead7bd`
- MessageGo origin/main at handoff: `f024bdadf4ad9d67e07b6731cf2b3ba0feb56e3f`

## Implementation

Customer commercial surface for MessageGo lives in AbrChin:

- `/account/ai` — wallet, reservation/settlement status, control-plane availability
- `/api/account/ai-billing` — AbrChin-authoritative financial view
- `/api/account/ai-connection` — non-secret connection metadata and one-time handoff

Provider credentials remain MessageGo-owned:

- ordinary AbrChin queries never select `secretRef`
- customer APIs never return raw keys or opaque secret refs
- default handoff port is fail-closed
- isolated tests may use an in-memory handoff adapter that is not a production protocol
- no new authentication technology is locked
- AbrChin is not an inference proxy

`docs/phase-1-product-contract.md` was not modified.

Production activation: denied. Provider traffic: none.

## Validations

```bash
npm run test:messagego-v2-customer-ux
npm run test:messagego-v2-customer-ux-postgres
```

Exact-head re-run is recorded after this commit.
