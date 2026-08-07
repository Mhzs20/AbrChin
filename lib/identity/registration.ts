import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  deriveDisplayName,
  isRegistrationComplete,
  normalizeEmail,
  validatePersonName,
} from "@/lib/identity/names";
import type { PublicUser } from "@/lib/session";
import { WalletError } from "@/lib/wallet/errors";

export type CompleteRegistrationInput = {
  userId: string;
  firstName: unknown;
  lastName: unknown;
  email: unknown;
};

export async function completeCustomerRegistration(
  input: CompleteRegistrationInput,
): Promise<PublicUser> {
  const first = validatePersonName(input.firstName, "نام");
  if (!first.ok) throw new WalletError("invalid_first_name", first.error);
  const last = validatePersonName(input.lastName, "نام خانوادگی");
  if (!last.ok) throw new WalletError("invalid_last_name", last.error);
  const email = normalizeEmail(input.email);
  if (!email.ok) throw new WalletError("invalid_email", email.error);

  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user) throw new WalletError("not_found", "کاربر پیدا نشد.");
  if (user.role !== "CUSTOMER") {
    throw new WalletError(
      "registration_not_applicable",
      "تکمیل ثبت‌نام فقط برای مشتری است.",
    );
  }

  // Idempotent: already complete with same identity → return current user.
  if (
    isRegistrationComplete(user) &&
    user.firstName === first.value &&
    user.lastName === last.value &&
    user.email === email.email
  ) {
    const { toPublicUser } = await import("@/lib/session");
    return toPublicUser(user);
  }

  if (isRegistrationComplete(user)) {
    throw new WalletError(
      "registration_already_complete",
      "ثبت‌نام قبلاً تکمیل شده است؛ از پروفایل برای ویرایش استفاده کن.",
    );
  }

  const duplicate = await prisma.user.findFirst({
    where: {
      email: email.email,
      id: { not: user.id },
    },
    select: { id: true },
  });
  if (duplicate) {
    throw new WalletError(
      "email_taken",
      "این ایمیل قبلاً برای حساب دیگری ثبت شده است.",
    );
  }

  const displayName = deriveDisplayName(first.value, last.value);
  const now = new Date();

  try {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        firstName: first.value,
        lastName: last.value,
        email: email.email,
        emailVerifiedAt: null,
        displayName,
        registrationCompletedAt: now,
      },
    });
    const { toPublicUser } = await import("@/lib/session");
    return toPublicUser(updated);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new WalletError(
        "email_taken",
        "این ایمیل قبلاً برای حساب دیگری ثبت شده است.",
      );
    }
    throw error;
  }
}
