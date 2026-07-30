import type { Prisma } from "@prisma/client";

import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { getRecommendationGuestToken } from "@/lib/recommendation/guest-session-cookie";
import {
  confirmConversationUnderstanding,
  ConversationRevisionConflictError,
  getConversationSession,
} from "@/lib/recommendation/session-service";
import { getCurrentUser } from "@/lib/session";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      understanding?: unknown;
      expectedRevision?: unknown;
    };
    if (
      !body.understanding ||
      typeof body.understanding !== "object" ||
      Array.isArray(body.understanding)
    ) {
      return jsonError("برداشت ابرچین معتبر نیست.", 400);
    }
    if (
      !Number.isInteger(body.expectedRevision) ||
      Number(body.expectedRevision) < 0
    ) {
      return jsonError("نسخهٔ گفتگو معتبر نیست.", 400);
    }
    const user = await getCurrentUser();
    await confirmConversationUnderstanding({
      sessionId: id,
      understanding: body.understanding as Prisma.InputJsonValue,
      expectedRevision: Number(body.expectedRevision),
      userId: user?.id ?? null,
      guestToken:
        request.headers.get("x-recommendation-session-token") ??
        (await getRecommendationGuestToken()),
    });
    return jsonOk({
      confirmed: true,
      revision: Number(body.expectedRevision) + 1,
    });
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
    return jsonError("تأیید برداشت ممکن نیست.", 403);
  }
}
