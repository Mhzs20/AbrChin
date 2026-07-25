import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AccountHub } from "@/components/account-hub";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "حساب من | ابرچین",
  description: "پنل کاربری، کیف پول و سفارش‌های ابرچین.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account");

  return (
    <section className="account-page page-view" aria-labelledby="account-title">
      <div className="page-heading">
        <h1 id="account-title">حساب من</h1>
        <p>پروفایل، کیف پول، تراکنش‌ها و سفارش‌های شما در یک‌جا.</p>
      </div>
      <AccountHub mobile={user.mobile} displayName={user.displayName} role={user.role} />
    </section>
  );
}
