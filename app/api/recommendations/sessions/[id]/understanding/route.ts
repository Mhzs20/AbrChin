import type { Prisma } from "@prisma/client";

import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { confirmConversationUnderstanding } from "@/lib/recommendation/session-service";
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
    };
    if (
      !body.understanding ||
      typeof body.understanding !== "object" ||
      Array.isArray(body.understanding)
    ) {
      return jsonError("برداشت ابرچین معتبر نیست.", 400);
    }
    const user = await getCurrentUser();
    await confirmConversationUnderstanding({
      sessionId: id,
      understanding: body.understanding as Prisma.InputJsonValue,
      userId: user?.id ?? null,
      guestToken: request.headers.get("x-recommendation-session-token"),
    });
    return jsonOk({ confirmed: true });
  } catch {
    return jsonError("تأیید برداشت ممکن نیست.", 403);
  }
}
