import { redirect } from "next/navigation";

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

export async function requireAdmin(): Promise<PublicUser> {
  const user = await requireCurrentUser();
  if (user.role !== "ADMIN") {
    throw new AdminRequiredError();
  }
  return user;
}

export async function requireCustomer(): Promise<PublicUser> {
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
  return { user, allowed: user.role === "ADMIN" };
}

export async function requireCustomerPage(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account");
  if (user.role === "ADMIN") redirect("/admin");
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
