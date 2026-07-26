import { getTopUpSuggestedAmountsToman } from "@/lib/wallet/topup-settings";
import { jsonOk } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const suggestedAmountsToman = await getTopUpSuggestedAmountsToman();
  return jsonOk({ suggestedAmountsToman });
}
