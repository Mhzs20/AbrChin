import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { isEligibleAdmin } from "@/lib/admin/eligibility";
import { safeCustomerReturnPath } from "@/lib/customer/navigation";
import {
  AuthRequiredError,
  getCurrentUser,
  requireCurrentUser,
  type PublicUser,
} from "@/lib/session";
import { WalletError } from "@/lib/wallet/errors";

export class AdminRequiredError extends Error {
  constructor() {
    super("Admin access required");
    this.name = "AdminRequiredError";
  }
}

export class CustomerRequiredError extends Error {
  constructor() {
    super("Customer access required");
    this.name = "CustomerRequiredError";
  }
}

export class RegistrationIncompleteError extends Error {
  constructor() {
    super("Customer registration incomplete");
    this.name = "RegistrationIncompleteError";
  }
}

function registrationCompletePath(nextPath?: string | null) {
  const safe = safeCustomerReturnPath(nextPath ?? undefined);
  const qs = safe ? `?next=${encodeURIComponent(safe)}` : "";
  return `/register/complete${qs}`;
}

export async function requireAdmin(): Promise<PublicUser> {
  const user = await requireCurrentUser();
  // toPublicUser already applies ADMIN_MOBILES; re-check for defense in depth.
  if (!isEligibleAdmin(user)) {
    throw new AdminRequiredError();
  }
  return user;
}

export async function requireCustomer(): Promise<PublicUser> {
  const user = await requireCurrentUser();
  if (user.role !== "CUSTOMER") {
    throw new CustomerRequiredError();
  }
  if (!user.registrationComplete) {
    throw new RegistrationIncompleteError();
  }
  return user;
}

/** Authenticated customer who may still need to finish registration. */
export async function requireAuthenticatedCustomer(): Promise<PublicUser> {
  const user = await requireCurrentUser();
  if (user.role !== "CUSTOMER") {
    throw new CustomerRequiredError();
  }
  return user;
}

export const requireAdminUser = requireAdmin;
export const requireCustomerUser = requireCustomer;

export async function getAdminPageAccess(): Promise<{
  user: PublicUser;
  allowed: boolean;
}> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin");
  return { user, allowed: isEligibleAdmin(user) };
}

export async function requireCustomerPage(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account");
  if (user.role === "ADMIN") redirect("/admin");
  if (!user.registrationComplete) {
    const headersList = await headers();
    const pathname = headersList.get("x-pathname") ?? "/account";
    redirect(registrationCompletePath(pathname));
  }
  return user;
}

/** Registration completion page only. */
export async function requireRegistrationPage(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/register/complete");
  if (user.role === "ADMIN") redirect("/admin");
  if (user.registrationComplete) redirect("/account");
  return user;
}

export function isAdminRequiredError(
  error: unknown,
): error is AdminRequiredError {
  return error instanceof AdminRequiredError;
}

export function isCustomerRequiredError(
  error: unknown,
): error is CustomerRequiredError {
  return error instanceof CustomerRequiredError;
}

export function panelApiError(error: unknown) {
  if (error instanceof AuthRequiredError) {
    return { message: "برای ادامه وارد شوید.", status: 401 };
  }
  if (error instanceof RegistrationIncompleteError) {
    return {
      message: "برای ادامه باید ثبت‌نام را تکمیل کنی.",
      status: 403,
      code: "registration_incomplete",
    };
  }
  if (
    error instanceof AdminRequiredError ||
    error instanceof CustomerRequiredError ||
    (error instanceof WalletError && error.code === "forbidden")
  ) {
    return { message: "دسترسی مجاز نیست.", status: 403 };
  }
  return null;
}

export const adminApiError = panelApiError;
