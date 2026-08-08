import type { Metadata } from "next";

import { RegistrationCompleteForm } from "@/components/auth/registration-complete-form";
import { requireRegistrationPage } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: "تکمیل ثبت‌نام | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function RegisterCompletePage() {
  const user = await requireRegistrationPage();

  return (
    <section className="auth-page page-view" aria-label="تکمیل ثبت‌نام">
      <RegistrationCompleteForm mobile={user.mobile} />
    </section>
  );
}
