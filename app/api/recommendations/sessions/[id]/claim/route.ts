import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { claimConversationSession } from "@/lib/recommendation/session-service";
import { getCurrentUser } from "@/lib/session";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  const user = await getCurrentUser();
  if (!user) return jsonError("ابتدا وارد حساب شو.", 401);
  const token = request.headers.get("x-recommendation-session-token");
  if (!token) return jsonError("Token گفتگو موجود نیست.", 400);
  try {
    const { id } = await context.params;
    await claimConversationSession({
      sessionId: id,
      userId: user.id,
      guestToken: token,
    });
    return jsonOk({ claimed: true });
  } catch {
    return jsonError("اتصال گفتگو به حساب ممکن نیست.", 403);
  }
}
