import { prisma } from "@/lib/db";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { bigintToString, formatTomanFa, rialToToman } from "@/lib/money";
import { createServiceOrder, createServiceOrderByPlanId } from "@/lib/orders/service";
import { AuthRequiredError, requireCurrentUser } from "@/lib/session";
import { WalletError } from "@/lib/wallet/ledger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireCurrentUser();
    const orders = await prisma.serviceOrder.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return jsonOk({
      orders: orders.map((order) => ({
        id: order.id,
        title: order.title,
        description: order.description,
        status: order.status,
        planCode: order.planCode,
        amountRial: bigintToString(order.amount),
        amountToman: bigintToString(rialToToman(order.amount)),
        amountTomanFa: formatTomanFa(order.amount),
        paidAt: order.paidAt?.toISOString() ?? null,
        createdAt: order.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) return jsonError("برای ادامه وارد شوید.", 401);
    console.error("[orders:list]", error instanceof Error ? error.message : "unknown");
    return jsonError("دریافت سفارش‌ها ممکن نیست.", 500);
  }
}

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const user = await requireCurrentUser();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("درخواست نامعتبر است.", 400);
    }

    const payload = typeof body === "object" && body ? (body as Record<string, unknown>) : {};
    const planId = typeof payload.planId === "string" ? payload.planId : "";
    const planCode = typeof payload.planCode === "string" ? payload.planCode : "";

    const order = planId
      ? await createServiceOrderByPlanId(user.id, planId)
      : await createServiceOrder(user.id, planCode);
    return jsonOk({
      order: {
        id: order.id,
        title: order.title,
        description: order.description,
        status: order.status,
        planCode: order.planCode,
        amountRial: bigintToString(order.amount),
        amountToman: bigintToString(rialToToman(order.amount)),
        amountTomanFa: formatTomanFa(order.amount),
        createdAt: order.createdAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) return jsonError("برای ادامه وارد شوید.", 401);
    if (error instanceof WalletError) return jsonError(error.message, 400);
    console.error("[orders]", error instanceof Error ? error.message : "unknown");
    return jsonError("ایجاد سفارش ممکن نیست.", 500);
  }
}
