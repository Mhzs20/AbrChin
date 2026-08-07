import { UserRole } from "@prisma/client";

import { isAdminMobile } from "@/lib/env";

/**
 * Source of truth for production admin access:
 * - ADMIN_MOBILES is the explicit bootstrap / allowlist.
 * - Persisted User.role = ADMIN alone is not sufficient.
 * - Removing a mobile from ADMIN_MOBILES must deny admin authz even if a
 *   stale ADMIN role remains in the database.
 */
export function isEligibleAdmin(user: {
  role: UserRole | string;
  mobile: string;
}): boolean {
  return user.role === UserRole.ADMIN && isAdminMobile(user.mobile);
}

export function effectiveUserRole(user: {
  role: UserRole | string;
  mobile: string;
}): UserRole {
  if (user.role === UserRole.ADMIN && !isAdminMobile(user.mobile)) {
    return UserRole.CUSTOMER;
  }
  return user.role === UserRole.ADMIN ? UserRole.ADMIN : UserRole.CUSTOMER;
}
