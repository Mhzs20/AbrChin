/**
 * A Parchin tier is publicly sellable only when the catalog row is active and
 * operational evidence has been approved. Node test runners may bypass the
 * evidence timestamp for existing purchase fixtures; production never does.
 */

export type ParchinSellableRow = {
  active: boolean;
  operationalEvidenceApprovedAt?: Date | string | null;
};

export function isIsolatedAutomatedTest(): boolean {
  return process.env.ABRCHIN_ISOLATED_TEST === "1";
}

function isNodeTestRunner(): boolean {
  return Boolean(process.env.NODE_TEST_CONTEXT);
}

export function isParchinConfigSellable(
  row: ParchinSellableRow | null | undefined,
  options?: { allowTestBypass?: boolean },
): boolean {
  if (!row?.active) return false;
  if (row.operationalEvidenceApprovedAt) return true;
  const allowTestBypass = options?.allowTestBypass !== false;
  if (allowTestBypass && (isIsolatedAutomatedTest() || isNodeTestRunner())) {
    return true;
  }
  return false;
}

export const UNSUPPORTED_PARCHIN_SLA_PATTERNS = [
  "۲۴/۷",
  "24/7",
  "پایش Uptime پنج‌دقیقه‌ای",
  "پایش حیاتی شبانه‌روزی",
  "بکاپ روزانه مدیریت‌شده",
  "آزمون Restore ماهانه",
] as const;

export function claimsRequireOperationalEvidence(text: string): boolean {
  return UNSUPPORTED_PARCHIN_SLA_PATTERNS.some((pattern) => text.includes(pattern));
}
