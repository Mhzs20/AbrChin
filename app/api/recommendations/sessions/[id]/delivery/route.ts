import { ParchinLevel } from "@prisma/client";

import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import {
  configureConversationDelivery,
  getConversationDeliveryOptions,
} from "@/lib/recommendation/delivery-service";
import { getRecommendationGuestToken } from "@/lib/recommendation/guest-session-cookie";
import {
  ConversationRevisionConflictError,
  getConversationSession,
} from "@/lib/recommendation/session-service";
import { getCurrentUser } from "@/lib/session";
import { WalletError } from "@/lib/wallet/errors";

const accessMethods = new Set([
  "ONE_TIME_PASSWORD",
  "SSH_KEY",
  "WINDOWS_PASSWORD",
]);

function parseParchinLevel(value: unknown): ParchinLevel | undefined {
  return Object.values(ParchinLevel).includes(value as ParchinLevel)
    ? (value as ParchinLevel)
    : undefined;
}

function deliveryErrorMessage(error: unknown, fallback: string) {
  if (error instanceof WalletError) return error.message;
  if (
    error instanceof Error &&
    error.message === "conversation_requirements_not_confirmed"
  ) {
    return "ابتدا برداشت ابرچین از نیازت را تأیید کن، بعد پیشنهاد سرور می‌آید.";
  }
  if (
    error instanceof Error &&
    error.message === "conversation_session_forbidden"
  ) {
    return "دسترسی به این گفتگو مجاز نیست.";
  }
  return fallback;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const user = await getCurrentUser();
    const url = new URL(request.url);
    const result = await getConversationDeliveryOptions({
      sessionId: id,
      userId: user?.id ?? null,
      guestToken:
        request.headers.get("x-recommendation-session-token") ??
        (await getRecommendationGuestToken()),
      requestedParchinLevel: parseParchinLevel(
        url.searchParams.get("parchinLevel"),
      ),
    });
    return jsonOk(result);
  } catch (error) {
    const forbidden =
      error instanceof Error &&
      error.message === "conversation_session_forbidden";
    return jsonError(
      deliveryErrorMessage(
        error,
        "تنظیمات معتبر تحویل فعلاً در دسترس نیست.",
      ),
      forbidden ? 403 : 409,
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const parchinLevel = parseParchinLevel(body.parchinLevel);
    if (
      !Number.isInteger(body.expectedRevision) ||
      typeof body.planId !== "string" ||
      typeof body.imageAssetId !== "string" ||
      !parchinLevel ||
      typeof body.accessMethod !== "string" ||
      !accessMethods.has(body.accessMethod)
    ) {
      return jsonError("تنظیمات تحویل معتبر نیست.", 400);
    }
    const user = await getCurrentUser();
    const guestToken =
      request.headers.get("x-recommendation-session-token") ??
      (await getRecommendationGuestToken());
    const result = await configureConversationDelivery({
      sessionId: id,
      expectedRevision: Number(body.expectedRevision),
      planId: body.planId,
      imageAssetId: body.imageAssetId,
      parchinLevel,
      accessMethod: body.accessMethod as
        | "ONE_TIME_PASSWORD"
        | "SSH_KEY"
        | "WINDOWS_PASSWORD",
      sshKeyName:
        typeof body.sshKeyName === "string" ? body.sshKeyName : null,
      serverName:
        typeof body.serverName === "string" ? body.serverName : null,
      userId: user?.id ?? null,
      guestToken,
    });
    return jsonOk(result);
  } catch (error) {
    if (error instanceof ConversationRevisionConflictError) {
      const { id } = await context.params;
      const user = await getCurrentUser();
      const current = await getConversationSession({
        sessionId: id,
        userId: user?.id ?? null,
        guestToken: await getRecommendationGuestToken(),
      }).catch(() => null);
      return jsonError("گفتگو در جای دیگری تغییر کرده است.", 409, {
        code: error.message,
        current,
      });
    }
    const forbidden =
      error instanceof Error &&
      error.message === "conversation_session_forbidden";
    const invalidAccess =
      error instanceof Error &&
      [
        "ssh_key_name_required",
        "ssh_key_not_found",
        "invalid_access_method_for_image",
        "invalid_server_name",
      ].includes(error.message);
    return jsonError(
      forbidden
        ? "دسترسی به این گفتگو مجاز نیست."
        : invalidAccess
          ? "روش دسترسی با سیستم‌عامل انتخاب‌شده سازگار نیست."
          : deliveryErrorMessage(error, "ثبت تنظیمات تحویل ممکن نیست."),
      forbidden ? 403 : 409,
    );
  }
}
