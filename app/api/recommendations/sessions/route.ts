import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { setRecommendationGuestCookie } from "@/lib/recommendation/guest-session-cookie";
import {
  createConversationSession,
  getLatestConversationSession,
} from "@/lib/recommendation/session-service";
import { getCurrentUser } from "@/lib/session";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError("ابتدا وارد حساب شو.", 401);
  try {
    return jsonOk({
      session: await getLatestConversationSession(user.id),
    });
  } catch {
    return jsonError("بازیابی گفتگو ممکن نیست.", 500);
  }
}

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const user = await getCurrentUser();
    const session = await createConversationSession(user?.id ?? null);
    const response = jsonOk({
      sessionId: session.id,
      revision: session.revision,
      expiresAt: session.expiresAt.toISOString(),
      state: session.state,
      nextQuestion: session.nextQuestion,
    });
    return session.guestToken
      ? setRecommendationGuestCookie(response, session.guestToken)
      : response;
  } catch {
    return jsonError("شروع گفتگو ممکن نیست.", 500);
  }
}
