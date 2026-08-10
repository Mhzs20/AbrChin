import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import {
  getRecommendationGuestToken,
  setRecommendationGuestCookie,
} from "@/lib/recommendation/guest-session-cookie";
import {
  createConversationSession,
  getLatestConversationSessionForAccess,
} from "@/lib/recommendation/session-service";
import type {
  ManagementKind,
  ProjectKind,
} from "@/lib/recommendation/types";
import { getCurrentUser } from "@/lib/session";

const projectKinds = new Set<ProjectKind>([
  "site",
  "commerce",
  "product",
  "api",
  "migration",
  "data",
  "other",
]);

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
  let input: Record<string, unknown> = {};
  try {
    const raw = await request.text();
    input = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return jsonError("بدنه درخواست معتبر نیست.", 400);
  }
  try {
    const project =
      typeof input.project === "string" &&
      projectKinds.has(input.project as ProjectKind)
        ? (input.project as ProjectKind)
        : undefined;
    const management: ManagementKind | undefined =
      input.management === "managed" ? "managed" : undefined;
    const user = await getCurrentUser();
    const session = await createConversationSession(user?.id ?? null, {
      project,
      management,
    });
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
