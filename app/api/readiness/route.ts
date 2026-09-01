import { getPlatformReadiness } from "@/lib/monitoring/readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = await getPlatformReadiness();
  // Never expose provider identities or contract internals publicly.
  const publicBody = {
    status: readiness.status,
    severity: readiness.severity,
    components: readiness.components,
    features: readiness.features,
    workerLastSeenAt: readiness.workerLastSeenAt,
    checkedAt: readiness.checkedAt,
  };

  return Response.json(publicBody, {
    status: readiness.status === "operational" ? 200 : 503,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
