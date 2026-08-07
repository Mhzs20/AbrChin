import { Prisma } from "@prisma/client";

import { panelApiError, requireCustomer } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { invalidateEmailChallengesForUser } from "@/lib/identity/email-verification";
import {
  deriveDisplayName,
  normalizeEmail,
  validatePersonName,
} from "@/lib/identity/names";
import { toPublicUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const current = await requireCustomer();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("درخواست نامعتبر است.", 400);
    }

    const payload =
      typeof body === "object" && body ? (body as Record<string, unknown>) : {};

    const first = validatePersonName(payload.firstName, "نام");
    if (!first.ok) return jsonError(first.error, 400);
    const last = validatePersonName(payload.lastName, "نام خانوادگی");
    if (!last.ok) return jsonError(last.error, 400);
    const email = normalizeEmail(payload.email);
    if (!email.ok) return jsonError(email.error, 400);

    const existing = await prisma.user.findUniqueOrThrow({
      where: { id: current.id },
    });

    const emailChanged = existing.email !== email.email;
    if (emailChanged) {
      const duplicate = await prisma.user.findFirst({
        where: { email: email.email, id: { not: current.id } },
        select: { id: true },
      });
      if (duplicate) {
        return jsonError("این ایمیل قبلاً برای حساب دیگری ثبت شده است.", 409, {
          code: "email_taken",
        });
      }
    }

    try {
      const user = await prisma.$transaction(async (tx) => {
        if (emailChanged) {
          await tx.emailVerificationChallenge.deleteMany({
            where: { userId: current.id, consumedAt: null },
          });
        }
        return tx.user.update({
          where: { id: current.id },
          data: {
            firstName: first.value,
            lastName: last.value,
            email: email.email,
            displayName: deriveDisplayName(first.value, last.value),
            ...(emailChanged ? { emailVerifiedAt: null } : {}),
          },
        });
      });

      if (emailChanged) {
        await invalidateEmailChallengesForUser(current.id);
      }

      return jsonOk({ user: toPublicUser(user) });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return jsonError("این ایمیل قبلاً برای حساب دیگری ثبت شده است.", 409, {
          code: "email_taken",
        });
      }
      throw error;
    }
  } catch (error) {
    const accessError = panelApiError(error);
    if (accessError) return jsonError(accessError.message, accessError.status);
    console.error(
      "[account/profile]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("به‌روزرسانی پروفایل ممکن نیست.", 500);
  }
}
