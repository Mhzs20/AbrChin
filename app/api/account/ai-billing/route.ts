import { panelApiError, requireCustomer } from "@/lib/auth/guards";
import { jsonError, jsonOk } from "@/lib/http";
import { assertNoJsonNumberMoney } from "@/lib/messagego/settlement/amount";
import { getCustomerAiSurface } from "@/lib/messagego/customer/surface";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireCustomer();
    const surface = await getCustomerAiSurface(user.id);
    assertNoJsonNumberMoney(surface);
    return jsonOk({ surface });
  } catch (error) {
    const access = panelApiError(error);
    if (access) return jsonError(access.message, access.status);
    return jsonError("دریافت وضعیت مالی هوش مصنوعی ممکن نیست.", 500);
  }
}
