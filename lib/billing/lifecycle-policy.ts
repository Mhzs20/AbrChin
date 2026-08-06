import { prisma } from "@/lib/db";

// Canonical home of the term-discount table is the pure commercial engine so
// client components can import it without pulling prisma into the bundle.
export {
  TERM_DISCOUNT_BPS,
  isBillingTermMonths,
} from "@/lib/pricing/commercial-engine";

export type LifecyclePolicy = {
  reminderDaysBeforeDue: number;
  suspendGraceDaysAfterZero: number;
  deleteDaysAfterSuspend: number;
};

export const DEFAULT_LIFECYCLE_POLICY: LifecyclePolicy = {
  reminderDaysBeforeDue: 7,
  suspendGraceDaysAfterZero: 7,
  deleteDaysAfterSuspend: 7,
};

export async function getLifecyclePolicy(): Promise<LifecyclePolicy> {
  const row = await prisma.commercePricingConfig.findUnique({
    where: { id: "default" },
  });
  return {
    reminderDaysBeforeDue:
      row?.reminderDaysBeforeDue ?? DEFAULT_LIFECYCLE_POLICY.reminderDaysBeforeDue,
    suspendGraceDaysAfterZero:
      row?.suspendGraceDaysAfterZero ??
      DEFAULT_LIFECYCLE_POLICY.suspendGraceDaysAfterZero,
    deleteDaysAfterSuspend:
      row?.deleteDaysAfterSuspend ?? DEFAULT_LIFECYCLE_POLICY.deleteDaysAfterSuspend,
  };
}

