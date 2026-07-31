import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import {
  clearRecommendationGuestCookie,
  getRecommendationGuestToken,
} from "@/lib/recommendation/guest-session-cookie";
import { claimConversationByGuestToken } from "@/lib/recommendation/session-service";
import { getCurrentUser } from "@/lib/session";

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  const user = await getCurrentUser();
  if (!user) return jsonError("ابتدا وارد حساب شو.", 401);
  const guestToken = await getRecommendationGuestToken();
  if (!guestToken) return jsonOk({ claimed: false, session: null });
  try {
    const session = await claimConversationByGuestToken({
      userId: user.id,
      guestToken,
    });
    return clearRecommendationGuestCookie(
      jsonOk({ claimed: true, session }),
    );
  } catch {
    return jsonError("اتصال گفتگو به حساب ممکن نیست.", 409);
  }
}
