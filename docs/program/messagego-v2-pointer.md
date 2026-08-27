# MessageGo V2 program pointer

Canonical approved V2 scope and agentic program controller live in
`Mhzs20/MessageGo` on `main`:

- Scope: `MESSAGEGO-V2-CONTROL-PLANE@2.0.0`
- Program state: `docs/program/messagego-v2-program-state.json`
- Runbook: `docs/program/messagego-v2-agent-runbook.md`
- Commands: `make v2-next-work`, `make v2-program-status`, `make v2-program-check`

This repository keeps only the minimum AbrChin-side pointer and a digest pin of
the canonical V2 settlement contract. Resume from MessageGo repository state.
Do not treat this file as a second V2 scope.

AbrChin-side WP07 evidence:
`docs/program/v2-wp07-wallet-authority-evidence.md`

AbrChin-side WP08 evidence:
`docs/program/v2-wp08-customer-ux-evidence.md`

Cross-repository completion handoff:
`docs/program/v2-wp07-wp08-completion-handoff.md`

AbrChin-side WP09 evidence pointer:
`docs/program/v2-wp09-integration-evidence.md`

WP09 implementation is local/offline integration, security, and reliability
evidence.

## Production and WP10

V2-WP10 is COMPLETE for release/handoff package execution on MessageGo.
This is **not** production authorization. Production remains denied.
`PRODUCTION = DENIED`. `PROVIDER_TRAFFIC = DENIED`.
`wp10_production_authorization` remains false.

Do not deploy MessageGo or AbrChin, mutate production, apply the V2 Prisma
migration to production, or send live provider traffic.

Canonical handoff: MessageGo `docs/program/v2-wp10-release-handoff.md`
AbrChin pointer: `docs/program/v2-wp10-release-handoff-pointer.md`

