import type { QuestionId } from "@/lib/recommendation/types";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { updateConversationAnswer } from "@/lib/recommendation/session-service";
import { getCurrentUser } from "@/lib/session";

const questionIds = new Set<QuestionId>([
  "project",
  "audience",
  "stage",
  "usage",
  "architecture",
  "storage",
  "growth",
  "downtime",
  "criticality",
  "management",
]);

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
      source?: "user" | "estimate" | "default";
    };
    if (
      typeof body.questionId !== "string" ||
      !questionIds.has(body.questionId as QuestionId)
    ) {
      return jsonError("سؤال معتبر نیست.", 400);
    }
    const user = await getCurrentUser();
    const result = await updateConversationAnswer({
      sessionId: id,
      questionId: body.questionId as QuestionId,
      answer: body.answer,
      source: body.source,
      userId: user?.id ?? null,
      guestToken: request.headers.get("x-recommendation-session-token"),
    });
    return jsonOk(result);
  } catch (error) {
    const forbidden =
      error instanceof Error &&
      error.message === "conversation_session_forbidden";
    return jsonError(
      forbidden ? "دسترسی به این گفتگو مجاز نیست." : "ذخیره پاسخ ممکن نیست.",
      forbidden ? 403 : 400,
    );
  }
}
