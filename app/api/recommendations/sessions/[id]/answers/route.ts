import type { QuestionId } from "@/lib/recommendation/types";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { isRecommendationQuestionId } from "@/lib/recommendation/input";
import { getRecommendationGuestToken } from "@/lib/recommendation/guest-session-cookie";
import {
  ConversationRevisionConflictError,
  getConversationSession,
  updateConversationAnswer,
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
      questionId?: unknown;
      answer?: unknown;
      expectedRevision?: unknown;
      source?: "user" | "estimate" | "default";
    };
    if (!isRecommendationQuestionId(body.questionId)) {
      return jsonError("سؤال معتبر نیست.", 400);
    }
    if (
      !Number.isInteger(body.expectedRevision) ||
      Number(body.expectedRevision) < 0
    ) {
      return jsonError("نسخهٔ گفتگو معتبر نیست.", 400);
    }
    const user = await getCurrentUser();
    const guestToken =
      request.headers.get("x-recommendation-session-token") ??
      (await getRecommendationGuestToken());
    const result = await updateConversationAnswer({
      sessionId: id,
      questionId: body.questionId as QuestionId,
      answer: body.answer,
      expectedRevision: Number(body.expectedRevision),
      source: body.source,
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
    return jsonError(
      forbidden ? "دسترسی به این گفتگو مجاز نیست." : "ذخیره پاسخ ممکن نیست.",
      forbidden ? 403 : 400,
    );
  }
}
