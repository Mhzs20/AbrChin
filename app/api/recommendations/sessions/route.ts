import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { createConversationSession } from "@/lib/recommendation/session-service";
import { getCurrentUser } from "@/lib/session";

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const user = await getCurrentUser();
    const session = await createConversationSession(user?.id ?? null);
    return jsonOk({
      sessionId: session.id,
      guestToken: session.guestToken,
      expiresAt: session.expiresAt.toISOString(),
      state: session.state,
      nextQuestion: session.nextQuestion,
    });
  } catch {
    return jsonError("شروع گفتگو ممکن نیست.", 500);
  }
}
