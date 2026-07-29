import { getPlatformReadiness } from "@/lib/monitoring/readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = await getPlatformReadiness();

  return Response.json(readiness, {
    status: readiness.status === "operational" ? 200 : 503,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
