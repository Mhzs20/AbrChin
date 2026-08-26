import { handleSettlementHttp } from "@/lib/messagego/settlement/http";
import { jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleSettlementHttp(request);
}

export async function GET() {
  return jsonError("Settlement is not a customer or browser API", 405, {
    code: "browser_forbidden",
  });
}
