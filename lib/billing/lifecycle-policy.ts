import { prisma } from "@/lib/db";

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

/** Fixed term discounts when no server-purchase coupon overrides them. */
export const TERM_DISCOUNT_BPS: Record<1 | 3 | 6 | 12, number> = {
  1: 0,
  3: 500,
  6: 1_000,
  12: 2_000,
};

export function isBillingTermMonths(value: unknown): value is 1 | 3 | 6 | 12 {
  return value === 1 || value === 3 || value === 6 || value === 12;
}
