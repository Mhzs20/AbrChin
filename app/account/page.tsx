import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AccountPanel } from "@/components/account-panel";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "حساب من | ابرچین",
  description: "مدیریت پروفایل حساب ابرچین.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?next=/account");
  }

  return (
    <section className="account-page page-view" aria-labelledby="account-title">
      <div className="page-heading">
        <h1 id="account-title">حساب من</h1>
        <p>پروفایل حداقلی شما در ابرچین. کیف پول و سرویس‌ها در فازهای بعد اضافه می‌شوند.</p>
      </div>
      <AccountPanel user={user} />
    </section>
  );
}
