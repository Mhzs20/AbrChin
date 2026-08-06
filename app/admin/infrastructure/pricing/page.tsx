import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Legacy URL — Financial Center is the single pricing hub. */
export default function AdminPricingRedirectPage() {
  redirect("/admin/finance");
}
