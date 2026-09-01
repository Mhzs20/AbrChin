/**
 * GET/page-render mutation audit (release blocker).
 *
 * Customer-facing GET / RSC render must not mutate commercial or wallet state.
 * Updated when quote/storefront/renew/wallet GET side effects were removed.
 *
 * Findings fixed:
 * - app/cloud-servers/quote/[id]/page.tsx — removed plan PAYG→PREPAID update,
 *   silent refreshRecommendationQuote, ensureWalletForUser
 * - app/ready-servers/quote/[id]/page.tsx — same refresh + wallet GET writes
 * - lib/storefront/assortment-service listPublicStorefrontTiers — removed
 *   ensureStorefrontSaleReady + settings upsert from public GET
 * - lib/recommendation/delivery-service configureConversationDelivery — no
 *   ensureStorefrontSaleReady; customers/guests cannot publish catalog
 * - app/api/account/instances/[id]/renew GET — no longer creates renewal quotes
 * - app/api/wallet* GET — read-only getWalletForUser (empty/zero if absent)
 * - getTopUpSettingsView / getPublicDefaultGatewaySummary — no seed on read
 *
 * Intentional write paths (OK):
 * - POST /api/cloud-servers|ready-servers/quotes/[id]/refresh
 * - POST /api/orders (may refresh quote on price change)
 * - POST renew without renewalQuoteId creates quote; with id pays
 * - OTP verify / ledger / payments / admin ops may ensureWalletForUser
 * - Admin storefront slot replace may call ensureStorefrontSaleReady
 * - Payment gateway callback GETs (provider redirect pattern)
 */
export const CUSTOMER_GET_MUTATION_AUDIT = [
  {
    path: "app/cloud-servers/quote/[id]/page.tsx",
    status: "fixed",
    note: "read-only active quote; expired UI + POST refresh",
  },
  {
    path: "app/ready-servers/quote/[id]/page.tsx",
    status: "fixed",
    note: "read-only active quote; expired UI + POST refresh",
  },
  {
    path: "lib/storefront/assortment-service.ts#listPublicStorefrontTiers",
    status: "fixed",
    note: "no ensureStorefrontSaleReady / upsert on GET",
  },
  {
    path: "app/api/account/instances/[id]/renew/route.ts#GET",
    status: "fixed",
    note: "returns existing ACTIVE quote only",
  },
] as const;
