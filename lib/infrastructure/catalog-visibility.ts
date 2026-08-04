export type CatalogOfferAccess =
  | {
      visible: false;
      purchasable: false;
      purchaseState: "HIDDEN_STALE";
    }
  | {
      visible: true;
      purchasable: false;
      purchaseState:
        | "SALE_DISABLED"
        | "REGION_SALE_DISABLED"
        | "CATALOG_STALE";
    }
  | {
      visible: true;
      purchasable: true;
      purchaseState: "PURCHASABLE";
    };

/**
 * Visibility is an Admin publication decision. Sale and freshness remain
 * independent fail-closed gates for creating a Quote.
 */
export function resolveCatalogOfferAccess(input: {
  catalogFresh: boolean;
  displayDuringProviderOutage: boolean;
  publicSaleEnabled: boolean;
  regionSaleEnabled: boolean;
}): CatalogOfferAccess {
  if (!input.catalogFresh && !input.displayDuringProviderOutage) {
    return {
      visible: false,
      purchasable: false,
      purchaseState: "HIDDEN_STALE",
    };
  }
  if (!input.publicSaleEnabled) {
    return {
      visible: true,
      purchasable: false,
      purchaseState: "SALE_DISABLED",
    };
  }
  if (!input.regionSaleEnabled) {
    return {
      visible: true,
      purchasable: false,
      purchaseState: "REGION_SALE_DISABLED",
    };
  }
  if (!input.catalogFresh) {
    return {
      visible: true,
      purchasable: false,
      purchaseState: "CATALOG_STALE",
    };
  }
  return {
    visible: true,
    purchasable: true,
    purchaseState: "PURCHASABLE",
  };
}
