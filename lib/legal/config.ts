/**
 * Versioned legal entity configuration for AbrChin public pages.
 * Official registration facts stay null until the owner supplies them.
 * Do not invent company identity, jurisdiction, tax status, SLA, or retention.
 */

export const LEGAL_CONFIG_VERSION = "2026-09-01.1";

/** Verified public mailbox. No separate operational support mailbox is evidenced. */
export const PUBLIC_CONTACT_EMAIL = "hello@abrchin.ir";

export type LegalEntityFields = {
  companyLegalName: string | null;
  companyRegistrationNumber: string | null;
  nationalId: string | null;
  postalAddress: string | null;
  jurisdiction: string | null;
  taxStatus: string | null;
  legalRepresentativeName: string | null;
};

/** Required before contractual pages may be indexed or called production-ready. */
export const LEGAL_ENTITY: LegalEntityFields = {
  companyLegalName: null,
  companyRegistrationNumber: null,
  nationalId: null,
  postalAddress: null,
  jurisdiction: null,
  taxStatus: null,
  legalRepresentativeName: null,
};

export const LEGAL_LAUNCH_REQUIRED_FIELDS = [
  "companyLegalName",
  "companyRegistrationNumber",
  "nationalId",
  "postalAddress",
  "jurisdiction",
  "taxStatus",
  "legalRepresentativeName",
] as const satisfies ReadonlyArray<keyof LegalEntityFields>;

/** Optional claims. Null means unpublished — never substitute a placeholder. */
export const LEGAL_UNPUBLISHED_OPTIONAL = {
  supportSla: null,
  dataRetentionPolicy: null,
} as const;

export function missingLegalLaunchFields(
  entity: LegalEntityFields = LEGAL_ENTITY,
): Array<(typeof LEGAL_LAUNCH_REQUIRED_FIELDS)[number]> {
  return LEGAL_LAUNCH_REQUIRED_FIELDS.filter((field) => {
    const value = entity[field];
    return typeof value !== "string" || value.trim().length === 0;
  });
}

export function isLegalLaunchReady(
  entity: LegalEntityFields = LEGAL_ENTITY,
): boolean {
  return missingLegalLaunchFields(entity).length === 0;
}

export function legalRobotsDirective(entity: LegalEntityFields = LEGAL_ENTITY): {
  index: boolean;
  follow: boolean;
} {
  return isLegalLaunchReady(entity)
    ? { index: true, follow: true }
    : { index: false, follow: true };
}
