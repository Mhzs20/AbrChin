import { jsonError, rejectCrossOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Retired: manual fulfillment is a Provision-stage action, never delivery. */
export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  return jsonError("ثبت دستی اکنون فقط پس از تأیید ساخت و در مرحلهٔ Provision مجاز است.", 410);
}
