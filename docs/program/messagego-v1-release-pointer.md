# MessageGo 1.0.0 release pointer (AbrChin)

Canonical product identity lives in MessageGo:

- `MESSAGEGO-RELEASE@1.0.0`
- Product = MessageGo
- Product version = 1.0.0
- Public API generation = v1
- Customer language = MessageGo / MessageGo AI (never MessageGo V2)

AbrChin keeps the existing wallet as the only wallet authority.

Production-facing gates on this repository:

- `MESSAGEGO_SETTLEMENT_ENABLED` (default false)
- `MESSAGEGO_CUSTOMER_AI_ENABLED` (default false)
- `MESSAGEGO_SECRET_HANDOFF_ENABLED` (default false)

Deprecated `MESSAGEGO_V2_*` names are rejected.

Private S2S settlement remains at
`POST /api/internal/messagego/v2/settlement`. That path is not a public
customer API.

Handoff path default remains `/internal/v2/handoff` because the handoff
contract pins it.

Do not deploy, apply production Prisma migrations, or send live provider
traffic without explicit Founder authorization.

Historical V2 program pointers and WP evidence remain in `docs/program/v2-*`
and `docs/program/messagego-v2-pointer.md`.
