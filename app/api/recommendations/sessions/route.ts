import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import {
  getRecommendationGuestToken,
  setRecommendationGuestCookie,
} from "@/lib/recommendation/guest-session-cookie";
import {
  createConversationSession,
  getLatestConversationSessionForAccess,
} from "@/lib/recommendation/session-service";
import { getCurrentUser } from "@/lib/session";

export async function GET() {
  const user = await getCurrentUser();
  try {
    return jsonOk({
      session: await getLatestConversationSessionForAccess({
        userId: user?.id ?? null,
        guestToken: user ? null : await getRecommendationGuestToken(),
      }),
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
