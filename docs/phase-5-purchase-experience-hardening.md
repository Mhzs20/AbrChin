# Phase 5 — Purchase Experience Hardening (Before / After)

## Scope

No new business features. Hardened the merged Phases 0–4 customer lifecycle:

Catalog → Delivery config → 60-minute locked quote → Wallet → Top-up → Purchase → Active server → Upgrade → Cancel → Refund

## Product QA (20 checks)

| # | Check | Before | After |
|---|---|---|---|
| 1 | Know what they buy | Pass | Pass (Persian resource labels) |
| 2 | Full OS names | Pass | Pass |
| 3 | No invalid SSH | Pass | Pass |
| 4 | Password default | Pass | Pass |
| 5 | Hostname default | Pass | Pass |
| 6 | Term, not discount logic | Pass | Pass |
| 7 | Coupon secondary | Pass | Pass (+ conversation note) |
| 8 | Lock says 60 minutes | **Fail** (clock only / 10‑min leftovers) | **Pass** |
| 9 | No TTL repricing | Pass | Pass |
| 10 | Wallet settlement | Pass | Pass |
| 11 | Gateway = top-up only | Partial | Pass (copy + no order gateway CTA) |
| 12 | Exact shortfall | Pass | Pass |
| 13 | Top-up → same quote | Pass | Pass |
| 14 | Expiry keeps credit | Pass | Pass |
| 15 | Cancel refund preview | Pass (Provider leak) | Pass |
| 16 | Upgrade cost preview | Pass | Pass (product-* shells) |
| 17 | Financial idempotency | Partial (top-up create) | Pass (client keys) |
| 18 | Blockers near cause | Partial | Improved (customer wording) |
| 19 | No provider leaks | Partial | Pass on customer surfaces |
| 20 | RTL controls | Partial risk | Pass (native DS controls; no custom chrome) |

**Design:** Additive gradient/shadow polish was removed. Customer surfaces now use the existing AbrChin product design system (`product-section`, `product-stat-*`, `product-row-card`, `product-btn`, existing `order-checkout-*` / `quote-lock-banner` / `ready-quote-*`).

## Live screenshots

Captured from the running app at `http://localhost:3010` (not static HTML demos), after seeding customer fixtures:

| File | Live state |
|---|---|
| `configuration-desktop.png` / `configuration-mobile.png` | `/cloud-servers?plan=…` delivery form expanded |
| `checkout-sufficient.png` | Locked 60‑minute quote, wallet covers amount |
| `checkout-insufficient.png` | Exact shortfall + top-up CTA |
| `quote-expired.png` | Expired quote refresh UI |
| `cancel-refund-preview.png` | Cancel confirm dialog with refund math |
| `upgrade-quote.png` | Upgrade quote with 60‑minute lock |

Artifact path: `/opt/cursor/artifacts/screenshots/`.

## Regression

- `npm run typecheck` ✅
- `npm run lint` ✅ (0 errors)
- Relevant suites: auth, wallet, subscription, customer-navigation, recommendation, infrastructure, accounting, providers, payments, billing-policy, migration-safety, readiness, wallet-recovery, locked-quote ✅
- `npm run build` ✅

Invariant spot-check:

- Wallet: top-up create now sends stable `Idempotency-Key`
- Order create: client key + server `quote-checkout:{quoteId}`
- Quote expiry: no wallet mutation in `expireLockedQuoteContractTx`
- Upgrade debit: `resource_change_upgrade_debit_*` + accounting posting
- Provider mutations remain gated; no silent resize without financial commitment

## Deploy

Not performed. No auto-merge.
