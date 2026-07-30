import { cookies } from "next/headers";

export const RECOMMENDATION_GUEST_COOKIE = "abrchin_recommendation_guest";

export async function getRecommendationGuestToken(): Promise<string | null> {
  return (await cookies()).get(RECOMMENDATION_GUEST_COOKIE)?.value ?? null;
}

export function setRecommendationGuestCookie(
  response: Response,
  token: string,
): Response {
  response.headers.append(
    "Set-Cookie",
    `${RECOMMENDATION_GUEST_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${
      process.env.NODE_ENV === "production" ? "; Secure" : ""
    }`,
  );
  return response;
}

export function clearRecommendationGuestCookie(response: Response): Response {
  response.headers.append(
    "Set-Cookie",
    `${RECOMMENDATION_GUEST_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${
      process.env.NODE_ENV === "production" ? "; Secure" : ""
    }`,
  );
  return response;
}
