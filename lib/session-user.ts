import type { User } from "@prisma/client";

import { effectiveUserRole } from "@/lib/admin/eligibility";

export type PublicUser = {
  id: string;
  mobile: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  emailVerifiedAt: string | null;
  registrationCompletedAt: string | null;
  registrationComplete: boolean;
  role: User["role"];
  mobileVerifiedAt: string | null;
};

export function toPublicUser(user: User): PublicUser {
  const role = effectiveUserRole(user);
  return {
    id: user.id,
    mobile: user.mobile,
    displayName: user.displayName,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    email: user.email ?? null,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    registrationCompletedAt: user.registrationCompletedAt?.toISOString() ?? null,
    registrationComplete:
      role === "ADMIN" || user.registrationCompletedAt != null,
    // Live allowlist re-check: stale ADMIN DB role is not enough after revoke.
    role,
    mobileVerifiedAt: user.mobileVerifiedAt?.toISOString() ?? null,
  };
}
