import { handleProviderCallback } from "@/lib/payments/callback-handler";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleProviderCallback(request, "ZIBAL");
}

export async function POST(request: Request) {
  return handleProviderCallback(request, "ZIBAL");
}
