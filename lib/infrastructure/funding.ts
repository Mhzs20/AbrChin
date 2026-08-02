import { assertPositiveIntegerToman } from "@/lib/money";
import { WalletError } from "@/lib/wallet/errors";

/**
 * Retired in Phase 1.6. A provider-funding form used to create a provisioning
 * job directly. The first Admin approval is now recorded through
 * `approveProvision`, and no internal caller may use this legacy shortcut.
 */
export async function confirmProviderFunding(params: {
  infrastructureOrderId: string;
  adminUserId: string;
  fundedAmountToman: number;
  receiptReference?: string | null;
  note?: string | null;
  idempotencyKey?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}) {
  void params;
  throw new WalletError(
    "route_retired",
    "تأیید ساخت فقط از مسیر فرمان Provision ادمین انجام می‌شود.",
  );
}

export function parseFundedAmountToman(value: unknown): number {
  return assertPositiveIntegerToman(value);
}
