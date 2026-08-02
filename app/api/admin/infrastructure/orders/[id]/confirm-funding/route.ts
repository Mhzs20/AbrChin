import { jsonError, rejectCrossOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Retired: first Admin approval now records a reviewable Provision command. */
export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  return jsonError("این مسیر بازنشسته است؛ از تأیید ساخت استفاده کنید.", 410);
}
