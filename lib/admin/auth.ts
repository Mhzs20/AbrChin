import { redirect } from "next/navigation";

import { AuthRequiredError, getCurrentUser, requireCurrentUser, type PublicUser } from "@/lib/session";
import { WalletError } from "@/lib/wallet/errors";

export class AdminRequiredError extends Error {
  constructor() {
    super("Admin access required");
    this.name = "AdminRequiredError";
  }
}

export async function requireAdminUser(): Promise<PublicUser> {
  const user = await requireCurrentUser();
  if (user.role !== "ADMIN") {
    throw new AdminRequiredError();
  }
  return user;
}

export async function guardAdminPage(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin");
  if (user.role !== "ADMIN") redirect("/account");
  return user;
}

export function isAdminRequiredError(error: unknown): error is AdminRequiredError {
  return error instanceof AdminRequiredError;
}

export function adminApiError(error: unknown) {
  if (error instanceof AuthRequiredError) {
    return { message: "برای ادامه وارد شوید.", status: 401 };
  }
  if (error instanceof AdminRequiredError || (error instanceof WalletError && error.code === "forbidden")) {
    return { message: "دسترسی مجاز نیست.", status: 403 };
  }
  return null;
}
