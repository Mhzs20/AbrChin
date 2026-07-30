import { jsonError, jsonOk } from "@/lib/http";
import { getRecommendationGuestToken } from "@/lib/recommendation/guest-session-cookie";
import { getConversationSession } from "@/lib/recommendation/session-service";
import { getCurrentUser } from "@/lib/session";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const user = await getCurrentUser();
    const session = await getConversationSession({
      sessionId: id,
      userId: user?.id ?? null,
      guestToken: await getRecommendationGuestToken(),
    });
    return jsonOk({ session });
  } catch (error) {
    const forbidden =
      error instanceof Error &&
      error.message === "conversation_session_forbidden";
    return jsonError(
      forbidden ? "دسترسی به این گفتگو مجاز نیست." : "گفتگو پیدا نشد.",
      forbidden ? 403 : 404,
    );
  }
}
